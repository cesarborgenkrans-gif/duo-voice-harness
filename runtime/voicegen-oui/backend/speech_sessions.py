# SPDX-License-Identifier: Apache-2.0
# Adapted/modified for Duo Voice Harness; see ../LICENSE, ../NOTICE and ../ORIGIN.md.
from __future__ import annotations

import queue
import threading
import time
import tempfile
import os
import wave
from dataclasses import dataclass
from typing import Any, Callable


SESSION_IDLE_TIMEOUT_SECONDS = 60.0
SESSION_AUDIO_CONSUMER_TIMEOUT_SECONDS = 30.0
SESSION_TEXT_QUEUE_MAX_ITEMS = 12
SESSION_AUDIO_QUEUE_MAX_ITEMS = 24
SESSION_MAX_TEXT_CHARS = 32_768


class SpeechSessionError(RuntimeError):
    """Base error for the local progressive speech-session protocol."""


class SpeechSessionBusyError(SpeechSessionError):
    pass


class SpeechSessionNotFoundError(SpeechSessionError):
    pass


class SpeechSessionStateError(SpeechSessionError):
    pass


class SpeechSessionTimeoutError(SpeechSessionError):
    pass


class SpeechSessionCancelled(SpeechSessionError):
    pass


class SentenceChunker:
    """Buffer streamed text and emit natural sentence-sized speech chunks."""

    STRONG = set("。！？!?\n")
    WEAK = set("、,;；:： ")
    TRAILING_QUOTES = set("」』】）)]}”’\"")

    def __init__(self, max_chars: int = 180, weak_floor: int = 72, hard_limit: bool = False, single_utterance: bool = False):
        self.buffer = ""
        self.hard_limit = hard_limit
        self.single_utterance = bool(single_utterance)
        self.max_chars = max(48, int(max_chars))
        self.weak_floor = min(max(24, int(weak_floor)), self.max_chars - 1)

    def push(self, delta: str) -> list[str]:
        self.buffer += str(delta or "")
        return self._drain(final=False)

    def finish(self) -> list[str]:
        return self._drain(final=True)

    def _strong_boundary(self) -> int | None:
        for index, char in enumerate(self.buffer):
            is_period = char == "."
            if char not in self.STRONG and not is_period:
                continue
            if is_period:
                next_char = self.buffer[index + 1 : index + 2]
                if next_char and not next_char.isspace() and next_char not in self.TRAILING_QUOTES:
                    continue
            end = index + 1
            while end < len(self.buffer) and self.buffer[end] in self.TRAILING_QUOTES:
                end += 1
            return end
        return None

    def _fallback_boundary(self) -> int | None:
        if len(self.buffer) < self.max_chars:
            return None
        window = self.buffer[self.weak_floor : self.max_chars + 1]
        weak_positions = [
            self.weak_floor + index + 1
            for index, char in enumerate(window)
            if char in self.WEAK
        ]
        return weak_positions[-1] if weak_positions else self.max_chars

    def _drain(self, final: bool) -> list[str]:
        # Conversation replies are one generation. Sentence splits stay for reading continuation.
        if self.single_utterance:
            if not final:
                return []
            tail = self.buffer.strip()
            self.buffer = ""
            return [tail] if tail else []
        chunks: list[str] = []
        while self.buffer:
            boundary = self._strong_boundary()
            if boundary is None or (self.hard_limit and boundary > self.max_chars):
                boundary = self._fallback_boundary()
            if boundary is None:
                break
            chunk = self.buffer[:boundary].strip()
            self.buffer = self.buffer[boundary:].lstrip()
            if chunk and not all(char.isspace() or char in self.STRONG for char in chunk):
                chunks.append(chunk)
        if final:
            tail = self.buffer.strip()
            self.buffer = ""
            if tail:
                chunks.append(tail)
        return chunks


@dataclass(frozen=True)
class SpeechChunk:
    sequence: int
    text: str
    start_sample: int
    end_sample: int

    def as_manifest_item(self) -> dict[str, object]:
        return {
            "sequence": self.sequence,
            "text": self.text,
            "start_sample": self.start_sample,
            "end_sample": self.end_sample,
        }


