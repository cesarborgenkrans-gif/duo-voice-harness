#!/usr/bin/env bash
set -euo pipefail

app_root="$1"
data_root="$2"
model_path="$3"
venv="$4"
port="$5"
if [[ -z "$venv" ]]; then
  for candidate in "$HOME/voicegen-chiyuki-ai-rocm72" "$HOME/voicegen-oui-rocm72" "$HOME/voxcpm-wsl-rocm72" "$HOME/voxcpm-wsl-rocm"; do
    if [[ -x "$candidate/bin/python" ]]; then venv="$candidate"; break; fi
  done
fi
[[ -x "$venv/bin/python" ]] || { echo 'Set DUO_VOICE_WSL_VENV to a compatible VoxCPM2 Python environment.' >&2; exit 1; }
[[ -f "$model_path/config.json" ]] || { echo 'Set DUO_VOICE_MODEL_PATH to the VoxCPM2 model directory.' >&2; exit 1; }
export HSA_ENABLE_DXG_DETECTION=1
export HSA_OVERRIDE_GFX_VERSION="${HSA_OVERRIDE_GFX_VERSION:-11.0.0}"
export LD_LIBRARY_PATH="/opt/rocm/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export MIOPEN_FIND_MODE=2
export PYTHONPATH="$app_root/backend"
export DUO_VOICE_HOST=127.0.0.1
export DUO_VOICE_PORT="$port"
export DUO_VOICE_APP_ROOT="$app_root"
export DUO_VOICE_DATA_ROOT="$data_root"
export VOXCPM_MODEL_PATH="$model_path"
mkdir -p "$data_root" "$data_root/cache"
export PYTHONDONTWRITEBYTECODE=1
export HF_HOME="$data_root/cache/huggingface"
export TORCH_HOME="$data_root/cache/torch"
export XDG_CACHE_HOME="$data_root/cache"
export MIOPEN_USER_DB_PATH="$data_root/cache/miopen"
export HF_HUB_OFFLINE=1
cd "$app_root"
# Electron closes stdin on exit; terminate only the server launched here.
"$venv/bin/python" -u backend/server.py &
backend_pid=$!
trap 'kill -TERM "$backend_pid" 2>/dev/null || true; wait "$backend_pid" 2>/dev/null || true' EXIT
while kill -0 "$backend_pid" 2>/dev/null; do
  if read -r -t 1 command; then
    [[ "$command" == stop ]] && break
  else
    read_status=$?
    [[ "$read_status" == 1 ]] && break
  fi
done
