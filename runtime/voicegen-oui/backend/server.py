# SPDX-License-Identifier: Apache-2.0
# Adapted/modified for Duo Voice Harness; see ../LICENSE, ../NOTICE and ../ORIGIN.md.
from __future__ import annotations

import base64
import copy
import hashlib
import json
import math
import mimetypes
import os
import re
import subprocess
import tempfile
import threading
import time
import uuid
import wave
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from speech_sessions import (
    SentenceChunker,
    SpeechSession,
    SpeechSessionBusyError,
    SpeechSessionCancelled,
    SpeechSessionManager,
    SpeechSessionNotFoundError,
    SpeechSessionStateError,
)

try:
    from voxcpm_engine import VoxCPMEngine

    VOXCPM_IMPORT_ERROR = None
except Exception as exc:  # pragma: no cover - depends on the WSL runtime
    VoxCPMEngine = None
    VOXCPM_IMPORT_ERROR = str(exc)

from gpu_runtime_control import cool_down_engine
from vram_telemetry import get_vram_telemetry


SERVICE_NAME = "duo-voice-harness-voice"
SCHEMA_VERSION = 2
ARTIFACT_KIND = "voicegen.generation-manifest"
SUPPORTED_MODES = {"voice-clone", "voice-directed", "voice-design"}
LANGUAGE_CODES = {
    "Arabic": "ar",
    "Burmese": "my",
    "Chinese": "zh",
    "Danish": "da",
    "Dutch": "nl",
    "English": "en",
    "Finnish": "fi",
    "French": "fr",
    "German": "de",
    "Greek": "el",
    "Hebrew": "he",
    "Hindi": "hi",
    "Indonesian": "id",
    "Italian": "it",
    "Japanese": "ja",
    "Khmer": "km",
    "Korean": "ko",
    "Lao": "lo",
    "Malay": "ms",
    "Norwegian": "no",
    "Polish": "pl",
    "Portuguese": "pt",
    "Russian": "ru",
    "Spanish": "es",
    "Swahili": "sw",
    "Swedish": "sv",
    "Tagalog": "tl",
    "Thai": "th",
    "Turkish": "tr",
    "Vietnamese": "vi",
    "Sichuanese Chinese": "zh-x-sichuanese",
    "Cantonese": "yue",
    "Wu Chinese": "wuu",
    "Northeastern Mandarin": "zh-x-northeastern",
    "Henan Dialect": "zh-x-henan",
    "Shaanxi Dialect": "zh-x-shaanxi",
    "Shandong Dialect": "zh-x-shandong",
    "Tianjin Dialect": "zh-x-tianjin",
    "Minnan": "nan",
}
LEADING_SILENCE_ALGORITHM = "rms-leading-silence-v1"
LEADING_SILENCE_RMS_THRESHOLD = 0.004
LEADING_SILENCE_WINDOW_SECONDS = 0.01
LEADING_SILENCE_MIN_ACTIVE_WINDOWS = 3
LEADING_SILENCE_PADDING_SECONDS = 0.25

ROOT = Path(__file__).resolve().parent
APP_ROOT = Path(
    os.environ.get("DUO_VOICE_APP_ROOT") or str(ROOT.parent)
).expanduser().resolve()
DATA_ROOT = Path(
    os.environ.get("DUO_VOICE_DATA_ROOT") or str(APP_ROOT.parent / "_runtime")
).expanduser().resolve()
OUTPUTS_DIR = Path(
    os.environ.get("DUO_VOICE_OUTPUTS_DIR") or str(DATA_ROOT / "outputs")
).expanduser().resolve()
MODEL_PATH = os.environ.get(
    "VOXCPM_MODEL_PATH", str(DATA_ROOT / "models" / "VoxCPM2")
)
METADATA_PATH = OUTPUTS_DIR / "metadata.json"

HOST = os.environ.get("DUO_VOICE_HOST", "127.0.0.1")
PORT = int(os.environ.get("DUO_VOICE_PORT", "3234"))
MAX_JSON_BODY = int(
    os.environ.get("DUO_VOICE_MAX_JSON_BODY", str(50 * 1024 * 1024))
)
ALLOWED_ORIGINS = {
    "null",
    f"http://localhost:{PORT}",
    f"http://127.0.0.1:{PORT}",
    f"http://[::1]:{PORT}",
}

ENGINE = None
ENGINE_INIT_LOCK = threading.Lock()
GENERATION_LOCK = threading.Lock()
VOICE_WARMUP = {"available": True, "state": "cold"}
METADATA_LOCK = threading.Lock()
SPEECH_SESSIONS = SpeechSessionManager()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest().upper()


def default_reference_status() -> dict[str, object]:
    return {
        "source": "explicit-session-profile",
        "required": True,
    }


def get_engine():
    global ENGINE
    if ENGINE is not None:
        return ENGINE
    if VoxCPMEngine is None:
        raise RuntimeError(f"VoxCPMEngine import failed: {VOXCPM_IMPORT_ERROR}")
    with ENGINE_INIT_LOCK:
        if ENGINE is None:
            ENGINE = VoxCPMEngine(MODEL_PATH)
    return ENGINE


def warm_voice(payload: dict) -> dict:
    """Exercise the streaming clone path without recording or serving audio."""
    global VOICE_WARMUP
    if not GENERATION_LOCK.acquire(blocking=False):
        raise SpeechSessionBusyError("the VoxCPM engine is busy")
    cleanup_path = None
    try:
        validated = validate_generation_payload({
            "text": "Hello.", "mode": "voice-clone", "language": "English",
            "ref_audio_base64": payload.get("ref_audio_base64"),
            "reference_profile": payload.get("reference_profile"),
            "cfg_value": 2, "inference_timesteps": 10, "max_len": 128,
            "seed": 82518, "denoise": False,
        })
        reference_path, reference, cleanup_path = decode_reference_audio(validated)
        VOICE_WARMUP = {"available": True, "state": "warming"}
        started = time.perf_counter()
        engine = get_engine()
        samples = 0
        for chunk, sample_rate in engine.generate_design_stream(
            text=validated["text"], language=validated["language"], instruct="",
            reference_wav_path=reference_path, cfg_value=2,
            inference_timesteps=10, max_len=128, denoise=False, seed=82518,
        ):
            samples += int(chunk.size)
            if samples > int(sample_rate) * 20:
                raise RuntimeError("voice warm-up exceeded its audio limit")
        if not samples:
            raise RuntimeError("voice warm-up returned no audio")
        VOICE_WARMUP = {
            "available": True, "state": "ready", "samples": samples,
            "completed_at": utc_now(), "elapsed_seconds": round(time.perf_counter() - started, 3),
            "reference_profile": validated["reference_profile"], "reference_sha256": reference["sha256"],
        }
        return {"status": "ok", "warmup": dict(VOICE_WARMUP)}
    except Exception:
        VOICE_WARMUP = {"available": True, "state": "failed"}
        raise
    finally:
        try:
            if cleanup_path is not None:
                cleanup_path.unlink(missing_ok=True)
        finally:
            GENERATION_LOCK.release()


