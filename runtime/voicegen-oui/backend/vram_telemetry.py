# SPDX-License-Identifier: Apache-2.0
# Adapted/modified for Duo Voice Harness; see ../LICENSE, ../NOTICE and ../ORIGIN.md.
import os


GIB = 1024 ** 3
DEFAULT_REQUIRED_GIB = float(os.environ.get("VOICEGEN_OUI_VRAM_REQUIRED_GIB") or os.environ.get("WAIFUVOICE_VRAM_REQUIRED_GIB") or "7.0")


def _round_gib(value):
    if value is None:
        return None
    return round(value / GIB, 2)


def get_vram_telemetry():
    required_bytes = int(DEFAULT_REQUIRED_GIB * GIB)
    payload = {
        "available": False,
        "provider": "torch.cuda",
        "device_index": 0,
        "device_name": None,
        "free_bytes": None,
        "total_bytes": None,
        "used_bytes": None,
        "allocated_bytes": None,
        "reserved_bytes": None,
        "estimated_required_bytes": required_bytes,
        "estimated_required_gib": round(DEFAULT_REQUIRED_GIB, 2),
        "warning": False,
        "reason": "",
    }

    try:
        import torch
    except Exception as exc:
        payload["reason"] = f"torch import failed: {type(exc).__name__}: {exc}"
        return payload

    try:
        if not torch.cuda.is_available():
            payload["reason"] = "torch.cuda is not available"
            return payload

        free_bytes, total_bytes = torch.cuda.mem_get_info(0)
        used_bytes = total_bytes - free_bytes
        allocated_bytes = torch.cuda.memory_allocated(0)
        reserved_bytes = torch.cuda.memory_reserved(0)

        payload.update({
            "available": True,
            "device_name": torch.cuda.get_device_name(0),
            "free_bytes": int(free_bytes),
            "total_bytes": int(total_bytes),
            "used_bytes": int(used_bytes),
            "allocated_bytes": int(allocated_bytes),
            "reserved_bytes": int(reserved_bytes),
            "free_gib": _round_gib(free_bytes),
            "total_gib": _round_gib(total_bytes),
            "used_gib": _round_gib(used_bytes),
            "allocated_gib": _round_gib(allocated_bytes),
            "reserved_gib": _round_gib(reserved_bytes),
            "warning": free_bytes < required_bytes,
            "reason": "",
        })
    except Exception as exc:
        payload["reason"] = f"telemetry failed: {type(exc).__name__}: {exc}"

    return payload
