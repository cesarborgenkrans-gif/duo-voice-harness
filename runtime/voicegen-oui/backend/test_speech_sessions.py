# SPDX-License-Identifier: Apache-2.0
# Adapted/modified for Duo Voice Harness; see ../LICENSE, ../NOTICE and ../ORIGIN.md.
from __future__ import annotations

import http.client
import json
import tempfile
import threading
import time
import unittest
import wave
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
from unittest import mock

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

import server
from speech_sessions import (
    SpeechSession,
    SpeechSessionBusyError,
    SpeechSessionManager,
    SpeechSessionStateError,
)


class FakeStreamingEngine:
    def __init__(self, sample_rate: int = 24_000, packets_per_chunk: int = 2):
        self.sample_rate = sample_rate
        self.packets_per_chunk = packets_per_chunk
        self.calls: list[tuple[str, dict]] = []
        self.yield_count = 0

    def generate_design_stream(self, *, text, **kwargs):
        self.calls.append((text, kwargs))
        value = min(0.8, 0.1 * len(self.calls))
        for _ in range(self.packets_per_chunk):
            self.yield_count += 1
            yield np.full(4, value, dtype=np.float32), self.sample_rate


class BlockingStreamingEngine(FakeStreamingEngine):
    def __init__(self):
        super().__init__()
        self.started = threading.Event()
        self.release = threading.Event()

    def generate_design_stream(self, *, text, **kwargs):
        self.calls.append((text, kwargs))
        self.started.set()
        while not self.release.wait(timeout=0.02):
            continue
        yield np.ones(4, dtype=np.float32) * 0.2, self.sample_rate


class HttpStreamingEngine(FakeStreamingEngine):
    def __init__(self):
        super().__init__(sample_rate=1000, packets_per_chunk=2)
        self.model = SimpleNamespace(
            tts_model=SimpleNamespace(sample_rate=self.sample_rate)
        )


def write_fake_wav(path, audio, sample_rate):
    pcm = (np.clip(audio, -1.0, 1.0) * 32767.0).astype("<i2", copy=False)
    with wave.open(str(path), "wb") as output_wav:
        output_wav.setnchannels(1)
        output_wav.setsampwidth(2)
        output_wav.setframerate(int(sample_rate))
        output_wav.writeframes(pcm.tobytes())


def session_payload() -> dict:
    return {
        "text": "",
        "mode": "voice-clone",
        "language": "Japanese",
        "voice_direction": "",
        "voice_design": "",
        "reference_wav_path": None,
        "seed": 31419,
        "cfg_value": 2.0,
        "inference_timesteps": 8,
        "max_len": 4096,
        "denoise": False,
        "leading_silence_cleanup": False,
    }


