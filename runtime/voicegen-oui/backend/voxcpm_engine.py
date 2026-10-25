# SPDX-License-Identifier: Apache-2.0
# Adapted/modified for Duo Voice Harness; see ../LICENSE, ../NOTICE and ../ORIGIN.md.
import contextlib
import os
import re
import sys

import torch
# MIOpen (ROCm's cuDNN) works on gfx1100 as of ROCm 6.2.4. Earlier code disabled
# cudnn to dodge the ROCm 6.1.3 MIOpen conv crash, but that rerouted convolutions
# to a fallback path that deadlocked instead. Keep MIOpen enabled for the fast path.
torch.backends.cudnn.enabled = True

# Force the math SDPA backend on ROCm/gfx1100. The Flash / mem-efficient attention
# kernels deadlock on the single-token KV-cache decode step (q_len=1 + boolean mask)
# under WSL2; the math backend is plain matmul+softmax, which is reliable here.
try:
    torch.backends.cuda.enable_flash_sdp(False)
    torch.backends.cuda.enable_mem_efficient_sdp(False)
    torch.backends.cuda.enable_math_sdp(True)
except Exception:
    pass


ITERATION_RATE_PATTERN = re.compile(r"([0-9]+(?:\.[0-9]+)?)\s*(it/s|s/it)")


def parse_iteration_rate(text):
    matches = list(ITERATION_RATE_PATTERN.finditer(str(text or "")))
    if not matches:
        return None
    value = float(matches[-1].group(1))
    if value <= 0:
        return None
    return value if matches[-1].group(2) == "it/s" else 1.0 / value


class TqdmRateCapture:
    def __init__(self, stream):
        self.stream = stream
        self.buffer = ""
        self.last_rate = None

    def write(self, value):
        text = str(value)
        self.stream.write(text)
        self.buffer = (self.buffer + text)[-2048:]
        rate = parse_iteration_rate(self.buffer)
        if rate is not None:
            self.last_rate = rate
        return len(text)

    def flush(self):
        return self.stream.flush()

    def isatty(self):
        return self.stream.isatty()

    def fileno(self):
        return self.stream.fileno()

    @property
    def encoding(self):
        return getattr(self.stream, "encoding", "utf-8")

# Explicitly handle AMD on Windows via DirectML if available,
# otherwise let VoxCPM handle cuda/cpu fallback
def get_best_device():
    try:
        import torch_directml
        if torch_directml.is_available():
            print("[VoxCPMEngine] DirectML detected. Using AMD GPU.")
            return torch_directml.device()
    except ImportError:
        pass

    if torch.cuda.is_available():
        print("[VoxCPMEngine] CUDA detected. Using NVIDIA/ROCm GPU.")
        return "cuda"

    print("[VoxCPMEngine] No GPU backend found. Falling back to CPU.")
    return "cpu"

from voxcpm.core import VoxCPM

class VoxCPMEngine:
    def __init__(self, model_dir):
        print("=========================================")
        print("Initializing Duo Voice Harness VoxCPM engine...")
        self.device = get_best_device()
        print(f"Device targeted: {self.device}")

        # We disable optimize because torch.compile often fails on Windows/DirectML
        self.model = VoxCPM(
            voxcpm_model_path=model_dir,
            enable_denoiser=False, # Disable denoiser for faster init
            optimize=False,        # torch.compile might crash on AMD Windows
            device=self.device
        )
        print("VoxCPM Engine Initialized Successfully!")
        print("=========================================")

    def _build_final_text(self, text, language=None, instruct=None):
        instructions = []
        if language and str(language).strip():
            instructions.append(f"Target voice language: {str(language).strip()}.")
        if instruct and instruct.strip():
            instructions.append(instruct.strip())
        if instructions:
            return f"({' '.join(instructions)}){text}"
        return text

    def generate_design(
        self,
        text,
        language,
        instruct,
        reference_wav_path=None,
        output_path="output.wav",
        cfg_value=2.0,
        inference_timesteps=8,
        denoise=False,
        max_len=4096,
        seed=-1,
    ):
        import torch
        import numpy as np
        if seed is not None and seed >= 0:
            torch.manual_seed(seed)
            np.random.seed(seed)

        final_text = self._build_final_text(text, language, instruct)

        print("[VoxCPMEngine] Synthesizing audio...")
        print(f"   Text: {final_text}")
        print(f"   Max Len: {max_len}")

        rate_capture = TqdmRateCapture(sys.stderr)
        with contextlib.redirect_stderr(rate_capture):
            audio_array = self.model.generate(
                text=final_text,
                reference_wav_path=reference_wav_path,
                cfg_value=cfg_value,
                inference_timesteps=inference_timesteps,
                max_len=max_len,
                denoise=denoise and reference_wav_path is not None,
            )

        import soundfile as sf

        sample_rate = self.model.tts_model.sample_rate

        # Ensure array is float32
        if audio_array.dtype != np.float32 and audio_array.dtype != np.float64:
            audio_array = audio_array.astype(np.float32)

        sf.write(str(output_path), audio_array, sample_rate)

        return output_path, sample_rate, rate_capture.last_rate

    def generate_design_stream(
        self,
        text,
        language,
        instruct,
        reference_wav_path=None,
        cfg_value=2.0,
        inference_timesteps=8,
        denoise=False,
        max_len=4096,
        seed=-1,
        prompt_wav_path=None,
        prompt_text=None,
    ):
        import torch
        import numpy as np
        if seed is not None and seed >= 0:
            torch.manual_seed(seed)
            np.random.seed(seed)

        final_text = self._build_final_text(text, language, instruct)

        print("[VoxCPMEngine] Streaming audio...")
        print(f"   Text: {final_text}")

        sample_rate = self.model.tts_model.sample_rate

        continuation = {}
        if prompt_wav_path is not None or prompt_text is not None:
            if not prompt_wav_path or not prompt_text:
                raise ValueError("continuation requires matching audio and text")
            continuation = {"prompt_wav_path": prompt_wav_path, "prompt_text": prompt_text}
        for chunk in self.model.generate_streaming(
            text=final_text,
            reference_wav_path=reference_wav_path,
            cfg_value=cfg_value,
            inference_timesteps=inference_timesteps,
            max_len=max_len,
            denoise=denoise and reference_wav_path is not None,
            **continuation,
        ):
            yield chunk, sample_rate
