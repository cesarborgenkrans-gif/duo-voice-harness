# SPDX-License-Identifier: Apache-2.0
# Adapted/modified for Duo Voice Harness; see ../LICENSE, ../NOTICE and ../ORIGIN.md.
import gc
import os
import sys
import threading


def _run_torch_cache_cleanup():
    result = {
        "torch_import_ok": False,
        "cuda_available": False,
        "empty_cache": False,
        "ipc_collect": False,
        "errors": [],
    }
    try:
        import torch
    except Exception as exc:
        result["errors"].append(f"torch import failed: {type(exc).__name__}: {exc}")
        return result

    result["torch_import_ok"] = True
    try:
        result["cuda_available"] = bool(torch.cuda.is_available())
    except Exception as exc:
        result["errors"].append(f"cuda availability failed: {type(exc).__name__}: {exc}")
        return result

    if not result["cuda_available"]:
        return result

    try:
        torch.cuda.empty_cache()
        result["empty_cache"] = True
    except Exception as exc:
        result["errors"].append(f"empty_cache failed: {type(exc).__name__}: {exc}")

    ipc_collect = getattr(torch.cuda, "ipc_collect", None)
    if callable(ipc_collect):
        try:
            ipc_collect()
            result["ipc_collect"] = True
        except Exception as exc:
            result["errors"].append(f"ipc_collect failed: {type(exc).__name__}: {exc}")

    return result


def _restart_process():
    os.execv(sys.executable, [sys.executable, *sys.argv])


def schedule_process_restart(delay_seconds=0.75):
    timer = threading.Timer(delay_seconds, _restart_process)
    timer.daemon = False
    timer.start()
    return {
        "restart_scheduled": True,
        "restart_delay_seconds": delay_seconds,
        "executable": sys.executable,
        "argv": sys.argv,
    }


def cool_down_engine(engine, restart_process=False):
    was_loaded = engine is not None
    engine_type = type(engine).__name__ if was_loaded else None
    if was_loaded:
        del engine

    collected_objects = gc.collect()
    torch_cleanup = _run_torch_cache_cleanup()
    restart = schedule_process_restart() if restart_process else {
        "restart_scheduled": False,
        "restart_delay_seconds": None,
        "executable": sys.executable,
        "argv": sys.argv,
    }

    return {
        "released": True,
        "was_loaded": was_loaded,
        "engine_type": engine_type,
        "garbage_collected": collected_objects,
        "torch_cleanup": torch_cleanup,
        "hard_restart": restart,
    }
