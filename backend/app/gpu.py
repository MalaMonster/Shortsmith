"""On-demand NVIDIA GPU pack for the installed build.

CTranslate2 (local Whisper) needs NVIDIA's cuBLAS runtime (~900 MB unpacked) to use the GPU. To keep
the installer small, the installed app downloads NVIDIA's official `nvidia-cublas-cu12` wheel from
PyPI when asked, verifies its SHA-256 from PyPI's metadata, and extracts only the DLLs into data/gpu.
"""
from __future__ import annotations

import hashlib
import shutil
import zipfile

import httpx

from .config import CUDA_DIR, UPDATES_DIR
from .jobs import Job, JobCancelled
from .transcribe import local_whisper

CUBLAS_VERSION = "12.9.2.10"  # the version Shortsmith is tested with
PYPI = f"https://pypi.org/pypi/nvidia-cublas-cu12/{CUBLAS_VERSION}/json"
DLLS = ("cublas64_12.dll", "cublasLt64_12.dll")


def status() -> dict:
    gpu = local_whisper.nvidia_gpu_present()
    ready = gpu and local_whisper.cublas_available()
    pack = all((CUDA_DIR / d).exists() for d in DLLS)
    return {"nvidia_gpu": gpu, "ready": ready, "pack_installed": pack, "needs_pack": gpu and not ready,
            "download_mb": 527}


def install(job: Job) -> dict:
    meta = httpx.get(PYPI, timeout=30, follow_redirects=True)
    meta.raise_for_status()
    wheel = next((u for u in meta.json()["urls"] if u["filename"].endswith("win_amd64.whl")), None)
    if not wheel:
        raise RuntimeError("Couldn't find NVIDIA's Windows cuBLAS package on PyPI.")
    UPDATES_DIR.mkdir(parents=True, exist_ok=True)
    tmp = UPDATES_DIR / wheel["filename"]
    h = hashlib.sha256()
    done, total = 0, int(wheel.get("size") or 0)
    with httpx.stream("GET", wheel["url"], timeout=httpx.Timeout(60, connect=20), follow_redirects=True) as r:
        r.raise_for_status()
        with open(tmp, "wb") as f:
            for chunk in r.iter_bytes(1 << 18):
                if job.cancelled:
                    f.close()
                    tmp.unlink(missing_ok=True)
                    raise JobCancelled()
                f.write(chunk)
                h.update(chunk)
                done += len(chunk)
                if total:
                    job.set(0.9 * done / total, f"Downloading NVIDIA GPU pack… {done / 2**20:.0f} / {total / 2**20:.0f} MB")
    try:
        if h.hexdigest() != wheel["digests"]["sha256"]:
            raise RuntimeError("The GPU pack download failed its checksum test. Try again.")
        job.set(0.93, "Unpacking…")
        CUDA_DIR.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(tmp) as z:
            for name in z.namelist():
                base = name.rsplit("/", 1)[-1]
                if base in DLLS:
                    with z.open(name) as src, open(CUDA_DIR / base, "wb") as dst:
                        shutil.copyfileobj(src, dst, 1 << 20)
    finally:
        tmp.unlink(missing_ok=True)
    local_whisper._add_cuda_dll_dirs(force=True)
    st = status()
    return {**st, "restart_needed": not st["ready"]}