@dataclass(frozen=True)
class AudioPacket:
    pcm_s16le: bytes
    sample_count: int


class SpeechSession:
    """One local text producer, one VoxCPM worker, and one PCM consumer."""

    TERMINAL_STATES = frozenset({"completed", "cancelled", "failed", "timed_out"})

    def __init__(
        self,
        *,
        session_id: str,
        generation_id: str,
        filename: str,
        payload: dict[str, object],
        reference: dict[str, object],
        engine: Any,
        sample_rate: int,
        started_at: str,
        on_complete: Callable[["SpeechSession", Any], dict[str, object]],
        on_terminal: Callable[["SpeechSession"], None],
        on_abort_after_complete: Callable[["SpeechSession", dict[str, object]], None]
        | None = None,
        idle_timeout_seconds: float = SESSION_IDLE_TIMEOUT_SECONDS,
        audio_consumer_timeout_seconds: float = SESSION_AUDIO_CONSUMER_TIMEOUT_SECONDS,
        text_queue_max_items: int = SESSION_TEXT_QUEUE_MAX_ITEMS,
        audio_queue_max_items: int = SESSION_AUDIO_QUEUE_MAX_ITEMS,
        max_text_chars: int = SESSION_MAX_TEXT_CHARS,
    ):
        if sample_rate <= 0:
            raise ValueError("sample_rate must be positive")
        self.session_id = str(session_id)
        self.generation_id = str(generation_id)
        self.filename = str(filename)
        self.payload = dict(payload)
        self.reference = dict(reference)
        self.engine = engine
        self.sample_rate = int(sample_rate)
        self.started_at = str(started_at)
        self.on_complete = on_complete
        self.on_terminal = on_terminal
        self.on_abort_after_complete = on_abort_after_complete
        self.idle_timeout_seconds = max(0.05, float(idle_timeout_seconds))
        self.audio_consumer_timeout_seconds = max(
            0.05, float(audio_consumer_timeout_seconds)
        )
        self.max_text_chars = max(1, int(max_text_chars))

        self._lock = threading.RLock()
        self._text_queue: queue.Queue[object] = queue.Queue(
            maxsize=max(1, int(text_queue_max_items))
        )
        self._audio_queue: queue.Queue[AudioPacket] = queue.Queue(
            maxsize=max(1, int(audio_queue_max_items))
        )
        self._chunker = SentenceChunker(
            hard_limit=bool(self.payload.get("narration_continuation")),
            single_utterance=bool(self.payload.get("single_utterance")),
        )
        self._state = "open"
        self._error: str | None = None
        self._record: dict[str, object] | None = None
        self._submitted_text_parts: list[str] = []
        self._speech_chunks: list[SpeechChunk] = []
        self._sample_cursor = 0
        self._first_audio_seconds: float | None = None
        self._created_monotonic = time.monotonic()
        self._last_input_monotonic = self._created_monotonic
        self._completion_requested = False
        self._audio_consumer_connected = False
        self._consumer_connected_event = threading.Event()
        self._audio_finished_event = threading.Event()
        self._audio_abort_event = threading.Event()
        self._cancel_event = threading.Event()
        self._terminal_event = threading.Event()
        self._worker = threading.Thread(
            target=self._run,
            name=f"VoiceGenSpeechSession-{self.session_id[:8]}",
            daemon=True,
        )

    @property
    def submitted_text(self) -> str:
        with self._lock:
            return "".join(self._submitted_text_parts)

    @property
    def speech_chunks(self) -> list[dict[str, object]]:
        with self._lock:
            return [chunk.as_manifest_item() for chunk in self._speech_chunks]

    @property
    def first_audio_seconds(self) -> float | None:
        with self._lock:
            return self._first_audio_seconds

    def start(self) -> None:
        self._worker.start()

    def is_terminal(self) -> bool:
        with self._lock:
            return self._state in self.TERMINAL_STATES

    @property
    def cancel_requested(self) -> bool:
        return self._cancel_event.is_set()

    def snapshot(self) -> dict[str, object]:
        with self._lock:
            return {
                "session_id": self.session_id,
                "state": self._state,
                "generation_id": self.generation_id,
                "filename": self.filename,
                "sample_rate": self.sample_rate,
                "input_mode": "progressive_session",
                "received_characters": sum(
                    len(part) for part in self._submitted_text_parts
                ),
                "speech_chunk_count": len(self._speech_chunks),
                "completion_requested": self._completion_requested,
                "audio_consumer_connected": self._audio_consumer_connected,
                "error": self._error,
                "record": self._record,
            }

    def append_delta(self, delta: object) -> dict[str, object]:
        if not isinstance(delta, str):
            raise ValueError("delta must be a string")
        if not delta:
            raise ValueError("delta must not be empty")

        with self._lock:
            if self._state not in {"open", "generating"}:
                raise SpeechSessionStateError(
                    f"speech session is {self._state}; it cannot accept more text"
                )
            current_length = sum(len(part) for part in self._submitted_text_parts)
            if current_length + len(delta) > self.max_text_chars:
                raise ValueError(
                    f"speech session text exceeds {self.max_text_chars} characters"
                )
            speech_texts = self._chunker.push(delta)
            self._submitted_text_parts.append(delta)
            self._last_input_monotonic = time.monotonic()
        # Queue insertion can apply producer backpressure. Do not hold the
        # session lock while it waits: the worker needs that lock to commit a
        # completed semantic chunk before it can drain more text.
        for speech_text in speech_texts:
            self._put_text(speech_text)
        return {
            "accepted_characters": len(delta),
            "queued_speech_chunks": len(speech_texts),
            "session": self.snapshot(),
        }

    def complete(self) -> dict[str, object]:
        with self._lock:
            if self._state not in {"open", "generating"}:
                raise SpeechSessionStateError(
                    f"speech session is {self._state}; it cannot be completed"
                )
            self._completion_requested = True
            self._state = "completing"
            tail_chunks = self._chunker.finish()
        for speech_text in tail_chunks:
            self._put_text(speech_text)
        self._put_text(None)
        return self.snapshot()

    def cancel(self, reason: str = "cancelled by client") -> dict[str, object]:
        with self._lock:
            if self._state in self.TERMINAL_STATES:
                return self.snapshot()
            self._state = "cancelling"
            self._error = str(reason)
            self._cancel_event.set()
            self._audio_abort_event.set()
            return self.snapshot()

    def begin_audio_consumer(self) -> None:
        with self._lock:
            if self._state in self.TERMINAL_STATES:
                raise SpeechSessionStateError(
                    f"speech session is {self._state}; its live audio is no longer available"
                )
            if self._audio_consumer_connected:
                raise SpeechSessionStateError(
                    "speech session already has an audio consumer"
                )
            self._audio_consumer_connected = True
            self._consumer_connected_event.set()

    def next_audio_packet(self) -> AudioPacket | None:
        while True:
            if self._audio_abort_event.is_set():
                return None
            try:
                return self._audio_queue.get(timeout=0.2)
            except queue.Empty:
                if self._audio_abort_event.is_set() or self._audio_finished_event.is_set():
                    return None

    def end_audio_consumer(self, *, disconnected: bool) -> None:
        should_cancel = False
        with self._lock:
            self._audio_consumer_connected = False
            if disconnected and self._state not in self.TERMINAL_STATES:
                should_cancel = True
        if should_cancel:
            self.cancel("audio consumer disconnected")

    def _put_text(self, item: object) -> None:
        while True:
            if self._cancel_event.is_set():
                raise SpeechSessionCancelled("speech session was cancelled")
            try:
                self._text_queue.put(item, timeout=0.2)
                return
            except queue.Full:
                continue

    def _put_audio(self, packet: AudioPacket) -> None:
        while True:
            if self._cancel_event.is_set():
                raise SpeechSessionCancelled("speech session was cancelled")
            try:
                self._audio_queue.put(packet, timeout=0.2)
                return
            except queue.Full:
                continue

    def _wait_for_audio_consumer(self) -> None:
        deadline = time.monotonic() + self.audio_consumer_timeout_seconds
        while not self._consumer_connected_event.wait(timeout=0.2):
            if self._cancel_event.is_set():
                raise SpeechSessionCancelled("speech session was cancelled")
            if time.monotonic() >= deadline:
                raise SpeechSessionTimeoutError(
                    "an audio consumer did not connect before the session timed out"
                )

    def _next_text(self) -> str | None:
        while True:
            if self._cancel_event.is_set():
                raise SpeechSessionCancelled("speech session was cancelled")
            try:
                item = self._text_queue.get(timeout=0.2)
            except queue.Empty:
                with self._lock:
                    completion_requested = self._completion_requested
                    last_input = self._last_input_monotonic
                if not completion_requested and (
                    time.monotonic() - last_input >= self.idle_timeout_seconds
                ):
                    raise SpeechSessionTimeoutError(
                        "speech session timed out while waiting for text"
                    )
                continue
            if item is None:
                return None
            return str(item)

    def _append_speech_chunk(self, text: str, end_sample: int) -> None:
        with self._lock:
            chunk = SpeechChunk(
                sequence=len(self._speech_chunks),
                text=text,
                start_sample=self._sample_cursor,
                end_sample=end_sample,
            )
            self._speech_chunks.append(chunk)
            self._sample_cursor = end_sample

    def _set_state(self, state: str) -> None:
        with self._lock:
            if self._state not in self.TERMINAL_STATES and self._state != "completing":
                self._state = state

    def _finish_terminal(
        self,
        state: str,
        *,
        error: str | None = None,
        record: dict[str, object] | None = None,
    ) -> None:
        with self._lock:
            self._state = state
            self._error = error
            self._record = record
        if state != "completed":
            self._audio_abort_event.set()
        self._audio_finished_event.set()
        self._terminal_event.set()

    def _run(self) -> None:
        started = time.monotonic()
        audio_parts: list[Any] = []
        continuation_path = None
        continuation_text = None
        try:
            import numpy as np

            while True:
                speech_text = self._next_text()
                if speech_text is None:
                    break
                self._wait_for_audio_consumer()
                self._set_state("generating")
                with self._lock:
                    start_sample = self._sample_cursor
                chunk_parts = []
                continuation_kwargs = {}
                if self.payload.get("narration_continuation") and continuation_path:
                    continuation_kwargs = {"prompt_wav_path": continuation_path, "prompt_text": continuation_text}
                for audio_chunk, chunk_sample_rate in self.engine.generate_design_stream(
                    text=speech_text,
                    language=self.payload["language"],
                    instruct=self.payload["voice_direction"]
                    if self.payload["mode"] == "voice-directed"
                    else self.payload["voice_design"],
                    reference_wav_path=self.payload.get("reference_wav_path"),
                    cfg_value=self.payload["cfg_value"],
                    inference_timesteps=self.payload["inference_timesteps"],
                    denoise=self.payload["denoise"],
                    max_len=self.payload["max_len"],
                    seed=self.payload["seed"],
                    **continuation_kwargs,
                ):
                    if self._cancel_event.is_set():
                        raise SpeechSessionCancelled("speech session was cancelled")
                    if int(chunk_sample_rate) != self.sample_rate:
                        raise RuntimeError("sample rate changed during speech session")
                    normalized = np.asarray(audio_chunk, dtype=np.float32).reshape(-1)
                    if normalized.size == 0:
                        continue
                    if self.first_audio_seconds is None:
                        with self._lock:
                            if self._first_audio_seconds is None:
                                self._first_audio_seconds = time.monotonic() - started
                    audio_parts.append(normalized)
                    if self.payload.get("narration_continuation"):
                        chunk_parts.append(normalized)
                    pcm = np.clip(normalized, -1.0, 1.0)
                    self._put_audio(
                        AudioPacket(
                            pcm_s16le=(pcm * 32767.0)
                            .astype("<i2", copy=False)
                            .tobytes(),
                            sample_count=int(normalized.size),
                        )
                    )
                    start_sample += int(normalized.size)
                self._append_speech_chunk(speech_text, start_sample)
                if self.payload.get("narration_continuation") and chunk_parts:
                    if self._cancel_event.is_set():
                        raise SpeechSessionCancelled("speech session was cancelled")
                    # Keep one complete chunk paired with its exact words. Do not
                    # clip audio while retaining the original full transcript.
                    previous = np.concatenate(chunk_parts)
                    if previous.size > self.sample_rate * 60:
                        raise SpeechSessionError("continuation chunk exceeds one minute")
                    if continuation_path is None:
                        fd, continuation_path = tempfile.mkstemp(prefix="duo-voice-reading-", suffix=".wav")
                        os.close(fd)
                    with wave.open(continuation_path, "wb") as context_wav:
                        context_wav.setnchannels(1)
                        context_wav.setsampwidth(2)
                        context_wav.setframerate(self.sample_rate)
                        context_wav.writeframes((np.clip(previous, -1.0, 1.0) * 32767.0).astype("<i2", copy=False).tobytes())
                    continuation_text = speech_text

            if self._cancel_event.is_set():
                raise SpeechSessionCancelled("speech session was cancelled")
            if not audio_parts:
                raise SpeechSessionError("speech session completed without generated audio")
            full_audio = np.concatenate(audio_parts)
            record = self.on_complete(self, full_audio)
            if self._cancel_event.is_set():
                if self.on_abort_after_complete is not None:
                    try:
                        self.on_abort_after_complete(self, record)
                    except Exception as cleanup_error:  # pragma: no cover - best effort
                        print(
                            "[VoiceGenSpeechSession] completion rollback failed: "
                            f"{type(cleanup_error).__name__}: {cleanup_error}"
                        )
                raise SpeechSessionCancelled("speech session was cancelled")
            self._finish_terminal("completed", record=record)
        except SpeechSessionCancelled as exc:
            self._finish_terminal("cancelled", error=str(exc))
        except SpeechSessionTimeoutError as exc:
            self._finish_terminal("timed_out", error=str(exc))
        except Exception as exc:
            self._finish_terminal("failed", error=f"{type(exc).__name__}: {exc}")
        finally:
            if continuation_path:
                try:
                    os.unlink(continuation_path)
                except FileNotFoundError:
                    pass
            try:
                self.on_terminal(self)
            except Exception as exc:  # pragma: no cover - cleanup must not kill worker
                print(f"[VoiceGenSpeechSession] terminal cleanup failed: {exc}")