class SpeechSessionTests(unittest.TestCase):
    def make_session(self, engine=None, on_complete=None, **kwargs):
        engine = engine or FakeStreamingEngine()
        terminal = threading.Event()
        captures: dict = {}

        def complete(session, audio):
            captures["submitted_text"] = session.submitted_text
            captures["segments"] = session.speech_chunks
            captures["audio"] = np.asarray(audio)
            return (on_complete or (lambda *_: {"saved": True}))(session, audio)

        def terminal_callback(session):
            captures["terminal_state"] = session.snapshot()["state"]
            terminal.set()

        session = SpeechSession(
            session_id="session-test",
            generation_id="generation-test",
            filename="generation-test.wav",
            payload=session_payload(),
            reference={"source": "test", "filename": "reference.wav"},
            engine=engine,
            sample_rate=engine.sample_rate,
            started_at="2026-08-23T00:00:00+00:00",
            on_complete=complete,
            on_terminal=terminal_callback,
            **kwargs,
        )
        return session, engine, terminal, captures

    def wait_for_terminal(self, session, terminal, timeout: float = 2.0):
        self.assertTrue(terminal.wait(timeout), session.snapshot())
        return session.snapshot()

    def drain_audio(self, session):
        packets = []
        while True:
            packet = session.next_audio_packet()
            if packet is None:
                return packets
            packets.append(packet)

    def test_progressive_deltas_preserve_japanese_boundaries_and_fifo_audio(self):
        session, engine, terminal, captures = self.make_session()
        session.start()
        session.begin_audio_consumer()
        first = session.append_delta("今日はいい")
        self.assertEqual(first["queued_speech_chunks"], 0)
        second = session.append_delta("天気です。次は")
        self.assertEqual(second["queued_speech_chunks"], 1)
        session.complete()

        packets = self.drain_audio(session)
        status = self.wait_for_terminal(session, terminal)

        self.assertEqual([call[0] for call in engine.calls], ["今日はいい天気です。", "次は"])
        self.assertEqual(captures["submitted_text"], "今日はいい天気です。次は")
        self.assertEqual(
            captures["segments"],
            [
                {"sequence": 0, "text": "今日はいい天気です。", "start_sample": 0, "end_sample": 8},
                {"sequence": 1, "text": "次は", "start_sample": 8, "end_sample": 16},
            ],
        )
        self.assertEqual(sum(packet.sample_count for packet in packets), 16)
        self.assertEqual(status["state"], "completed")
        self.assertEqual(status["record"], {"saved": True})

    def test_single_utterance_keeps_sentence_breaks_inside_one_generation(self):
        payload = session_payload()
        payload["single_utterance"] = True
        engine = FakeStreamingEngine()
        terminal = threading.Event()
        session = SpeechSession(
            session_id="session-single",
            generation_id="generation-single",
            filename="generation-single.wav",
            payload=payload,
            reference={"source": "test", "filename": "reference.wav"},
            engine=engine,
            sample_rate=engine.sample_rate,
            started_at="2026-08-23T00:00:00+00:00",
            on_complete=lambda *_: {"saved": True},
            on_terminal=lambda _session: terminal.set(),
        )
        session.start()
        session.begin_audio_consumer()
        queued = session.append_delta("First sentence. Second sentence.")
        self.assertEqual(queued["queued_speech_chunks"], 0)
        session.complete()
        self.drain_audio(session)
        self.wait_for_terminal(session, terminal)
        self.assertEqual([call[0] for call in engine.calls], ["First sentence. Second sentence."])

    def test_reading_continuation_pairs_previous_audio_and_exact_words(self):
        class InspectingEngine(FakeStreamingEngine):
            def generate_design_stream(self, *, text, **kwargs):
                if kwargs.get("prompt_wav_path"):
                    with wave.open(kwargs["prompt_wav_path"], "rb") as wav:
                        self.previous_frames = wav.getnframes()
                yield from super().generate_design_stream(text=text, **kwargs)
        session, engine, terminal, _ = self.make_session(engine=InspectingEngine())
        session.payload["narration_continuation"] = True
        session.start()
        session.begin_audio_consumer()
        session.append_delta("First sentence. Second sentence.")
        session.complete()
        self.drain_audio(session)
        status = self.wait_for_terminal(session, terminal)
        self.assertEqual(status["state"], "completed", status)
        self.assertNotIn("prompt_wav_path", engine.calls[0][1])
        self.assertEqual(engine.calls[1][1]["prompt_text"], "First sentence.")
        self.assertEqual(engine.previous_frames, 8)
        self.assertFalse(Path(engine.calls[1][1]["prompt_wav_path"]).exists())

    def test_audio_queue_applies_backpressure_until_the_consumer_drains(self):
        session, engine, terminal, _ = self.make_session(
            engine=FakeStreamingEngine(packets_per_chunk=6),
            audio_queue_max_items=1,
        )
        session.start()
        session.begin_audio_consumer()
        session.append_delta("待機します。")
        session.complete()

        deadline = time.monotonic() + 1.0
        while engine.yield_count < 2 and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertGreaterEqual(engine.yield_count, 2)
        self.assertLessEqual(session._audio_queue.qsize(), 1)
        self.assertFalse(session.is_terminal())

        packets = self.drain_audio(session)
        status = self.wait_for_terminal(session, terminal)
        self.assertEqual(sum(packet.sample_count for packet in packets), 24)
        self.assertEqual(status["state"], "completed")

    def test_completion_flushes_an_unpunctuated_tail(self):
        session, engine, terminal, _ = self.make_session()
        session.start()
        session.begin_audio_consumer()
        session.append_delta("句読点なしの文")
        session.complete()
        self.drain_audio(session)
        status = self.wait_for_terminal(session, terminal)

        self.assertEqual([call[0] for call in engine.calls], ["句読点なしの文"])
        self.assertEqual(status["state"], "completed")

    def test_cancelled_session_removes_the_live_stream_without_a_record(self):
        engine = BlockingStreamingEngine()
        session, _, terminal, captures = self.make_session(engine=engine)
        session.start()
        session.begin_audio_consumer()
        session.append_delta("取消します。")
        self.assertTrue(engine.started.wait(1.0))
        session.cancel("test cancellation")
        engine.release.set()

        self.assertEqual(self.drain_audio(session), [])
        status = self.wait_for_terminal(session, terminal)
        self.assertEqual(status["state"], "cancelled")
        self.assertIsNone(status["record"])
        self.assertNotIn("audio", captures)

    def test_late_cancellation_rolls_back_a_completed_callback(self):
        rolled_back = []

        def complete(session, _audio):
            session.cancel("late test cancellation")
            return {"saved": True}

        session, _, terminal, _ = self.make_session(
            on_complete=complete,
            on_abort_after_complete=lambda _session, record: rolled_back.append(record),
        )
        session.start()
        session.begin_audio_consumer()
        session.append_delta("最後に取消します。")
        session.complete()
        self.drain_audio(session)
        status = self.wait_for_terminal(session, terminal)

        self.assertEqual(status["state"], "cancelled")
        self.assertIsNone(status["record"])
        self.assertEqual(rolled_back, [{"saved": True}])

    def test_idle_and_missing_consumer_timeouts_leave_no_record(self):
        idle, _, idle_terminal, _ = self.make_session(idle_timeout_seconds=0.05)
        idle.start()
        idle_status = self.wait_for_terminal(idle, idle_terminal)
        self.assertEqual(idle_status["state"], "timed_out")
        self.assertIsNone(idle_status["record"])

        missing, _, missing_terminal, _ = self.make_session(
            audio_consumer_timeout_seconds=0.05
        )
        missing.start()
        missing.append_delta("接続待ちです。")
        missing.complete()
        missing_status = self.wait_for_terminal(missing, missing_terminal)
        self.assertEqual(missing_status["state"], "timed_out")
        self.assertIsNone(missing_status["record"])

    def test_invalid_input_and_completed_state_are_rejected(self):
        session, _, terminal, _ = self.make_session()
        session.start()
        session.begin_audio_consumer()
        with self.assertRaisesRegex(ValueError, "delta"):
            session.append_delta("")
        with self.assertRaisesRegex(ValueError, "delta"):
            session.append_delta(123)
        session.append_delta("終わります。")
        session.complete()
        with self.assertRaises(SpeechSessionStateError):
            session.append_delta("追加")
        self.drain_audio(session)
        self.wait_for_terminal(session, terminal)

    def test_manager_allows_only_one_active_session(self):
        manager = SpeechSessionManager()
        terminal = threading.Event()

        def terminal_callback(_session):
            terminal.set()

        first = manager.create(
            session_id="one",
            generation_id="one",
            filename="one.wav",
            payload=session_payload(),
            reference={},
            engine=FakeStreamingEngine(),
            sample_rate=24_000,
            started_at="2026-08-23T00:00:00+00:00",
            on_complete=lambda *_: {"saved": True},
            on_terminal=terminal_callback,
            idle_timeout_seconds=1.0,
        )
        with self.assertRaises(SpeechSessionBusyError):
            manager.create(
                session_id="two",
                generation_id="two",
                filename="two.wav",
                payload=session_payload(),
                reference={},
                engine=FakeStreamingEngine(),
                sample_rate=24_000,
                started_at="2026-08-23T00:00:00+00:00",
                on_complete=lambda *_: {"saved": True},
                on_terminal=lambda _session: None,
            )
        first.cancel()
        self.assertTrue(terminal.wait(1.0))
        deadline = time.monotonic() + 1.0
        while manager.active_session_id() is not None and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertIsNone(manager.active_session_id())


