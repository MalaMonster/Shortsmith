"""Local speech-to-text with faster-whisper (CTranslate2). GPU if available, CPU fallback."""
from __future__ import annotations

import os
import sys
import threading
from typing import Callable

from ..config import CUDA_DIR, MODELS_DIR

_dll_dirs_added = False


def _add_dir(b: str):
    if os.path.isdir(b):
        os.add_dll_directory(b)
        os.environ["PATH"] = b + os.pathsep + os.environ.get("PATH", "")


def _add_cuda_dll_dirs(force: bool = False):
    """Make the CUDA cuBLAS runtime discoverable for CTranslate2 on Windows. It comes either from the
    pip wheel (source install: site-packages/nvidia/*/bin) or from the GPU pack the installed app
    downloads on demand (data/gpu)."""
    global _dll_dirs_added
    if (_dll_dirs_added and not force) or sys.platform != "win32":
        return
    _dll_dirs_added = True
    _add_dir(str(CUDA_DIR))
    try:
        import nvidia  # type: ignore
        for base in list(nvidia.__path__):
            for sub in os.listdir(base):
                _add_dir(os.path.join(base, sub, "bin"))
    except Exception:
        pass


def nvidia_gpu_present() -> bool:
    try:
        import ctranslate2
        return ctranslate2.get_cuda_device_count() > 0
    except Exception:
        return False


def cublas_available() -> bool:
    _add_cuda_dll_dirs()
    if sys.platform != "win32":
        return True
    try:
        import ctypes
        ctypes.WinDLL("cublas64_12.dll")
        ctypes.WinDLL("cublasLt64_12.dll")
        return True
    except OSError:
        return False


_model = None
_model_key: tuple | None = None
_lock = threading.Lock()

MODEL_SIZES_MB = {
    "tiny": 75, "base": 145, "small": 485, "medium": 1530, "large-v3": 3100,
    "large-v3-turbo": 1620, "distil-large-v3": 1510,
}


def cuda_available() -> bool:
    """A usable NVIDIA GPU: driver present AND the cuBLAS runtime can be loaded."""
    return nvidia_gpu_present() and cublas_available()


def resolve_model(name: str, device: str) -> str:
    if name and name != "auto":
        return name
    return "large-v3-turbo" if device == "cuda" else "small"


def _load(name: str, device_pref: str, log: Callable[[str], None]):
    global _model, _model_key
    from faster_whisper import WhisperModel

    _add_cuda_dll_dirs()
    attempts = []
    if device_pref in ("auto", "cuda") and cuda_available():
        attempts.append(("cuda", "float16"))
    if device_pref != "cuda" or not attempts:
        attempts.append(("cpu", "int8"))
    last_err = None
    for device, ctype in attempts:
        model_name = resolve_model(name, device)
        key = (model_name, device, ctype)
        if _model is not None and _model_key == key:
            return _model, key
        try:
            log(f"Loading Whisper '{model_name}' on {device.upper()} (first use downloads ~{MODEL_SIZES_MB.get(model_name, '?')} MB)…")
            m = WhisperModel(model_name, device=device, compute_type=ctype,
                             download_root=str(MODELS_DIR / "whisper"), cpu_threads=max(1, (os.cpu_count() or 4) - 2))
            if device == "cuda":
                # force a tiny inference so missing cuDNN/cuBLAS DLLs fail here, not mid-transcription
                import numpy as np
                list(m.transcribe(np.zeros(16000, dtype=np.float32), beam_size=1)[0])
            _model, _model_key = m, key
            return m, key
        except Exception as e:  # fall back to CPU
            last_err = e
            log(f"{device.upper()} unavailable ({str(e)[:120]}), falling back…")
    raise RuntimeError(f"Could not load Whisper model: {last_err}")


def transcribe(wav_path: str, duration: float, language: str | None, model_name: str, device: str,
               prompt: str, on_progress: Callable[[float, str], None], is_cancelled: Callable[[], bool]) -> dict:
    with _lock:
        model, key = _load(model_name, device, lambda m: on_progress(0.02, m))
        on_progress(0.05, f"Transcribing with {key[0]} on {key[1].upper()}…")
        from .diarize import _read_wav
        audio, _sr = _read_wav(wav_path)  # 16 kHz mono float32 (avoids PyAV version issues)
        segments, info = model.transcribe(
            audio,
            language=None if not language or language == "auto" else language,
            word_timestamps=True,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 400, "speech_pad_ms": 200},
            beam_size=5,
            condition_on_previous_text=False,
            initial_prompt=prompt or None,
        )
        words = []
        for seg in segments:
            if is_cancelled():
                break
            for w in seg.words or []:
                t = w.word.strip()
                if t:
                    words.append({"text": t, "start": float(w.start), "end": float(w.end), "p": round(float(w.probability), 3)})
            if duration > 0:
                on_progress(0.05 + 0.85 * min(1.0, seg.end / duration), f"Transcribing… {seg.end:.0f}s / {duration:.0f}s")
        return {"words": words, "language": info.language, "language_probability": float(info.language_probability),
                "model": key[0], "device": key[1]}
