"""Paths and persistent application settings."""
from __future__ import annotations

import json
import os
import sys
import threading
from pathlib import Path

# Installed build (PyInstaller): the program lives in e.g. %LOCALAPPDATA%\Programs\Shortsmith, bundled
# resources in sys._MEIPASS, and user data in %LOCALAPPDATA%\Shortsmith. From source: everything in the repo.
FROZEN = bool(getattr(sys, "frozen", False))
if FROZEN:
    APP_DIR = Path(sys.executable).resolve().parent           # Shortsmith.exe + ffmpeg\
    RES_DIR = Path(getattr(sys, "_MEIPASS", APP_DIR))        # bundled frontend etc.
    ROOT = APP_DIR
    _default_data = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local") / "Shortsmith"
else:
    ROOT = APP_DIR = RES_DIR = Path(__file__).resolve().parents[2]
    _default_data = ROOT / "data"
DATA_DIR = Path(os.environ.get("SHORTSMITH_DATA", _default_data))
PROJECTS_DIR = DATA_DIR / "projects"
CACHE_DIR = DATA_DIR / "cache"          # proxies, extracted audio, waveforms
MODELS_DIR = Path(os.environ.get("SHORTSMITH_MODELS", DATA_DIR / "models"))  # Whisper + diarization models
EXPORTS_DIR = Path.home() / "Videos" / "Shortsmith"   # default export location
JOBS_DIR = DATA_DIR / "jobs"            # temporary export work dirs
UPLOADS_DIR = DATA_DIR / "uploads"      # files dropped into the browser
SETTINGS_FILE = DATA_DIR / "settings.json"
FRONTEND_DIST = RES_DIR / "frontend" / "dist"
CUDA_DIR = DATA_DIR / "gpu"            # on-demand NVIDIA cuBLAS runtime for the installed build
UPDATES_DIR = DATA_DIR / "updates"     # downloaded installers

for d in (PROJECTS_DIR, CACHE_DIR, MODELS_DIR, EXPORTS_DIR, JOBS_DIR, UPLOADS_DIR):
    d.mkdir(parents=True, exist_ok=True)

DEFAULT_SETTINGS: dict = {
    # transcription provider: "local" (faster-whisper) or "openai" (any OpenAI-compatible endpoint)
    "provider": "local",
    "local_model": "auto",          # auto | tiny | base | small | medium | large-v3 | large-v3-turbo | distil-large-v3
    "local_device": "auto",         # auto | cuda | cpu
    "openai_base_url": "https://api.openai.com/v1",
    "openai_api_key": "",
    "openai_model": "whisper-1",
    "ffmpeg_path": "",              # optional explicit folder containing ffmpeg/ffprobe
    "auto_update_check": True,      # look for new releases on GitHub at startup
}

_lock = threading.Lock()


def load_settings() -> dict:
    with _lock:
        s = dict(DEFAULT_SETTINGS)
        if SETTINGS_FILE.exists():
            try:
                s.update(json.loads(SETTINGS_FILE.read_text("utf-8")))
            except Exception:
                pass
        # environment variables override (handy for CI / power users)
        if os.environ.get("OPENAI_API_KEY") and not s.get("openai_api_key"):
            s["openai_api_key"] = os.environ["OPENAI_API_KEY"]
        return s


def save_settings(patch: dict) -> dict:
    s = load_settings()
    for k, v in patch.items():
        if k in DEFAULT_SETTINGS:
            s[k] = v
    with _lock:
        tmp = SETTINGS_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(s, indent=2), "utf-8")
        tmp.replace(SETTINGS_FILE)
    return s


def public_settings() -> dict:
    s = load_settings()
    key = s.get("openai_api_key") or ""
    s["openai_api_key"] = ""
    s["openai_api_key_set"] = bool(key)
    s["openai_api_key_hint"] = (key[:3] + "…" + key[-4:]) if len(key) > 10 else ""
    return s
