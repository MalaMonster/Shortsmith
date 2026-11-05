"""FFmpeg / FFprobe discovery, media probing, proxy + audio extraction."""
from __future__ import annotations

import glob
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from fractions import Fraction
from pathlib import Path
from typing import Callable, Optional

from .config import APP_DIR, CACHE_DIR, ROOT, load_settings

CREATE_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0


class FFmpegMissing(RuntimeError):
    pass


def _candidate_dirs() -> list[str]:
    dirs: list[str] = []
    s = load_settings()
    if s.get("ffmpeg_path"):
        dirs.append(s["ffmpeg_path"])
    if os.environ.get("FFMPEG_PATH"):
        dirs.append(os.environ["FFMPEG_PATH"])
    dirs.append(str(APP_DIR / "ffmpeg"))   # bundled with the installer
    dirs.append(str(ROOT / "bin"))
    if sys.platform == "win32":
        la = os.environ.get("LOCALAPPDATA", "")
        dirs += sorted(glob.glob(os.path.join(la, "Microsoft", "WinGet", "Packages", "Gyan.FFmpeg*", "ffmpeg-*", "bin")), reverse=True)
        dirs.append(os.path.join(la, "Microsoft", "WinGet", "Links"))
        dirs += [r"C:\ffmpeg\bin", r"C:\Program Files\ffmpeg\bin"]
    return dirs


_cache: dict[str, str] = {}


def find_tool(name: str) -> str:
    if name in _cache and os.path.exists(_cache[name]):
        return _cache[name]
    exe = name + (".exe" if sys.platform == "win32" else "")
    for d in _candidate_dirs():
        p = os.path.join(d, exe)
        if d and os.path.isfile(p):
            _cache[name] = p
            return p
    p = shutil.which(name)
    if p:
        _cache[name] = p
        return p
    raise FFmpegMissing(
        f"{name} was not found. Install FFmpeg (e.g. `winget install Gyan.FFmpeg`) "
        f"or set its folder in Settings → FFmpeg folder."
    )


def ffmpeg() -> str:
    return find_tool("ffmpeg")


def ffprobe() -> str:
    return find_tool("ffprobe")


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace",
                          creationflags=CREATE_NO_WINDOW, **kw)


def tool_status() -> dict:
    out = {"ffmpeg": None, "ffprobe": None, "version": None, "encoders": {}, "error": None}
    try:
        out["ffmpeg"] = ffmpeg()
        out["ffprobe"] = ffprobe()
        v = run([out["ffmpeg"], "-hide_banner", "-version"]).stdout.splitlines()
        out["version"] = v[0] if v else None
        out["encoders"] = available_h264_encoders()
    except FFmpegMissing as e:
        out["error"] = str(e)
    return out


_script_flag: Optional[str] = None


def filter_script_args(path: str) -> list[str]:
    """FFmpeg >= 7 reads option values from files with `-/opt file`; older builds use -filter_complex_script."""
    global _script_flag
    if _script_flag is None:
        r = run([ffmpeg(), "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=s=16x16:d=0.04",
                 "-/filter_complex", os.devnull, "-f", "null", "-"])
        _script_flag = "-filter_complex_script" if "Unrecognized option" in r.stderr else "-/filter_complex"
    return [_script_flag, path]


_enc_cache: Optional[dict] = None


def available_h264_encoders() -> dict:
    """Returns {name: usable_bool}. Hardware encoders are verified with a tiny test encode."""
    global _enc_cache
    if _enc_cache is not None:
        return _enc_cache
    res = {"libx264": False, "h264_nvenc": False, "h264_qsv": False, "h264_amf": False}
    try:
        txt = run([ffmpeg(), "-hide_banner", "-encoders"]).stdout
    except FFmpegMissing:
        return res
    for name in res:
        if re.search(rf"\b{name}\b", txt):
            if name == "libx264":
                res[name] = True
                continue
            test = run([ffmpeg(), "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
                        "color=black:s=256x256:d=0.2", "-c:v", name, "-f", "null", "-"], timeout=30)
            res[name] = test.returncode == 0
    _enc_cache = res
    return res


def _fps(s: str | None) -> float:
    try:
        f = Fraction(s)  # type: ignore[arg-type]
        return float(f) if f > 0 else 0.0
    except Exception:
        return 0.0


