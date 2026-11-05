"""Shortsmith local server: REST API + static frontend. Bound to 127.0.0.1 only."""
from __future__ import annotations

import json
import mimetypes
import os
import re
import shutil
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from starlette.middleware.base import BaseHTTPMiddleware

from . import dialogs, export, ffmpeg_utils, gpu, jobs, projects, updater
from . import transcribe as stt
from .config import EXPORTS_DIR, FRONTEND_DIST, JOBS_DIR, UPLOADS_DIR, public_settings, save_settings
from .transcribe import diarize, local_whisper
from .version import __version__

app = FastAPI(title="Shortsmith")
mimetypes.add_type("video/x-matroska", ".mkv")
mimetypes.add_type("video/mp4", ".m4v")
mimetypes.add_type("application/manifest+json", ".webmanifest")

ALLOWED_ORIGINS = re.compile(r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$")


class LocalOriginOnly(BaseHTTPMiddleware):
    """Block other websites from driving the local API (CSRF / drive-by requests)."""

    async def dispatch(self, request: Request, call_next):
        origin = request.headers.get("origin")
        if origin and not ALLOWED_ORIGINS.match(origin):
            return JSONResponse({"detail": "Forbidden origin"}, status_code=403)
        return await call_next(request)


app.add_middleware(LocalOriginOnly)

# media files the UI is allowed to stream (everything the user imported this session or in a saved project)
_media_allow: set[str] = set()


def _norm(p: str) -> str:
    return str(Path(p).resolve()).lower()


def _allow(p: str):
    _media_allow.add(_norm(p))


def _check_media(p: str):
    n = _norm(p)
    if n not in _media_allow and n not in projects.known_source_paths():
        raise HTTPException(403, "This file has not been imported")
    if not os.path.isfile(p):
        raise HTTPException(404, "Source video not found — it may have been moved or deleted")


@app.exception_handler(ffmpeg_utils.FFmpegMissing)
async def _ffmissing(_req, exc):
    return JSONResponse({"detail": str(exc)}, status_code=500)


# ---------------------------------------------------------------- lifecycle
# The launcher (run.py) watches these to shut the server down once the editor window is closed.
LIFE: dict = {"last_ping": time.time(), "bye": None}


@app.get("/api/ping")
@app.post("/api/ping")
def ping():
    LIFE["last_ping"] = time.time()
    return {"app": "shortsmith", "ok": True}


@app.post("/api/bye")
def bye():
    LIFE["bye"] = time.time()
    return {"ok": True}


# ---------------------------------------------------------------- system
@app.get("/api/health")
def health():
    tools = ffmpeg_utils.tool_status()
    return {"ok": True, "version": __version__, "ffmpeg": tools, "cuda": local_whisper.cuda_available(),
            "gpu": gpu.status(), "diarization_models": diarize.models_present(), "exports_dir": str(EXPORTS_DIR)}


# ---------------------------------------------------------------- updates & GPU pack
@app.get("/api/update/check")
def update_check(force: int = 0):
    return updater.check(force=bool(force))


@app.post("/api/update/install")
def update_install():
    if jobs.any_active():
        raise HTTPException(409, "Wait for the running export or transcription to finish, then update.")
    return jobs.submit("update", lambda job: updater.install(job, LIFE), exclusive=False).to_dict()


@app.get("/api/gpu")
def gpu_status():
    return gpu.status()


@app.post("/api/gpu/install")
def gpu_install():
    existing = jobs.find_active("gpu", "pack")
    if existing:
        return existing.to_dict()
    return jobs.submit("gpu", gpu.install, {"key": "pack"}).to_dict()


@app.get("/api/settings")
def get_settings():
    return public_settings()


@app.put("/api/settings")
async def put_settings(req: Request):
    body = await req.json()
    if "openai_api_key" in body and not body["openai_api_key"]:
        body.pop("openai_api_key")  # empty field means "keep existing key"
    if body.pop("clear_api_key", False):
        body["openai_api_key"] = ""
    save_settings(body)
    ffmpeg_utils._cache.clear()
    return public_settings()


# ---------------------------------------------------------------- files
@app.post("/api/dialog/open")
def dialog_open(body: dict | None = None):
    try:
        p = dialogs.open_video((body or {}).get("initialdir"))
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    return {"path": p}


@app.post("/api/dialog/save")
def dialog_save(body: dict):
    try:
        return {"path": dialogs.save_video(body.get("path") or str(EXPORTS_DIR / "short.mp4"))}
    except RuntimeError as e:
        raise HTTPException(500, str(e))


@app.post("/api/probe")
def probe(body: dict):
    path = (body.get("path") or "").strip().strip('"')
    if not path:
        raise HTTPException(400, "No file path given")
    try:
        info = ffmpeg_utils.probe(path)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except RuntimeError as e:
        raise HTTPException(415, f"Unsupported or unreadable video: {e}")
    _allow(info["path"])
    info["proxy_ready"] = ffmpeg_utils.proxy_path(info["path"]).exists()
    return info


@app.post("/api/upload")
async def upload(file: UploadFile):
    name = re.sub(r"[^\w.\- ()]", "_", Path(file.filename or "video.mp4").name)
    dest = UPLOADS_DIR / f"{uuid.uuid4().hex[:6]}_{name}"
    with open(dest, "wb") as f:
        while chunk := await file.read(1 << 22):
            f.write(chunk)
    _allow(str(dest))
    return {"path": str(dest)}


@app.get("/api/media")
def media(path: str, proxy: int = 0):
    _check_media(path)
    if proxy:
        pp = ffmpeg_utils.proxy_path(path)
        if not pp.exists():
            raise HTTPException(404, "Proxy not ready")
        return FileResponse(pp, media_type="video/mp4")
    return FileResponse(path, media_type=mimetypes.guess_type(path)[0] or "application/octet-stream")


@app.post("/api/proxy")
def make_proxy(body: dict):
    path = body["path"]
    _check_media(path)
    if ffmpeg_utils.proxy_path(path).exists():
        return {"ready": True}
    existing = jobs.find_active("proxy", path)
    if existing:
        return {"ready": False, "job": existing.to_dict()}
    info = ffmpeg_utils.probe(path)

    def work(job):
        job.set(0, "Creating smooth preview…")
        ffmpeg_utils.make_proxy(path, info["duration"], lambda p: job.set(p, f"Creating smooth preview… {p * 100:.0f}%"),
                                lambda: job.cancelled)
        return {"ready": True}

    return {"ready": False, "job": jobs.submit("proxy", work, {"key": path}).to_dict()}


@app.get("/api/waveform")
def waveform(path: str, audio: int = 0):
    _check_media(path)
    return {"pps": 50, "peaks": ffmpeg_utils.waveform(path, audio, 50)}


@app.get("/api/thumbnail")
def thumbnail(path: str, t: float = 0, w: int = 320):
    _check_media(path)
    data = ffmpeg_utils.thumbnail(path, t, min(1280, max(64, w)))
    if not data:
        raise HTTPException(500, "Could not grab frame")
    return Response(data, media_type="image/jpeg", headers={"Cache-Control": "max-age=86400"})


@app.post("/api/reveal")
def reveal(body: dict):
    p = body.get("path", "")
    if not os.path.exists(p):
        raise HTTPException(404, "File not found")
    dialogs.reveal(p)
    return {"ok": True}


@app.post("/api/open")
def open_file(body: dict):
    p = body.get("path", "")
    if not os.path.isfile(p) or Path(p).suffix.lower() not in (".mp4", ".srt"):
        raise HTTPException(404, "File not found")
    dialogs.open_file(p)
    return {"ok": True}


# ---------------------------------------------------------------- jobs
@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    j = jobs.get(job_id)
    if not j:
        raise HTTPException(404, "Unknown job")
    return j.to_dict()


@app.post("/api/jobs/{job_id}/cancel")
def job_cancel(job_id: str):
    return {"ok": jobs.cancel(job_id)}


@app.post("/api/transcribe")
def transcribe(body: dict):
    _check_media(body["path"])
    if float(body["end"]) - float(body["start"]) <= 0.2:
        raise HTTPException(400, "Select a longer clip first")
    j = jobs.submit("transcribe", lambda job: stt.run(job, body), {"key": body["path"]})
    return j.to_dict()


@app.post("/api/export")
async def start_export(req: Request):
    form = await req.form(max_files=20000, max_fields=20000, max_part_size=64 * 1024 * 1024)
    spec = json.loads(str(form["spec"]))
    _check_media(spec["source"])
    workdir = JOBS_DIR / uuid.uuid4().hex[:12]
    workdir.mkdir(parents=True)
    try:
        for key, val in form.multi_items():
            if key == "frames" and hasattr(val, "read"):
                name = re.sub(r"[^\w.\-]", "_", val.filename or "f.png")
                with open(workdir / name, "wb") as f:
                    f.write(await val.read())
        out = spec.get("output") or str(EXPORTS_DIR / "short.mp4")
        if not out.lower().endswith(".mp4"):
            out += ".mp4"
        spec["output"] = out
        try:
            Path(out).parent.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            raise HTTPException(400, f"Cannot write to {Path(out).parent}: {e}")
    except Exception:
        shutil.rmtree(workdir, ignore_errors=True)
        raise
    j = jobs.submit("export", lambda job: export.run(job, spec, workdir), {"output": out})
    return j.to_dict()


@app.get("/api/export/default-path")
def default_export_path(name: str = "short"):
    base = re.sub(r"[^\w\- ]", "_", Path(name).stem)[:60] or "short"
    p = EXPORTS_DIR / f"{base}_short.mp4"
    i = 2
    while p.exists():
        p = EXPORTS_DIR / f"{base}_short_{i}.mp4"
        i += 1
    return {"path": str(p)}


# ---------------------------------------------------------------- projects
@app.get("/api/projects")
def list_projects():
    return projects.list_all()


@app.post("/api/projects")
async def create_project(req: Request):
    doc = await req.json()
    pid = projects.new_id()
    if (doc.get("source") or {}).get("path"):
        _allow(doc["source"]["path"])
    return projects.save(pid, doc)


@app.get("/api/projects/{pid}")
def get_project(pid: str):
    try:
        doc = projects.load(pid)
    except (FileNotFoundError, ValueError):
        raise HTTPException(404, "Project not found")
    if (doc.get("source") or {}).get("path"):
        _allow(doc["source"]["path"])
    return doc


@app.put("/api/projects/{pid}")
async def put_project(pid: str, req: Request):
    try:
        return projects.save(pid, await req.json())
    except ValueError:
        raise HTTPException(400, "Bad project id")


@app.delete("/api/projects/{pid}")
def delete_project(pid: str):
    projects.delete(pid)
    return {"ok": True}


# ---------------------------------------------------------------- frontend
@app.get("/{full_path:path}")
def spa(full_path: str):
    if full_path.startswith("api/"):
        raise HTTPException(404)
    f = (FRONTEND_DIST / full_path).resolve()
    if full_path and f.is_file() and FRONTEND_DIST.resolve() in f.parents:
        return FileResponse(f)
    index = FRONTEND_DIST / "index.html"
    if index.exists():
        return FileResponse(index, headers={"Cache-Control": "no-cache"})
    return Response("Frontend not built. Run setup.bat (or `npm run build` in frontend/).", media_type="text/plain")