class SpeechSessionManager:
    """Retain recent session status while ensuring only one live producer owns VoxCPM."""

    def __init__(self, max_retained_sessions: int = 16):
        self._lock = threading.RLock()
        self._sessions: dict[str, SpeechSession] = {}
        self._active_session_id: str | None = None
        self._max_retained_sessions = max(1, int(max_retained_sessions))

    def create(
        self,
        *,
        on_terminal: Callable[[SpeechSession], None],
        **kwargs: Any,
    ) -> SpeechSession:
        with self._lock:
            if self._active_session_id is not None:
                active = self._sessions.get(self._active_session_id)
                if active is not None and not active.is_terminal():
                    raise SpeechSessionBusyError("a progressive speech session is already active")
                self._active_session_id = None

            def handle_terminal(session: SpeechSession) -> None:
                with self._lock:
                    if self._active_session_id == session.session_id:
                        self._active_session_id = None
                    self._prune_terminal_sessions()
                on_terminal(session)

            session = SpeechSession(on_terminal=handle_terminal, **kwargs)
            self._sessions[session.session_id] = session
            self._active_session_id = session.session_id
            session.start()
            return session

    def get(self, session_id: str) -> SpeechSession:
        with self._lock:
            session = self._sessions.get(str(session_id))
        if session is None:
            raise SpeechSessionNotFoundError("speech session was not found")
        return session

    def active_session_id(self) -> str | None:
        with self._lock:
            return self._active_session_id

    def _prune_terminal_sessions(self) -> None:
        terminal_ids = [
            session_id
            for session_id, session in self._sessions.items()
            if session.is_terminal() and session_id != self._active_session_id
        ]
        overflow = len(self._sessions) - self._max_retained_sessions
        for session_id in terminal_ids[: max(0, overflow)]:
            self._sessions.pop(session_id, None)