def probe(path: str) -> dict:
    if not os.path.isfile(path):
        raise FileNotFoundError(f"File not found: {path}")
    r = run([ffprobe(), "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path])
    if r.returncode != 0:
        raise RuntimeError(f"FFprobe could not read this file: {r.stderr.strip()[:500]}")
    j = json.loads(r.stdout or "{}")
    streams = j.get("streams", [])
    v = next((s for s in streams if s.get("codec_type") == "video" and not s.get("disposition", {}).get("attached_pic")), None)
    if not v:
        raise RuntimeError("This file has no video stream.")
    fmt = j.get("format", {})
    duration = float(fmt.get("duration") or v.get("duration") or 0)
    w, h = int(v.get("width", 0)), int(v.get("height", 0))
    # respect rotation metadata (phones)
    rot = 0
    for sd in v.get("side_data_list", []) or []:
        if "rotation" in sd:
            rot = int(sd["rotation"])
    if abs(rot) in (90, 270):
        w, h = h, w
    fps = _fps(v.get("avg_frame_rate")) or _fps(v.get("r_frame_rate")) or 30.0
    audio = []
    for s in streams:
        if s.get("codec_type") == "audio":
            tags = s.get("tags", {}) or {}
            audio.append({
                "index": len(audio),                       # audio-relative index (0:a:N)
                "stream_index": s.get("index"),
                "codec": s.get("codec_name"),
                "channels": s.get("channels"),
                "sample_rate": int(s.get("sample_rate") or 0),
                "title": tags.get("title") or tags.get("handler_name") or "",
                "language": tags.get("language") or "",
            })
    container = (fmt.get("format_name") or "").split(",")[0]
    vcodec = v.get("codec_name")
    # can a Chromium <video> element play the original directly?
    ext = Path(path).suffix.lower()
    browser_ok = (vcodec in ("h264", "vp8", "vp9", "av1")
                  and ext in (".mp4", ".m4v", ".mov", ".webm")
                  and v.get("pix_fmt") in ("yuv420p", "yuvj420p", None)
                  and all(a["codec"] in ("aac", "mp3", "opus", "vorbis", "flac") for a in audio[:1]))
    return {
        "path": os.path.abspath(path),
        "name": Path(path).name,
        "size": int(fmt.get("size") or os.path.getsize(path)),
        "duration": duration,
        "width": w,
        "height": h,
        "fps": round(fps, 3),
        "video_codec": vcodec,
        "pix_fmt": v.get("pix_fmt"),
        "container": container,
        "bit_rate": int(fmt.get("bit_rate") or 0),
        "start_time": float(fmt.get("start_time") or 0),
        "audio": audio,
        "browser_playable": browser_ok,
        "mtime": os.path.getmtime(path),
    }


def media_key(path: str) -> str:
    st = os.stat(path)
    return hashlib.sha1(f"{os.path.abspath(path)}|{st.st_size}|{st.st_mtime}".encode()).hexdigest()[:16]


def proxy_path(path: str) -> Path:
    return CACHE_DIR / f"proxy_{media_key(path)}.mp4"


def parse_progress_time(line: str) -> Optional[float]:
    if line.startswith("out_time_us=") or line.startswith("out_time_ms="):
        try:
            return int(line.split("=", 1)[1]) / 1_000_000
        except ValueError:
            return None
    return None


def run_with_progress(cmd: list[str], duration: float, on_progress: Callable[[float], None],
                      should_cancel: Callable[[], bool] = lambda: False) -> tuple[int, str]:
    """Runs ffmpeg with `-progress pipe:1`, reports 0..1 progress. Returns (code, stderr_tail)."""
    full = [cmd[0], "-hide_banner", "-nostats", "-progress", "pipe:1"] + cmd[1:]
    p = subprocess.Popen(full, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                         encoding="utf-8", errors="replace", creationflags=CREATE_NO_WINDOW)
    tail: list[str] = []

    import threading

    def _err():
        assert p.stderr
        for ln in p.stderr:
            tail.append(ln.rstrip())
            if len(tail) > 60:
                del tail[:-60]

    t = threading.Thread(target=_err, daemon=True)
    t.start()
    assert p.stdout
    for ln in p.stdout:
        if should_cancel():
            p.kill()
            break
        tm = parse_progress_time(ln.strip())
        if tm is not None and duration > 0:
            on_progress(max(0.0, min(1.0, tm / duration)))
    p.wait()
    t.join(timeout=2)
    return p.returncode, "\n".join(tail)


def make_proxy(path: str, duration: float, on_progress: Callable[[float], None], should_cancel=lambda: False) -> Path:
    """Low-res, keyframe-dense H.264 preview proxy. Timeline is identical to the source."""
    out = proxy_path(path)
    if out.exists() and out.stat().st_size > 0:
        return out
    tmp = out.with_suffix(".part.mp4")
    enc = available_h264_encoders()
    venc = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-g", "15", "-keyint_min", "15"]
    if enc.get("h264_nvenc"):
        venc = ["-c:v", "h264_nvenc", "-preset", "p4", "-cq", "25", "-g", "15"]
    cmd = [ffmpeg(), "-y", "-i", path, "-map", "0:v:0", "-map", "0:a:0?",
           "-vf", "scale='min(1280,iw)':-2,format=yuv420p", *venc,
           "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-movflags", "+faststart", str(tmp)]
    code, err = run_with_progress(cmd, duration, on_progress, should_cancel)
    if code != 0:
        tmp.unlink(missing_ok=True)
        raise RuntimeError("Could not create the preview proxy:\n" + err[-1500:])
    tmp.replace(out)
    return out


def extract_audio(path: str, start: float, end: float, audio_index: int, out: Path,
                  fmt: str = "wav") -> Path:
    """Extract mono 16 kHz audio for speech recognition. audio_index=-1 mixes all tracks."""
    info = probe(path)
    n = len(info["audio"])
    if n == 0:
        raise RuntimeError("This video has no audio track to transcribe.")
    cmd = [ffmpeg(), "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{start:.3f}", "-t", f"{max(0.1, end - start):.3f}", "-i", path]
    if audio_index == -1 and n > 1:
        cmd += ["-filter_complex", "".join(f"[0:a:{i}]" for i in range(n)) + f"amix=inputs={n}:normalize=0[a]", "-map", "[a]"]
    else:
        ai = audio_index if 0 <= audio_index < n else 0
        cmd += ["-map", f"0:a:{ai}"]
    cmd += ["-ac", "1", "-ar", "16000"]
    if fmt == "mp3":
        cmd += ["-c:a", "libmp3lame", "-b:a", "64k"]
    else:
        cmd += ["-c:a", "pcm_s16le"]
    cmd.append(str(out))
    r = run(cmd)
    if r.returncode != 0:
        raise RuntimeError("Audio extraction failed: " + r.stderr[-800:])
    return out


def waveform(path: str, audio_index: int = 0, points_per_sec: int = 50) -> list[float]:
    """Peak envelope used for the timeline. Cached on disk."""
    cache = CACHE_DIR / f"wave_{media_key(path)}_{audio_index}_{points_per_sec}.json"
    if cache.exists():
        return json.loads(cache.read_text())
    import numpy as np
    sr = 8000
    cmd = [ffmpeg(), "-hide_banner", "-loglevel", "error", "-i", path, "-map", f"0:a:{max(0, audio_index)}",
           "-ac", "1", "-ar", str(sr), "-f", "s16le", "-"]
    p = subprocess.run(cmd, capture_output=True, creationflags=CREATE_NO_WINDOW)
    if p.returncode != 0 or not p.stdout:
        return []
    a = np.frombuffer(p.stdout, dtype=np.int16).astype(np.float32) / 32768.0
    hop = sr // points_per_sec
    n = len(a) // hop
    if n == 0:
        return []
    peaks = np.abs(a[: n * hop]).reshape(n, hop).max(axis=1)
    m = float(peaks.max()) or 1.0
    vals = [round(float(x) / m, 3) for x in peaks]
    cache.write_text(json.dumps(vals))
    return vals


def thumbnail(path: str, t: float, width: int = 320) -> bytes:
    cmd = [ffmpeg(), "-hide_banner", "-loglevel", "error", "-ss", f"{max(0, t):.3f}", "-i", path, "-frames:v", "1",
           "-vf", f"scale={width}:-2", "-f", "image2", "-c:v", "mjpeg", "-q:v", "4", "-"]
    p = subprocess.run(cmd, capture_output=True, creationflags=CREATE_NO_WINDOW)
    return p.stdout