class SpeechSessionArtifactTests(unittest.TestCase):
    def test_successful_session_writes_a_streaming_manifest_with_input_mode(self):
        previous_outputs = server.OUTPUTS_DIR
        previous_metadata = server.METADATA_PATH
        try:
            with tempfile.TemporaryDirectory() as directory:
                server.OUTPUTS_DIR = Path(directory)
                server.METADATA_PATH = server.OUTPUTS_DIR / "metadata.json"
                final_path = server.OUTPUTS_DIR / "session.wav"
                temporary_path = server.OUTPUTS_DIR / ".session.tmp.wav"
                terminal = threading.Event()
                engine = FakeStreamingEngine(sample_rate=1000, packets_per_chunk=1)

                def complete(session, audio):
                    return server.finalize_speech_session(
                        session,
                        audio,
                        final_path=final_path,
                        temporary_path=temporary_path,
                        started_monotonic=time.perf_counter() - 0.1,
                    )

                class FakeSoundFile:
                    @staticmethod
                    def write(path, audio, sample_rate):
                        pcm = (
                            np.clip(audio, -1.0, 1.0) * 32767.0
                        ).astype("<i2", copy=False)
                        with wave.open(str(path), "wb") as output_wav:
                            output_wav.setnchannels(1)
                            output_wav.setsampwidth(2)
                            output_wav.setframerate(int(sample_rate))
                            output_wav.writeframes(pcm.tobytes())

                with mock.patch.dict(sys.modules, {"soundfile": FakeSoundFile}):
                    session = SpeechSession(
                        session_id="artifact-session",
                        generation_id="artifact-generation",
                        filename=final_path.name,
                        payload={**session_payload(), "output_retention": "archive"},
                        reference={"source": "test", "filename": "reference.wav"},
                        engine=engine,
                        sample_rate=1000,
                        started_at="2026-08-23T00:00:00+00:00",
                        on_complete=complete,
                        on_terminal=lambda _session: terminal.set(),
                    )
                    session.start()
                    session.begin_audio_consumer()
                    session.append_delta("保存します。")
                    session.complete()
                    while session.next_audio_packet() is not None:
                        continue
                    self.assertTrue(terminal.wait(1.0))

                self.assertTrue(final_path.is_file())
                with wave.open(str(final_path), "rb") as output_wav:
                    self.assertEqual(output_wav.getframerate(), 1000)
                    self.assertEqual(output_wav.getnframes(), 4)
                record = session.snapshot()["record"]
                self.assertEqual(record["generation"]["method"], "streaming")
                self.assertEqual(record["generation"]["input_mode"], "progressive_session")
                self.assertEqual(record["script"]["submitted_text"], "保存します。")
                self.assertEqual(record["chunks"]["items"][0]["start_sample"], 0)
                self.assertEqual(record["chunks"]["items"][0]["end_sample"], 4)
        finally:
            server.OUTPUTS_DIR = previous_outputs
            server.METADATA_PATH = previous_metadata


class SpeechSessionHttpTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.previous_outputs = server.OUTPUTS_DIR
        self.previous_metadata = server.METADATA_PATH
        self.previous_manager = server.SPEECH_SESSIONS
        self.previous_generation_lock = server.GENERATION_LOCK
        server.OUTPUTS_DIR = Path(self.directory.name)
        server.METADATA_PATH = server.OUTPUTS_DIR / "metadata.json"
        server.SPEECH_SESSIONS = SpeechSessionManager()
        server.GENERATION_LOCK = threading.Lock()
        self.engine = HttpStreamingEngine()
        self.get_engine_patch = mock.patch.object(server, "get_engine", return_value=self.engine)
        self.reference_patch = mock.patch.object(
            server,
            "decode_reference_audio",
            return_value=(
                Path("reference.wav"),
                {"source": "test", "filename": "reference.wav", "sha256": "TEST"},
                None,
            ),
        )
        soundfile = ModuleType("soundfile")
        soundfile.write = write_fake_wav
        self.soundfile_patch = mock.patch.dict(sys.modules, {"soundfile": soundfile})
        self.get_engine_patch.start()
        self.reference_patch.start()
        self.soundfile_patch.start()
        self.http_server = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.port = self.http_server.server_address[1]
        self.http_thread = threading.Thread(
            target=self.http_server.serve_forever,
            name="VoiceGenSpeechSessionHttpTest",
            daemon=True,
        )
        self.http_thread.start()

    def tearDown(self):
        session_id = server.SPEECH_SESSIONS.active_session_id()
        if session_id:
            session = server.SPEECH_SESSIONS.get(session_id)
            session.cancel("test cleanup")
            session._terminal_event.wait(2.0)
        self.http_server.shutdown()
        self.http_server.server_close()
        self.http_thread.join(2.0)
        self.soundfile_patch.stop()
        self.reference_patch.stop()
        self.get_engine_patch.stop()
        server.OUTPUTS_DIR = self.previous_outputs
        server.METADATA_PATH = self.previous_metadata
        server.SPEECH_SESSIONS = self.previous_manager
        server.GENERATION_LOCK = self.previous_generation_lock
        self.directory.cleanup()

    def request_json(self, method, path, payload=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3.0)
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        headers = {"Content-Type": "application/json"} if body is not None else {}
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        raw = response.read()
        data = json.loads(raw.decode("utf-8")) if raw else {}
        status = response.status
        response_headers = dict(response.getheaders())
        connection.close()
        return status, data, response_headers

    def open_audio_consumer(self, session_id):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3.0)
        connection.request("GET", f"/api/speech-sessions/{session_id}/audio")
        response = connection.getresponse()
        return connection, response

    def test_http_session_lifecycle_streams_pcm_and_writes_one_final_artifact(self):
        create_payload = {
            "output_retention": "archive",
            "mode": "voice-clone",
            "language": "Japanese",
            "seed": 31419,
            "cfg_value": 2,
            "inference_timesteps": 8,
            "max_len": 4096,
            "denoise": False,
        }
        status, created, _ = self.request_json("POST", "/api/speech-sessions", create_payload)
        self.assertEqual(status, 201)
        self.assertEqual(created["state"], "open")
        session_id = created["session_id"]

        busy_status, busy, _ = self.request_json("POST", "/api/speech-sessions", create_payload)
        self.assertEqual(busy_status, 409)
        self.assertIn("busy", busy["error"])

        audio_connection, audio_response = self.open_audio_consumer(session_id)
        self.assertEqual(audio_response.status, 200)
        self.assertEqual(audio_response.getheader("X-Sample-Rate"), "1000")
        self.assertEqual(audio_response.getheader("X-Audio-Format"), "pcm_s16le")

        invalid_status, invalid, _ = self.request_json(
            "POST", f"/api/speech-sessions/{session_id}/text", {"delta": 7}
        )
        self.assertEqual(invalid_status, 400)
        self.assertIn("delta", invalid["error"])

        first_status, first, _ = self.request_json(
            "POST", f"/api/speech-sessions/{session_id}/text", {"delta": "今日は"}
        )
        self.assertEqual(first_status, 202)
        self.assertEqual(first["queued_speech_chunks"], 0)
        second_status, second, _ = self.request_json(
            "POST", f"/api/speech-sessions/{session_id}/text", {"delta": "良い日です。"}
        )
        self.assertEqual(second_status, 202)
        self.assertEqual(second["queued_speech_chunks"], 1)
        complete_status, completing, _ = self.request_json(
            "POST", f"/api/speech-sessions/{session_id}/complete", {}
        )
        self.assertEqual(complete_status, 202)
        self.assertTrue(completing["completion_requested"])

        pcm = audio_response.read()
        audio_connection.close()
        self.assertEqual(len(pcm), 16)

        final_status, final, _ = self.request_json("GET", f"/api/speech-sessions/{session_id}")
        self.assertEqual(final_status, 200)
        self.assertEqual(final["state"], "completed")
        self.assertEqual(final["record"]["generation"]["method"], "streaming")
        self.assertEqual(final["record"]["generation"]["input_mode"], "progressive_session")
        self.assertEqual(final["record"]["chunks"]["items"][0]["text"], "今日は良い日です。")
        self.assertEqual(len(list(server.OUTPUTS_DIR.glob("*.wav"))), 1)
        self.assertEqual(len(list(server.OUTPUTS_DIR.glob("*.json"))), 2)

        missing_status, missing, _ = self.request_json("GET", "/api/speech-sessions/missing")
        self.assertEqual(missing_status, 404)
        self.assertIn("not found", missing["error"])

    def test_http_default_and_explicit_session_audio_do_not_touch_archives(self):
        legacy = {
            "old.wav": b"existing recording",
            "old.json": b'{"script":"preserve existing text"}',
            "metadata.json": b'{"legacy":"keep unchanged"}',
        }
        for name, contents in legacy.items():
            (server.OUTPUTS_DIR / name).write_bytes(contents)
        health_status, health, _ = self.request_json("GET", "/api/health")
        self.assertEqual(health_status, 200)
        self.assertIn("session", health["speech_sessions"]["output_retention"])
        for retention in ({}, {"output_retention": "session"}):
            with self.subTest(retention=retention):
                status, created, _ = self.request_json("POST", "/api/speech-sessions", {
                    "mode": "voice-clone", "language": "Japanese", **retention,
                })
                self.assertEqual(status, 201)
                session_id = created["session_id"]
                connection, response = self.open_audio_consumer(session_id)
                self.request_json("POST", f"/api/speech-sessions/{session_id}/text", {"delta": "Session only."})
                self.request_json("POST", f"/api/speech-sessions/{session_id}/complete", {})
                pcm = response.read()
                connection.close()
                self.assertGreater(len(pcm), 0)
                _, final, _ = self.request_json("GET", f"/api/speech-sessions/{session_id}")
                self.assertEqual(final["state"], "completed")
                self.assertFalse(final["record"]["persisted"])
                self.assertEqual(final["record"]["output_retention"], "session")
                self.assertEqual(final["record"]["audio_samples"] * 2, len(pcm))
                self.assertNotIn("filename", final["record"])
                self.assertEqual({p.name: p.read_bytes() for p in server.OUTPUTS_DIR.iterdir()}, legacy)

    def test_session_finalization_does_not_even_create_an_output_directory(self):
        previous_outputs = server.OUTPUTS_DIR
        try:
            server.OUTPUTS_DIR = previous_outputs / "not-created"
            fake_session = SimpleNamespace(cancel_requested=False, payload={}, generation_id="ephemeral", sample_rate=24000)
            with mock.patch.object(server, "save_output_record", side_effect=AssertionError("must not archive")):
                record = server.finalize_speech_session(
                    fake_session, np.zeros(4), final_path=server.OUTPUTS_DIR / "never.wav",
                    temporary_path=server.OUTPUTS_DIR / "never.tmp.wav", started_monotonic=time.perf_counter(),
                )
            self.assertFalse(record["persisted"])
            self.assertFalse(server.OUTPUTS_DIR.exists())
        finally:
            server.OUTPUTS_DIR = previous_outputs