def json_bytes(payload: object) -> bytes:
    return json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")


def read_body(handler: BaseHTTPRequestHandler) -> dict:
    length = int(handler.headers.get("Content-Length", "0") or "0")
    if length <= 0:
        return {}
    if length > MAX_JSON_BODY:
        raise ValueError(f"request body too large; limit is {MAX_JSON_BODY} bytes")
    raw = handler.rfile.read(length)
    if not raw:
        return {}
    payload = json.loads(raw.decode("utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("request body must be a JSON object")
    return payload


def atomic_write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    temporary.replace(path)


def load_metadata_index() -> dict[str, dict]:
    if not METADATA_PATH.is_file():
        return {}
    try:
        data = json.loads(METADATA_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def sidecar_path_for(wav_path: Path) -> Path:
    return wav_path.with_suffix(".json")


def is_v2_manifest(record: dict) -> bool:
    return (
        record.get("schema_version") == 2
        and record.get("artifact_kind") == ARTIFACT_KIND
        and isinstance(record.get("generation"), dict)
        and isinstance(record.get("audio"), dict)
    )


def record_generation_id(record: dict) -> str | None:
    if is_v2_manifest(record):
        return record["generation"].get("id")
    return record.get("generation_id")


def record_filename(record: dict) -> str | None:
    if is_v2_manifest(record):
        local = record.get("_local") if isinstance(record.get("_local"), dict) else {}
        return local.get("filename") or record["audio"].get("filename")
    return record.get("filename")


def output_record_from_file(path: Path, index: dict[str, dict]) -> dict:
    stat = path.stat()
    record: dict = {}
    sidecar = sidecar_path_for(path)
    if sidecar.is_file():
        try:
            candidate = json.loads(sidecar.read_text(encoding="utf-8"))
            if isinstance(candidate, dict):
                record = candidate
        except Exception:
            record = {}
    if not record and isinstance(index.get(path.name), dict):
        record = dict(index[path.name])
    if is_v2_manifest(record):
        result = dict(record)
        result["_local"] = {
            "filename": path.name,
            "url": f"/outputs/{path.name}",
            "download_url": f"/outputs/{path.name}?download=1",
            "size_bytes": stat.st_size,
        }
        return result
    merged = {
        "schema_version": 1,
        "generation_id": path.stem,
        "filename": path.name,
        "url": f"/outputs/{path.name}",
        "download_url": f"/outputs/{path.name}?download=1",
        "created_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
        "size_bytes": stat.st_size,
        "mode": "unknown",
        "text": "",
        "language": "",
        "voice_direction": "",
        "voice_design": "",
        "seed": None,
        "cfg_value": None,
        "inference_timesteps": None,
        "max_len": None,
        "denoise": False,
        "sample_rate": None,
        "segments": [],
    }
    merged.update(record)
    merged["filename"] = path.name
    merged["url"] = f"/outputs/{path.name}"
    merged["download_url"] = f"/outputs/{path.name}?download=1"
    merged["size_bytes"] = stat.st_size
    return merged


def list_output_records() -> list[dict]:
    if not OUTPUTS_DIR.is_dir():
        return []
    index = load_metadata_index()
    files = sorted(
        OUTPUTS_DIR.glob("*.wav"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    return [output_record_from_file(path, index) for path in files]


def save_output_record(wav_path: Path, record: dict) -> None:
    record = dict(record)
    if is_v2_manifest(record):
        record["audio"] = dict(record["audio"])
        record["audio"]["sha256"] = file_sha256(wav_path)
        record["audio"]["size_bytes"] = wav_path.stat().st_size
    else:
        record["audio_sha256"] = file_sha256(wav_path)
        record["size_bytes"] = wav_path.stat().st_size
    atomic_write_json(sidecar_path_for(wav_path), record)
    with METADATA_LOCK:
        index = load_metadata_index()
        index[wav_path.name] = record
        atomic_write_json(METADATA_PATH, index)


def remove_output_record(wav_path: Path) -> None:
    """Best-effort rollback for an output that could not be fully saved."""
    sidecar_path_for(wav_path).unlink(missing_ok=True)
    with METADATA_LOCK:
        index = load_metadata_index()
        if wav_path.name in index:
            index.pop(wav_path.name, None)
            atomic_write_json(METADATA_PATH, index)


def trim_number(payload: dict, name: str) -> float:
    value = payload.get(name)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a JSON number")
    number = float(value)
    if not math.isfinite(number):
        raise ValueError(f"{name} must be finite")
    return number


def trim_sample_range(
    payload: dict, sample_rate: int, frame_count: int
) -> tuple[float, float, int, int]:
    if sample_rate <= 0 or frame_count <= 0:
        raise ValueError("source WAV has no audio frames")
    start_seconds = trim_number(payload, "start_seconds")
    end_seconds = trim_number(payload, "end_seconds")
    duration_seconds = frame_count / float(sample_rate)
    tolerance_seconds = 0.5 / float(sample_rate)
    if start_seconds < 0:
        raise ValueError("start_seconds must be zero or greater")
    if end_seconds <= start_seconds:
        raise ValueError("end_seconds must be greater than start_seconds")
    if start_seconds > duration_seconds + tolerance_seconds:
        raise ValueError("start_seconds is beyond the source duration")
    if end_seconds > duration_seconds + tolerance_seconds:
        raise ValueError("end_seconds is beyond the source duration")

    start_sample = min(max(round(start_seconds * sample_rate), 0), frame_count)
    end_sample = min(max(round(end_seconds * sample_rate), 0), frame_count)
    if end_sample <= start_sample:
        raise ValueError("trim selection is empty after sample rounding")
    return start_seconds, end_seconds, start_sample, end_sample


def rebased_trim_chunks(
    source_record: dict, start_sample: int, end_sample: int
) -> tuple[str, list[dict]]:
    if is_v2_manifest(source_record):
        chunks = source_record.get("chunks") or {}
        kind = str(chunks.get("kind") or "unknown")
        items = chunks.get("items")
    else:
        kind = "legacy_generation_segments"
        items = source_record.get("segments")
    if not isinstance(items, list):
        return kind, []

    rebased: list[dict] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        try:
            item_start = int(item["start_sample"])
            item_end = int(item["end_sample"])
        except (KeyError, TypeError, ValueError):
            continue
        intersection_start = max(item_start, start_sample)
        intersection_end = min(item_end, end_sample)
        if intersection_end <= intersection_start:
            continue
        clipped = intersection_start != item_start or intersection_end != item_end
        result = dict(item)
        result["source_sequence"] = item.get("sequence")
        result["sequence"] = len(rebased)
        result["start_sample"] = intersection_start - start_sample
        result["end_sample"] = intersection_end - start_sample
        result["clipped"] = clipped
        rebased.append(result)
    return kind, rebased


def build_trim_record(
    source_record: dict,
    *,
    source_filename: str,
    source_sha256: str,
    generation_id: str,
    filename: str,
    sample_rate: int,
    channel_count: int,
    sample_count: int,
    source_format: str,
    source_subtype: str,
    requested_start_seconds: float,
    requested_end_seconds: float,
    start_sample: int,
    end_sample: int,
    processing_seconds: float,
) -> dict:
    source_is_v2 = is_v2_manifest(source_record)
    source_generation_id = record_generation_id(source_record) or Path(source_filename).stem
    source_script = (
        copy.deepcopy(source_record.get("script")) if source_is_v2 else {}
    )
    if not isinstance(source_script, dict):
        source_script = {}
    submitted_text = source_script.get("submitted_text") or source_record.get("text") or ""
    synthesized_text = source_script.get("synthesized_text") or submitted_text
    source_script["submitted_text"] = submitted_text
    source_script["synthesized_text"] = synthesized_text
    source_script.setdefault(
        "sha256", hashlib.sha256(submitted_text.encode("utf-8")).hexdigest().upper()
    )
    source_script["integrity"] = "unverified-after-trim"

    source_synthesis = (
        copy.deepcopy(source_record.get("synthesis")) if source_is_v2 else {}
    )
    if not isinstance(source_synthesis, dict):
        source_synthesis = {}
    if not source_synthesis:
        source_synthesis = {
            "mode": source_record.get("mode") or "unknown",
            "seed": source_record.get("seed"),
            "cfg_value": source_record.get("cfg_value"),
            "inference_timesteps": source_record.get("inference_timesteps"),
            "max_len": source_record.get("max_len"),
            "denoise_reference": source_record.get("denoise"),
            "voice_direction": source_record.get("voice_direction") or None,
            "voice_design": source_record.get("voice_design") or None,
        }
    chunks_kind, chunks = rebased_trim_chunks(source_record, start_sample, end_sample)
    return {
        "schema_version": SCHEMA_VERSION,
        "artifact_kind": ARTIFACT_KIND,
        "generation": {
            "id": generation_id,
            "method": "trim",
            "created_at": utc_now(),
            "producer": "Duo Voice Harness",
            "engine": "audio-editor",
        },
        "audio": {
            "filename": filename,
            "sha256": None,
            "size_bytes": None,
            "sample_rate_hz": sample_rate,
            "sample_count": sample_count,
            "duration_seconds": round(sample_count / float(sample_rate), 6),
            "channel_count": channel_count,
        },
        "script": source_script,
        "synthesis": source_synthesis,
        "reference": copy.deepcopy(source_record.get("reference") or {}),
        "chunks": {"kind": chunks_kind, "items": chunks},
        "metrics": {"trim_processing_seconds": round(processing_seconds, 6)},
        "derivation": {
            "operation": "trim",
            "source_generation_id": source_generation_id,
            "source_filename": source_filename,
            "source_audio_sha256": source_sha256,
            "source_manifest_schema_version": source_record.get("schema_version", 1),
            "requested_start_seconds": requested_start_seconds,
            "requested_end_seconds": requested_end_seconds,
            "applied_start_seconds": start_sample / float(sample_rate),
            "applied_end_seconds": end_sample / float(sample_rate),
            "start_sample": start_sample,
            "end_sample": end_sample,
            "source_format": source_format,
            "source_subtype": source_subtype,
        },
    }


def new_trim_paths() -> tuple[str, str, Path, Path]:
    generation_id = uuid.uuid4().hex[:12]
    filename = f"ai_discussion_voice_trim_{generation_id}.wav"
    final_path = OUTPUTS_DIR / filename
    temporary_path = OUTPUTS_DIR / f".{filename}.{uuid.uuid4().hex}.tmp.wav"
    return generation_id, filename, final_path, temporary_path


def trim_output(payload: dict) -> dict:
    """Create a sample-accurate, non-destructive trimmed WAV and manifest."""
    source_path = resolve_output(payload.get("generation_id") or payload.get("filename"))
    source_record = output_record_from_file(source_path, load_metadata_index())
    try:
        with wave.open(str(source_path), "rb") as source_wav:
            if source_wav.getcomptype() != "NONE":
                raise ValueError("trim currently supports uncompressed PCM WAV files only")
            sample_rate = source_wav.getframerate()
            frame_count = source_wav.getnframes()
            channel_count = source_wav.getnchannels()
            sample_width = source_wav.getsampwidth()
            source_params = source_wav.getparams()
            (
                requested_start_seconds,
                requested_end_seconds,
                start_sample,
                end_sample,
            ) = trim_sample_range(payload, sample_rate, frame_count)
            source_wav.setpos(start_sample)
            trimmed_frames = source_wav.readframes(end_sample - start_sample)
    except wave.Error as exc:
        raise ValueError(f"could not read source WAV: {exc}") from exc

    expected_bytes = (end_sample - start_sample) * channel_count * sample_width
    if len(trimmed_frames) != expected_bytes:
        raise RuntimeError("source WAV changed while it was being trimmed")
    generation_id, filename, final_path, temporary_path = new_trim_paths()
    started = time.perf_counter()
    final_created = False
    try:
        OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
        with wave.open(str(temporary_path), "wb") as trimmed_wav:
            trimmed_wav.setparams(source_params)
            trimmed_wav.writeframes(trimmed_frames)
        temporary_path.replace(final_path)
        final_created = True
        record = build_trim_record(
            source_record,
            source_filename=source_path.name,
            source_sha256=file_sha256(source_path),
            generation_id=generation_id,
            filename=filename,
            sample_rate=sample_rate,
            channel_count=channel_count,
            sample_count=end_sample - start_sample,
            source_format="WAV",
            source_subtype=f"PCM_{sample_width * 8}",
            requested_start_seconds=requested_start_seconds,
            requested_end_seconds=requested_end_seconds,
            start_sample=start_sample,
            end_sample=end_sample,
            processing_seconds=time.perf_counter() - started,
        )
        save_output_record(final_path, record)
        return {
            "status": "ok",
            "generation_id": generation_id,
            "filename": filename,
            "record": output_record_from_file(final_path, load_metadata_index()),
        }
    except Exception:
        temporary_path.unlink(missing_ok=True)
        if final_created:
            try:
                remove_output_record(final_path)
            except Exception:
                pass
            final_path.unlink(missing_ok=True)
        raise


def split_speech_chunks(text: str) -> list[str]:
    chunker = SentenceChunker()
    chunks = chunker.push(text)
    chunks.extend(chunker.finish())
    return chunks


def parse_number(payload: dict, key: str, default, cast, minimum, maximum):
    try:
        value = cast(payload.get(key, default))
    except (TypeError, ValueError):
        raise ValueError(f"{key} must be a valid {cast.__name__}")
    if value < minimum or value > maximum:
        raise ValueError(f"{key} must be between {minimum} and {maximum}")
    return value


def parse_boolean(payload: dict, key: str, default: bool = False) -> bool:
    value = payload.get(key, default)
    if not isinstance(value, bool):
        raise ValueError(f"{key} must be a boolean")
    return value


def validate_generation_payload(payload: dict, *, require_text: bool = True) -> dict:
    text = str(payload.get("text") or "").strip()
    if require_text and not text:
        raise ValueError("text is required")
    if len(text) > 8000:
        raise ValueError("text exceeds 8000 characters")
    mode = str(payload.get("mode") or "voice-clone").strip()
    if mode not in SUPPORTED_MODES:
        raise ValueError(f"unsupported mode: {mode}")
    language = str(payload.get("language") or "Japanese").strip() or "Japanese"
    voice_direction = str(payload.get("voice_direction") or "").strip()
    voice_design = str(payload.get("voice_design") or "").strip()
    if language not in LANGUAGE_CODES:
        print(f"[{SERVICE_NAME}] rejected unsupported voice language: {language[:80]!r}", flush=True)
        raise ValueError(f"unsupported voice language: {language[:80]!r}")
    if len(voice_direction) > 1000 or len(voice_design) > 1000:
        raise ValueError("voice direction exceeds 1000 characters")
    if mode == "voice-directed" and not voice_direction:
        raise ValueError("voice_direction is required for Clone + Direction")
    if mode == "voice-design" and not voice_design:
        raise ValueError("voice_design is required for Voice Design")
    narration_continuation = parse_boolean(payload, "narration_continuation", False)
    if narration_continuation and mode != "voice-clone":
        raise ValueError("reading continuation requires voice-clone without direction")
    single_utterance = parse_boolean(payload, "single_utterance", False)
    if single_utterance and narration_continuation:
        raise ValueError("a single utterance cannot use reading continuation")
    return {
        "text": text,
        "mode": mode,
        "narration_continuation": narration_continuation,
        "single_utterance": single_utterance,
        "language": language,
        "voice_direction": voice_direction if mode == "voice-directed" else "",
        "voice_design": voice_design if mode == "voice-design" else "",
        "ref_audio_base64": payload.get("ref_audio_base64")
        if mode in {"voice-clone", "voice-directed"}
        else None,
        "reference_profile": str(payload.get("reference_profile") or "")[:160],
        "seed": parse_number(payload, "seed", 31419, int, -1, 2_147_483_647),
        "cfg_value": parse_number(payload, "cfg_value", 2.0, float, 1.0, 3.0),
        "inference_timesteps": parse_number(
            payload, "inference_timesteps", 8, int, 1, 50
        ),
        "max_len": parse_number(payload, "max_len", 4096, int, 128, 32768),
        "denoise": bool(payload.get("denoise", False)),
        "leading_silence_cleanup": parse_boolean(
            payload, "leading_silence_cleanup", False
        ),
    }


def validate_speech_session_payload(payload: dict) -> dict:
    """Validate session synthesis settings without requiring a complete script."""
    validated = validate_generation_payload(payload, require_text=False)
    if validated["leading_silence_cleanup"]:
        raise ValueError("leading_silence_cleanup is unavailable for live speech sessions")
    validated["leading_silence_cleanup"] = False
    retention = payload.get("output_retention", "session")
    if retention not in ("session", "archive"):
        raise ValueError("output_retention must be session or archive")
    validated["output_retention"] = retention
    return validated


def decode_reference_audio(payload: dict) -> tuple[Path | None, dict, Path | None]:
    mode = payload["mode"]
    if mode == "voice-design":
        return None, {"source": "none", "filename": None, "sha256": None}, None
    encoded = payload.get("ref_audio_base64")
    if encoded:
        value = str(encoded)
        if "," in value and value.lstrip().startswith("data:"):
            value = value.split(",", 1)[1]
        try:
            raw = base64.b64decode(value, validate=True)
        except Exception as exc:
            raise ValueError(f"invalid reference audio: {exc}")
        if not raw:
            raise ValueError("session reference audio is empty")
        if len(raw) > 20 * 1024 * 1024:
            raise ValueError("reference audio exceeds 20 MiB")
        import io
        try:
            with wave.open(io.BytesIO(raw), "rb") as recording:
                if recording.getnframes() <= 0:
                    raise ValueError("reference WAV contains no audio")
                if recording.getnchannels() not in {1, 2}:
                    raise ValueError("reference WAV must have one or two channels")
        except (wave.Error, EOFError) as exc:
            raise ValueError("reference must be a PCM WAV recording") from exc
        temporary = tempfile.NamedTemporaryFile(
            prefix="duo-voice-reference-", suffix=".wav", delete=False
        )
        temporary.write(raw)
        temporary.close()
        path = Path(temporary.name)
        return (
            path,
            {
                "source": "session-override",
                "filename": payload.get("reference_profile") or "session-reference.wav",
                "sha256": hashlib.sha256(raw).hexdigest().upper(),
            },
            path,
        )
    raise ValueError("voice cloning requires explicit ref_audio_base64 from the selected profile")


def engine_instruction(payload: dict) -> str:
    if payload["mode"] == "voice-directed":
        return payload["voice_direction"]
    if payload["mode"] == "voice-design":
        return payload["voice_design"]
    return ""


def new_generation_paths() -> tuple[str, str, Path, Path]:
    generation_id = uuid.uuid4().hex[:12]
    filename = f"ai_discussion_voice_voxcpm_{generation_id}.wav"
    final_path = OUTPUTS_DIR / filename
    temporary_path = OUTPUTS_DIR / f".{filename}.{uuid.uuid4().hex}.tmp.wav"
    return generation_id, filename, final_path, temporary_path


def clean_leading_silence(audio, sample_rate: int, enabled: bool) -> tuple[object, dict]:
    """Retain a short lead-in before sustained audible audio, without changing speech."""
    import numpy as np

    samples = np.asarray(audio)
    if samples.ndim < 1:
        raise ValueError("generated audio must contain sample frames")
    frame_count = int(samples.shape[0])
    window_samples = max(1, round(sample_rate * LEADING_SILENCE_WINDOW_SECONDS))
    padding_samples = min(frame_count, round(sample_rate * LEADING_SILENCE_PADDING_SECONDS))
    metadata = {
        "leading_silence_cleanup": {
            "enabled": enabled,
            "algorithm": LEADING_SILENCE_ALGORITHM,
            "rms_threshold": LEADING_SILENCE_RMS_THRESHOLD,
            "analysis_window_seconds": LEADING_SILENCE_WINDOW_SECONDS,
            "minimum_active_windows": LEADING_SILENCE_MIN_ACTIVE_WINDOWS,
            "maximum_retained_leading_silence_seconds": LEADING_SILENCE_PADDING_SECONDS,
            "input_sample_count": frame_count,
            "removed_samples": 0,
            "removed_seconds": 0.0,
            "first_active_sample": None,
            "retained_leading_silence_seconds": None,
            "output_sample_count": frame_count,
        }
    }
    if not enabled or not frame_count:
        return samples, metadata

    if samples.ndim == 1:
        envelope = np.abs(samples)
    else:
        envelope = np.max(np.abs(samples), axis=tuple(range(1, samples.ndim)))
    first_active_sample = None
    active_windows = 0
    candidate_start = 0
    for start in range(0, frame_count, window_samples):
        end = min(start + window_samples, frame_count)
        window = envelope[start:end]
        rms = float(np.sqrt(np.mean(np.square(window, dtype=np.float64))))
        if rms >= LEADING_SILENCE_RMS_THRESHOLD:
            if not active_windows:
                candidate_start = start
            active_windows += 1
            if active_windows >= LEADING_SILENCE_MIN_ACTIVE_WINDOWS:
                first_active_sample = candidate_start
                break
        else:
            active_windows = 0

    details = metadata["leading_silence_cleanup"]
    details["first_active_sample"] = first_active_sample
    if first_active_sample is None:
        return samples, metadata
    removed_samples = max(0, first_active_sample - padding_samples)
    details["removed_samples"] = removed_samples
    details["removed_seconds"] = round(removed_samples / float(sample_rate), 6)
    details["retained_leading_silence_seconds"] = round(
        min(first_active_sample, padding_samples) / float(sample_rate), 6
    )
    details["output_sample_count"] = frame_count - removed_samples
    return samples[removed_samples:], metadata


def apply_leading_silence_cleanup(wav_path: Path, enabled: bool) -> tuple[object, dict]:
    """Apply optional cleanup while the generated WAV is still a private temp file."""
    import soundfile as sf

    source_info = sf.info(str(wav_path))
    if not enabled:
        _, metadata = clean_leading_silence(
            [], int(source_info.samplerate), enabled=False
        )
        metadata["leading_silence_cleanup"]["input_sample_count"] = int(source_info.frames)
        metadata["leading_silence_cleanup"]["output_sample_count"] = int(source_info.frames)
        return source_info, metadata

    audio, sample_rate = sf.read(str(wav_path), always_2d=False)
    cleaned_audio, metadata = clean_leading_silence(audio, int(sample_rate), enabled=True)
    if metadata["leading_silence_cleanup"]["removed_samples"]:
        replacement = wav_path.with_name(f".{wav_path.name}.{uuid.uuid4().hex}.cleanup.wav")
        try:
            sf.write(
                str(replacement),
                cleaned_audio,
                int(sample_rate),
                format=source_info.format,
                subtype=source_info.subtype,
            )
            replacement.replace(wav_path)
        finally:
            replacement.unlink(missing_ok=True)
    return sf.info(str(wav_path)), metadata


def build_generation_record(
    payload: dict,
    generation_id: str,
    filename: str,
    reference: dict,
    sample_rate: int,
    segments: list[dict],
    started_at: str,
    elapsed_seconds: float,
    first_audio_seconds: float | None,
    audio_samples: int,
    iteration_rate: float | None = None,
    generation_method: str = "standard",
    postprocess: dict | None = None,
    input_mode: str | None = None,
) -> dict:
    audio_seconds = audio_samples / float(sample_rate) if sample_rate else 0.0
    created_at = utc_now()
    script_sha256 = hashlib.sha256(payload["text"].encode("utf-8")).hexdigest().upper()
    streamed = generation_method == "streaming"
    record = {
        "schema_version": SCHEMA_VERSION,
        "artifact_kind": ARTIFACT_KIND,
        "generation": {
            "id": generation_id,
            "method": generation_method,
            "created_at": created_at,
            "started_at": started_at,
            "producer": "Duo Voice Harness",
            "engine": "VoxCPM2",
        },
        "audio": {
            "filename": filename,
            "sha256": None,
            "size_bytes": None,
            "sample_rate_hz": sample_rate,
            "sample_count": audio_samples,
            "duration_seconds": round(audio_seconds, 4),
        },
        "script": {
            "submitted_text": payload["text"],
            "synthesized_text": payload["text"],
            "language": LANGUAGE_CODES.get(payload["language"], "und"),
            "language_label": payload["language"],
            "sha256": script_sha256,
        },
        "synthesis": {
            "mode": payload["mode"],
            "seed": payload["seed"],
            "cfg_value": payload["cfg_value"],
            "inference_timesteps": payload["inference_timesteps"],
            "max_len": payload["max_len"],
            "denoise_reference": payload["denoise"],
            "voice_direction": payload["voice_direction"] or None,
            "voice_design": payload["voice_design"] or None,
            "narration_continuation": payload.get("narration_continuation", False),
        },
        "reference": reference,
        "chunks": {
            "kind": "streaming_generation_chunks" if streamed else "whole_text_generation",
            "items": segments,
        },
        "metrics": {
            "elapsed_seconds": round(elapsed_seconds, 4),
            "time_to_first_audio_seconds": round(first_audio_seconds, 4)
            if first_audio_seconds is not None
            else None,
            "real_time_factor": round(elapsed_seconds / audio_seconds, 4)
            if audio_seconds > 0
            else None,
            "iteration_rate": round(float(iteration_rate), 2) if iteration_rate else None,
        },
    }
    if postprocess is not None:
        record["postprocess"] = postprocess
    if input_mode:
        record["generation"]["input_mode"] = input_mode
    return record


def speech_session_urls(session_id: str) -> dict[str, str]:
    base = f"/api/speech-sessions/{session_id}"
    return {
        "status_url": base,
        "text_url": f"{base}/text",
        "complete_url": f"{base}/complete",
        "cancel_url": f"{base}/cancel",
        "audio_url": f"{base}/audio",
    }


def speech_session_payload(session: SpeechSession) -> dict[str, object]:
    return {"status": "ok", **session.snapshot(), **speech_session_urls(session.session_id)}


def speech_session_route(path: str) -> tuple[str | None, str | None] | None:
    base = "/api/speech-sessions"
    if path == base:
        return None, None
    if not path.startswith(f"{base}/"):
        return None
    parts = path[len(base) + 1 :].split("/")
    if len(parts) == 1 and parts[0]:
        return parts[0], None
    if len(parts) == 2 and parts[0] and parts[1] in {"text", "complete", "cancel", "audio"}:
        return parts[0], parts[1]
    return None


def finalize_speech_session(
    session: SpeechSession,
    full_audio,
    *,
    final_path: Path,
    temporary_path: Path,
    started_monotonic: float,
) -> dict[str, object]:
    """Archive only when explicitly requested; session audio is streamed, not saved."""
    if session.cancel_requested:
        raise SpeechSessionCancelled("speech session was cancelled")
    if session.payload.get("output_retention", "session") == "session":
        return {
            "id": session.generation_id,
            "output_retention": "session",
            "persisted": False,
            "sample_rate": session.sample_rate,
            "audio_samples": int(full_audio.size),
        }

    import soundfile as sf

    final_created = False
    try:
        if session.cancel_requested:
            raise SpeechSessionCancelled("speech session was cancelled")
        OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
        sf.write(str(temporary_path), full_audio, session.sample_rate)
        if session.cancel_requested:
            raise SpeechSessionCancelled("speech session was cancelled")
        temporary_path.replace(final_path)
        final_created = True
        if session.cancel_requested:
            raise SpeechSessionCancelled("speech session was cancelled")
        manifest_payload = {
            key: value
            for key, value in session.payload.items()
            if key != "reference_wav_path"
        }
        manifest_payload["text"] = session.submitted_text
        record = build_generation_record(
            payload=manifest_payload,
            generation_id=session.generation_id,
            filename=session.filename,
            reference=session.reference,
            sample_rate=session.sample_rate,
            segments=session.speech_chunks,
            started_at=session.started_at,
            elapsed_seconds=time.perf_counter() - started_monotonic,
            first_audio_seconds=session.first_audio_seconds,
            audio_samples=int(full_audio.size),
            generation_method="streaming",
            input_mode="progressive_session",
        )
        save_output_record(final_path, record)
        if session.cancel_requested:
            raise SpeechSessionCancelled("speech session was cancelled")
        return output_record_from_file(final_path, load_metadata_index())
    except Exception:
        temporary_path.unlink(missing_ok=True)
        if final_created:
            try:
                remove_output_record(final_path)
            except Exception:
                pass
            final_path.unlink(missing_ok=True)
        raise


def create_speech_session(payload: dict) -> SpeechSession:
    """Reserve VoxCPM for a progressive local text producer and audio consumer."""
    validated = validate_speech_session_payload(payload)
    if not GENERATION_LOCK.acquire(blocking=False):
        raise SpeechSessionBusyError("the VoxCPM engine is busy")

    cleanup_path: Path | None = None
    temporary_path: Path | None = None
    final_path: Path | None = None
    try:
        reference_path, reference, cleanup_path = decode_reference_audio(validated)
        engine = get_engine()
        sample_rate = int(engine.model.tts_model.sample_rate)
        generation_id, filename, final_path, temporary_path = new_generation_paths()
        started_at = utc_now()
        started_monotonic = time.perf_counter()
        session_id = uuid.uuid4().hex
        session_payload = dict(validated)
        session_payload["reference_wav_path"] = reference_path

        def on_complete(session: SpeechSession, full_audio) -> dict[str, object]:
            return finalize_speech_session(
                session,
                full_audio,
                final_path=final_path,
                temporary_path=temporary_path,
                started_monotonic=started_monotonic,
            )

        def on_terminal(_session: SpeechSession) -> None:
            temporary_path.unlink(missing_ok=True)
            if cleanup_path:
                cleanup_path.unlink(missing_ok=True)
            try:
                GENERATION_LOCK.release()
            except RuntimeError:
                pass

        def on_abort_after_complete(
            _session: SpeechSession, _record: dict[str, object]
        ) -> None:
            if validated["output_retention"] == "session":
                return
            temporary_path.unlink(missing_ok=True)
            try:
                remove_output_record(final_path)
            except Exception:
                pass
            final_path.unlink(missing_ok=True)

        return SPEECH_SESSIONS.create(
            session_id=session_id,
            generation_id=generation_id,
            filename=filename,
            payload=session_payload,
            reference=reference,
            engine=engine,
            sample_rate=sample_rate,
            started_at=started_at,
            on_complete=on_complete,
            on_terminal=on_terminal,
            on_abort_after_complete=on_abort_after_complete,
        )
    except Exception:
        if temporary_path:
            temporary_path.unlink(missing_ok=True)
        if final_path:
            final_path.unlink(missing_ok=True)
        if cleanup_path:
            cleanup_path.unlink(missing_ok=True)
        try:
            GENERATION_LOCK.release()
        except RuntimeError:
            pass
        raise


def resolve_output(identifier: str) -> Path:
    identifier = str(identifier or "").strip()
    if not identifier:
        raise ValueError("generation_id or filename is required")
    records = list_output_records()
    record = next(
        (
            item
            for item in records
            if record_generation_id(item) == identifier or record_filename(item) == identifier
        ),
        None,
    )
    if not record:
        raise FileNotFoundError(identifier)
    filename = str(record_filename(record))
    if Path(filename).name != filename or not filename.lower().endswith(".wav"):
        raise ValueError("invalid output filename")
    target = (OUTPUTS_DIR / filename).resolve()
    target.relative_to(OUTPUTS_DIR.resolve())
    if not target.is_file():
        raise FileNotFoundError(filename)
    return target


def windows_path(path: Path) -> str:
    value = str(path.resolve())
    if os.name == "nt":
        return value
    match = re.match(r"^/mnt/([a-zA-Z])/(.*)$", value)
    if not match:
        raise RuntimeError("output path is not on a Windows-mounted drive")
    rest = match.group(2).replace("/", "\\")
    return f"{match.group(1).upper()}:\\{rest}"


class Handler(BaseHTTPRequestHandler):
    server_version = "AIDiscussionVoice/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, format_string, *args):
        print(f"[{self.log_date_time_string()}] {format_string % args}")

    def allowed_origin(self):
        origin = self.headers.get("Origin")
        if not origin:
            return None
        return origin if origin in ALLOWED_ORIGINS else None

    def add_common_headers(self):
        self.send_header("Cache-Control", "no-store")
        allowed_origin = self.allowed_origin()
        if allowed_origin:
            self.send_header("Access-Control-Allow-Origin", allowed_origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header(
            "Access-Control-Expose-Headers",
            "X-Sample-Rate, X-Audio-Format, X-Output-Filename, "
            "X-Generation-Id, X-Iteration-Rate, X-Speech-Chunk-Count, "
            "X-Speech-Session-Id",
        )

    def send_payload(self, status, body, content_type, extra_headers=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.add_common_headers()
        for key, value in (extra_headers or {}).items():
            self.send_header(key, str(value))
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, payload, status=200, extra_headers=None):
        self.send_payload(
            status,
            json_bytes(payload),
            "application/json; charset=utf-8",
            extra_headers,
        )

    def send_error_json(self, status, message):
        self.send_json({"status": "error", "error": str(message)}, status=status)

    def serve_file(self, relative_path: str):
        target = (APP_ROOT / relative_path.lstrip("/")).resolve()
        try:
            target.relative_to(APP_ROOT)
        except ValueError:
            return self.send_error_json(403, "Forbidden")
        if not target.is_file():
            return self.send_error_json(404, "Not found")
        mime = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        return self.send_payload(200, target.read_bytes(), mime)

    def do_OPTIONS(self):
        self.send_response(204)
        self.add_common_headers()
        self.end_headers()

    def stream_speech_session_audio(self, session: SpeechSession):
        session.begin_audio_consumer()
        disconnected = True
        stream_open = False
        try:
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Transfer-Encoding", "chunked")
            self.send_header("X-Sample-Rate", str(session.sample_rate))
            self.send_header("X-Audio-Format", "pcm_s16le")
            self.send_header("X-Generation-Id", session.generation_id)
            self.send_header("X-Output-Filename", session.filename)
            self.send_header("X-Speech-Session-Id", session.session_id)
            self.add_common_headers()
            self.end_headers()
            stream_open = True
            while True:
                packet = session.next_audio_packet()
                if packet is None:
                    break
                data = packet.pcm_s16le
                self.wfile.write(f"{len(data):X}\r\n".encode("ascii"))
                self.wfile.write(data)
                self.wfile.write(b"\r\n")
                self.wfile.flush()
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()
            disconnected = False
        except (BrokenPipeError, ConnectionResetError):
            print(
                f"[{SERVICE_NAME}] speech session audio consumer disconnected: "
                f"{session.session_id}"
            )
        except Exception as exc:
            if stream_open:
                print(
                    f"[{SERVICE_NAME}] speech session audio stream failed "
                    f"{session.session_id}: {type(exc).__name__}: {exc}"
                )
            else:
                raise
        finally:
            session.end_audio_consumer(disconnected=disconnected)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        if path in {"/", "/index.html"}:
            return self.serve_file("index.html")
        if path == "/favicon.ico":
            return self.send_error_json(404, "No frontend assets are served by this backend")
        if path.startswith("/_frontend/"):
            return self.serve_file(path)
        if path == "/api/health":
            reference = default_reference_status()
            payload = {
                "status": "ok",
                "service": SERVICE_NAME,
                "loaded": ENGINE is not None,
                "busy": GENERATION_LOCK.locked(),
                "warmup": dict(VOICE_WARMUP),
                "model_source": "VoxCPM2",
                "supported_modes": sorted(SUPPORTED_MODES),
                "model_path": MODEL_PATH,
                "supported_languages": list(LANGUAGE_CODES.keys()),
                "supported_language_count": len(LANGUAGE_CODES),
                "app_root": str(APP_ROOT),
                "data_root": str(DATA_ROOT),
                "outputs_dir": str(OUTPUTS_DIR),
                "default_reference": reference,
                "voxcpm_import_ok": VoxCPMEngine is not None,
                "streaming": True,
                "speech_sessions": {
                    "available": True,
                    "narration_continuation": True,
                    "single_utterance": True,
                    "output_retention": ["session", "archive"],
                    "endpoint": "/api/speech-sessions",
                    "input_mode": "progressive_session",
                    "audio_format": "pcm_s16le",
                    "active_session_id": SPEECH_SESSIONS.active_session_id(),
                },
                "manifest_schema_version": SCHEMA_VERSION,
                "audio_trim": {
                    "available": True,
                    "endpoint": "/api/outputs/trim",
                    "source_lookup": "/api/outputs",
                    "operation": "non-destructive PCM WAV frame trim",
                },
                "leading_silence_cleanup": {
                    "available": True,
                    "generation_endpoint": "/api/generate",
                    "request_field": "leading_silence_cleanup",
                    "streaming_supported": False,
                    "maximum_retained_leading_silence_seconds": LEADING_SILENCE_PADDING_SECONDS,
                },
            }
            if ENGINE is not None:
                payload["sample_rate"] = getattr(
                    ENGINE.model.tts_model, "sample_rate", None
                )
            return self.send_json(payload)
        if path == "/api/vram":
            try:
                return self.send_json({"status": "ok", **get_vram_telemetry()})
            except Exception as exc:
                return self.send_error_json(500, f"{type(exc).__name__}: {exc}")
        if path == "/api/outputs":
            return self.send_json(list_output_records())
        session_route = speech_session_route(path)
        if session_route is not None:
            session_id, action = session_route
            if not session_id:
                return self.send_error_json(404, "Use POST /api/speech-sessions to create a session")
            try:
                session = SPEECH_SESSIONS.get(session_id)
                if action is None:
                    return self.send_json(speech_session_payload(session))
                if action == "audio":
                    return self.stream_speech_session_audio(session)
                return self.send_error_json(404, "Not found")
            except SpeechSessionNotFoundError as exc:
                return self.send_error_json(404, exc)
            except (SpeechSessionStateError, SpeechSessionCancelled) as exc:
                return self.send_error_json(409, exc)
            except Exception as exc:
                return self.send_error_json(500, f"{type(exc).__name__}: {exc}")
        if path.startswith("/outputs/"):
            filename = path[len("/outputs/") :]
            try:
                target = resolve_output(filename)
            except FileNotFoundError:
                return self.send_error_json(404, "Not found")
            except Exception as exc:
                return self.send_error_json(403, exc)
            disposition = "attachment" if parse_qs(parsed.query).get("download") else "inline"
            return self.send_payload(
                200,
                target.read_bytes(),
                "audio/wav",
                {"Content-Disposition": f'{disposition}; filename="{target.name}"'},
            )
        return self.send_error_json(404, "Not found")

    def do_POST(self):
        path = unquote(urlparse(self.path).path)
        if path == "/api/warmup":
            try:
                return self.send_json(warm_voice(read_body(self)))
            except SpeechSessionBusyError as exc:
                return self.send_error_json(409, exc)
            except ValueError as exc:
                return self.send_error_json(400, exc)
            except Exception as exc:
                return self.send_error_json(500, f"{type(exc).__name__}: {exc}")
        if path == "/api/speech-sessions":
            try:
                session = create_speech_session(read_body(self))
                return self.send_json(speech_session_payload(session), status=201)
            except SpeechSessionBusyError as exc:
                return self.send_error_json(409, exc)
            except ValueError as exc:
                return self.send_error_json(400, exc)
            except Exception as exc:
                return self.send_error_json(500, f"{type(exc).__name__}: {exc}")
        session_route = speech_session_route(path)
        if session_route is not None:
            session_id, action = session_route
            if not session_id or action not in {"text", "complete", "cancel"}:
                return self.send_error_json(404, "Not found")
            try:
                session = SPEECH_SESSIONS.get(session_id)
                if action == "text":
                    result = session.append_delta(read_body(self).get("delta"))
                    return self.send_json({"status": "ok", **result}, status=202)
                if action == "complete":
                    read_body(self)
                    return self.send_json(
                        {"status": "ok", **session.complete()}, status=202
                    )
                read_body(self)
                return self.send_json(
                    {"status": "ok", **session.cancel()}, status=202
                )
            except SpeechSessionNotFoundError as exc:
                return self.send_error_json(404, exc)
            except (SpeechSessionStateError, SpeechSessionCancelled) as exc:
                return self.send_error_json(409, exc)
            except ValueError as exc:
                return self.send_error_json(400, exc)
            except Exception as exc:
                return self.send_error_json(500, f"{type(exc).__name__}: {exc}")
        if path == "/api/vram/unload":
            global ENGINE
            try:
                # Studio sends no body, but consume an optional one so a
                # loopback proxy cannot leave bytes on this HTTP connection.
                read_body(self)
                if GENERATION_LOCK.locked():
                    return self.send_error_json(409, "generation is currently active")
                with ENGINE_INIT_LOCK:
                    engine_ref = ENGINE
                    ENGINE = None
                result = cool_down_engine(engine_ref, restart_process=True)
                result["message"] = "VoiceGen is restarting to release the model and GPU context. The next reply will warm one fresh model."
                return self.send_json(
                    {"status": "ok", **result}
                )
            except Exception as exc:
                return self.send_error_json(500, f"{type(exc).__name__}: {exc}")
        if path == "/api/outputs/reveal":
            try:
                payload = read_body(self)
                target = resolve_output(
                    payload.get("generation_id") or payload.get("filename")
                )
                selected = windows_path(target)
                subprocess.Popen(
                    ["explorer.exe", f"/select,{selected}"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                return self.send_json(
                    {"status": "ok", "filename": target.name, "selected": selected}
                )
            except FileNotFoundError as exc:
                return self.send_error_json(404, exc)
            except Exception as exc:
                return self.send_error_json(400, exc)
        if path == "/api/outputs/trim":
            try:
                return self.send_json(trim_output(read_body(self)))
            except FileNotFoundError as exc:
                return self.send_error_json(404, exc)
            except Exception as exc:
                return self.send_error_json(400, exc)
        if path not in {"/api/generate", "/api/generate_stream"}:
            return self.send_error_json(404, "Not found")
        try:
            payload = validate_generation_payload(read_body(self))
        except Exception as exc:
            return self.send_error_json(400, exc)
        if not GENERATION_LOCK.acquire(blocking=False):
            return self.send_error_json(409, "the VoxCPM engine is busy")
        try:
            if path == "/api/generate_stream":
                return self.generate_stream(payload)
            return self.generate_file(payload)
        finally:
            GENERATION_LOCK.release()

    def generate_file(self, payload: dict):
        import soundfile as sf

        reference_path = None
        cleanup_path = None
        generation_id, filename, final_path, temporary_path = new_generation_paths()
        started_at = utc_now()
        started = time.perf_counter()
        try:
            reference_path, reference, cleanup_path = decode_reference_audio(payload)
            engine = get_engine()
            OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
            output_path, sample_rate, iteration_rate = engine.generate_design(
                text=payload["text"],
                language=payload["language"],
                instruct=engine_instruction(payload),
                reference_wav_path=reference_path,
                output_path=temporary_path,
                cfg_value=payload["cfg_value"],
                inference_timesteps=payload["inference_timesteps"],
                denoise=payload["denoise"],
                max_len=payload["max_len"],
                seed=payload["seed"],
            )
            produced = Path(output_path)
            info, postprocess = apply_leading_silence_cleanup(
                produced, payload["leading_silence_cleanup"]
            )
            produced.replace(final_path)
            elapsed = time.perf_counter() - started
            record = build_generation_record(
                payload,
                generation_id,
                filename,
                reference,
                int(info.samplerate),
                [
                    {
                        "sequence": 0,
                        "text": payload["text"],
                        "start_sample": 0,
                        "end_sample": int(info.frames),
                    }
                ],
                started_at,
                elapsed,
                elapsed,
                int(info.frames),
                iteration_rate,
                generation_method="standard",
                postprocess=postprocess,
            )
            save_output_record(final_path, record)
            return self.send_payload(
                200,
                final_path.read_bytes(),
                "audio/wav",
                {
                    "X-Generation-Id": generation_id,
                    "X-Output-Filename": filename,
                    "X-Sample-Rate": sample_rate,
                    "X-Audio-Format": "wav",
                    "X-Iteration-Rate": iteration_rate or "",
                },
            )
        except Exception as exc:
            temporary_path.unlink(missing_ok=True)
            final_path.unlink(missing_ok=True)
            return self.send_error_json(500, f"{type(exc).__name__}: {exc}")
        finally:
            if cleanup_path:
                cleanup_path.unlink(missing_ok=True)

    def generate_stream(self, payload: dict):
        import numpy as np
        import soundfile as sf

        reference_path = None
        cleanup_path = None
        generation_id, filename, final_path, temporary_path = new_generation_paths()
        started_at = utc_now()
        started = time.perf_counter()
        first_audio_seconds = None
        stream_open = False
        completed = False
        all_chunks = []
        segments = []
        try:
            reference_path, reference, cleanup_path = decode_reference_audio(payload)
            engine = get_engine()
            sample_rate = int(engine.model.tts_model.sample_rate)
            speech_chunks = split_speech_chunks(payload["text"])
            if not speech_chunks:
                raise ValueError("text did not contain a speakable chunk")

            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Transfer-Encoding", "chunked")
            self.send_header("X-Sample-Rate", str(sample_rate))
            self.send_header("X-Audio-Format", "pcm_s16le")
            self.send_header("X-Generation-Id", generation_id)
            self.send_header("X-Output-Filename", filename)
            self.send_header("X-Speech-Chunk-Count", str(len(speech_chunks)))
            self.add_common_headers()
            self.end_headers()
            stream_open = True

            sample_cursor = 0
            for sequence, speech_text in enumerate(speech_chunks):
                segment_start = sample_cursor
                for audio_chunk, chunk_sample_rate in engine.generate_design_stream(
                    text=speech_text,
                    language=payload["language"],
                    instruct=engine_instruction(payload),
                    reference_wav_path=reference_path,
                    cfg_value=payload["cfg_value"],
                    inference_timesteps=payload["inference_timesteps"],
                    denoise=payload["denoise"],
                    max_len=payload["max_len"],
                    seed=payload["seed"],
                ):
                    if int(chunk_sample_rate) != sample_rate:
                        raise RuntimeError("sample rate changed during generation")
                    normalized = np.asarray(audio_chunk, dtype=np.float32).reshape(-1)
                    if normalized.size == 0:
                        continue
                    if first_audio_seconds is None:
                        first_audio_seconds = time.perf_counter() - started
                    all_chunks.append(normalized)
                    sample_cursor += int(normalized.size)
                    pcm = np.clip(normalized, -1.0, 1.0)
                    data = (pcm * 32767.0).astype("<i2", copy=False).tobytes()
                    self.wfile.write(f"{len(data):X}\r\n".encode("ascii"))
                    self.wfile.write(data)
                    self.wfile.write(b"\r\n")
                    self.wfile.flush()
                segments.append(
                    {
                        "sequence": sequence,
                        "text": speech_text,
                        "start_sample": segment_start,
                        "end_sample": sample_cursor,
                    }
                )

            if not all_chunks:
                raise RuntimeError("VoxCPM returned no audio")
            full_audio = np.concatenate(all_chunks)
            OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
            sf.write(str(temporary_path), full_audio, sample_rate)
            temporary_path.replace(final_path)
            elapsed = time.perf_counter() - started
            record = build_generation_record(
                payload,
                generation_id,
                filename,
                reference,
                sample_rate,
                segments,
                started_at,
                elapsed,
                first_audio_seconds,
                int(full_audio.size),
                generation_method="streaming",
            )
            save_output_record(final_path, record)
            completed = True
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()
            return None
        except (BrokenPipeError, ConnectionResetError):
            print(f"[{SERVICE_NAME}] stream cancelled by client: {generation_id}")
            return None
        except Exception as exc:
            print(f"[{SERVICE_NAME}] stream failed {generation_id}: {type(exc).__name__}: {exc}")
            if not stream_open:
                return self.send_error_json(500, f"{type(exc).__name__}: {exc}")
            return None
        finally:
            if not completed:
                temporary_path.unlink(missing_ok=True)
                final_path.unlink(missing_ok=True)
            if cleanup_path:
                cleanup_path.unlink(missing_ok=True)


def main() -> None:
    OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
    print("====================================================")
    print("Duo Voice Harness")
    print(f"App:       {APP_ROOT}")
    print(f"Data:      {DATA_ROOT}")
    print(f"Outputs:   {OUTPUTS_DIR}")
    print(f"Model:     {MODEL_PATH}")
    print("Reference: explicit session profile (no character default)")
    print(f"Listening: http://{HOST}:{PORT}")
    print("====================================================")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
