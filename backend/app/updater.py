"""Auto-update from GitHub Releases.

The release workflow attaches `Shortsmith-Setup-X.Y.Z.exe` and `SHA256SUMS.txt` to every release.
The app checks the latest release, and (installed builds only) downloads the installer, verifies its
SHA-256 against SHA256SUMS.txt, starts it silently and exits so the files can be replaced. The
installer relaunches Shortsmith with --after-update, and the open editor window reconnects.
"""
from __future__ import annotations

import hashlib
import os
import re
import subprocess
import sys
import threading
import time

import httpx

from .config import FROZEN, UPDATES_DIR
from .jobs import Job, JobCancelled
from .version import GITHUB_REPO, __version__

API = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
HEADERS = {"Accept": "application/vnd.github+json", "User-Agent": f"Shortsmith/{__version__}"}
_cache: dict = {"at": 0.0, "data": None}
_lock = threading.Lock()


def parse_version(v: str) -> tuple[int, ...]:
    nums = re.findall(r"\d+", v.split("-")[0].split("+")[0])
    return tuple(int(n) for n in nums[:3]) + (0,) * (3 - min(3, len(nums)))


def check(force: bool = False) -> dict:
    with _lock:
        if not force and _cache["data"] and time.time() - _cache["at"] < 1800:
            return _cache["data"]
    base = {"current": __version__, "repo": GITHUB_REPO, "can_install": FROZEN and sys.platform == "win32",
            "releases_url": f"https://github.com/{GITHUB_REPO}/releases"}
    try:
        r = httpx.get(API, headers=HEADERS, timeout=15, follow_redirects=True)
        if r.status_code == 404:
            out = {**base, "available": False, "latest": None, "error": None}
        else:
            r.raise_for_status()
            j = r.json()
            latest = j.get("tag_name", "").lstrip("v")
            assets = {a["name"]: a for a in j.get("assets", [])}
            setup = next((a for n, a in assets.items() if re.fullmatch(r"Shortsmith-Setup-.*\.exe", n)), None)
            sums = assets.get("SHA256SUMS.txt")
            out = {**base, "latest": latest, "available": bool(latest) and parse_version(latest) > parse_version(__version__),
                   "notes": (j.get("body") or "")[:6000], "published": j.get("published_at"), "page": j.get("html_url"),
                   "asset": {"name": setup["name"], "url": setup["browser_download_url"], "size": setup["size"]} if setup else None,
                   "sums_url": sums["browser_download_url"] if sums else None, "error": None}
    except Exception as e:  # offline, rate-limited, …
        out = {**base, "available": False, "latest": None, "error": f"Couldn't check for updates: {e}"}
    with _lock:
        _cache.update(at=time.time(), data=out)
    return out


def install(job: Job, life: dict) -> dict:
    if not (FROZEN and sys.platform == "win32"):
        raise RuntimeError("Automatic install works in the installed version. From source, run `git pull` and setup.bat.")
    info = check(force=True)
    if not info.get("available") or not info.get("asset"):
        raise RuntimeError(info.get("error") or "No newer version is available.")
    if not info.get("sums_url"):
        raise RuntimeError("This release has no SHA256SUMS.txt, so the download can't be verified. Install it manually from GitHub.")
    asset = info["asset"]
    UPDATES_DIR.mkdir(parents=True, exist_ok=True)
    for old in UPDATES_DIR.glob("Shortsmith-Setup-*.exe"):
        old.unlink(missing_ok=True)

    sums = httpx.get(info["sums_url"], headers=HEADERS, timeout=30, follow_redirects=True)
    sums.raise_for_status()
    expected = None
    for line in sums.text.splitlines():
        parts = line.strip().split()
        if len(parts) >= 2 and parts[-1].lstrip("*") == asset["name"]:
            expected = parts[0].lower()
    if not expected:
        raise RuntimeError(f"{asset['name']} is not listed in SHA256SUMS.txt.")

    dest = UPDATES_DIR / asset["name"]
    tmp = dest.with_suffix(".part")
    h = hashlib.sha256()
    done = 0
    job.set(0, f"Downloading Shortsmith {info['latest']}…")
    with httpx.stream("GET", asset["url"], headers=HEADERS, timeout=httpx.Timeout(60, connect=20), follow_redirects=True) as r:
        r.raise_for_status()
        total = int(r.headers.get("content-length") or asset["size"] or 0)
        with open(tmp, "wb") as f:
            for chunk in r.iter_bytes(1 << 18):
                if job.cancelled:
                    raise JobCancelled()
                f.write(chunk)
                h.update(chunk)
                done += len(chunk)
                if total:
                    job.set(0.95 * done / total, f"Downloading Shortsmith {info['latest']}… {done / 2**20:.0f} / {total / 2**20:.0f} MB")
    if h.hexdigest() != expected:
        tmp.unlink(missing_ok=True)
        raise RuntimeError("The downloaded installer failed its checksum test and was deleted. Try again later.")
    tmp.replace(dest)

    job.set(0.98, "Starting the installer — Shortsmith will restart…")
    flags = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    subprocess.Popen([str(dest), "/SILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CLOSEAPPLICATIONS",
                      "/LAUNCHARGS=--after-update"], creationflags=flags, close_fds=True, cwd=str(UPDATES_DIR))

    def _exit_soon():
        time.sleep(1.5)  # let the UI receive the final job status
        life["exit"] = True
    threading.Thread(target=_exit_soon, daemon=True).start()
    return {"installing": info["latest"]}


def cleanup_old_installers():
    """Delete installers left over from a finished update (the one still running is locked and skipped)."""
    time.sleep(20)  # the installer that relaunched us may still be finishing
    for f in UPDATES_DIR.glob("Shortsmith-Setup-*"):
        try:
            f.unlink()
        except OSError:
            pass