class SpeechSessionRouteTests(unittest.TestCase):
    def test_session_retention_defaults_to_memory_and_rejects_ambiguous_values(self):
        self.assertEqual(server.validate_speech_session_payload({})["output_retention"], "session")
        self.assertEqual(server.validate_speech_session_payload({"output_retention": "archive"})["output_retention"], "archive")
        for value in (True, None, "", "false", "disk", [], {}):
            with self.assertRaisesRegex(ValueError, "output_retention"):
                server.validate_speech_session_payload({"output_retention": value})

    def test_routes_are_strict_and_include_each_session_operation(self):
        self.assertEqual(server.speech_session_route("/api/speech-sessions"), (None, None))
        self.assertEqual(
            server.speech_session_route("/api/speech-sessions/abc/audio"),
            ("abc", "audio"),
        )
        self.assertEqual(
            server.speech_session_route("/api/speech-sessions/abc/text"),
            ("abc", "text"),
        )
        self.assertIsNone(server.speech_session_route("/api/speech-sessions/abc/unknown"))

    def test_session_validation_allows_no_complete_text_but_not_auto_trim(self):
        payload = server.validate_speech_session_payload({"mode": "voice-clone"})
        self.assertEqual(payload["text"], "")
        with self.assertRaisesRegex(ValueError, "leading_silence_cleanup"):
            server.validate_speech_session_payload(
                {"leading_silence_cleanup": True}
            )


class DiscussionReferenceTests(unittest.TestCase):
    def test_clone_without_explicit_recording_has_no_character_fallback(self):
        payload = server.validate_generation_payload({"text": "Hello", "mode": "voice-clone"})
        with self.assertRaisesRegex(ValueError, "explicit ref_audio_base64"):
            server.decode_reference_audio(payload)

    def test_invalid_reference_fails_before_engine_or_temporary_file(self):
        import base64
        payload = server.validate_generation_payload({
            "text": "Hello", "mode": "voice-clone",
            "ref_audio_base64": base64.b64encode(b"not a PCM WAV").decode(),
        })
        with mock.patch.object(server.tempfile, "NamedTemporaryFile") as temporary:
            with self.assertRaisesRegex(ValueError, "PCM WAV"):
                server.decode_reference_audio(payload)
            temporary.assert_not_called()

    def test_oversized_script_and_legacy_character_mode_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "8000"):
            server.validate_generation_payload({"text": "a" * 8001})
        with self.assertRaisesRegex(ValueError, "unsupported mode"):
            server.validate_generation_payload({"text": "Hello", "mode": "chiyuki-clone"})


if __name__ == "__main__":
    unittest.main()
