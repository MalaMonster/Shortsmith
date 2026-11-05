"""Project persistence: one JSON document per project, written atomically with a rolling backup."""
from __future__ import annotations

import json
import re
import shutil
import time
import uuid
from pathlib import Path

from .config import PROJECTS_DIR


def _dir(pid: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{8,32}", pid):
        raise ValueError("bad project id")
    return PROJECTS_DIR / pid


def new_id() -> str:
    return uuid.uuid4().hex[:16]


def save(pid: str, doc: dict) -> dict:
    d = _dir(pid)
    d.mkdir(parents=True, exist_ok=True)
    doc["id"] = pid
    doc["updated"] = time.time()
    f = d / "project.json"
    tmp = d / "project.json.tmp"
    tmp.write_text(json.dumps(doc, ensure_ascii=False), "utf-8")
    if f.exists():
        shutil.copyfile(f, d / "project.backup.json")
    tmp.replace(f)
    return {"id": pid, "updated": doc["updated"]}


def load(pid: str) -> dict:
    d = _dir(pid)
    for name in ("project.json", "project.backup.json"):
        f = d / name
        if f.exists():
            try:
                return json.loads(f.read_text("utf-8"))
            except json.JSONDecodeError:
                continue
    raise FileNotFoundError(pid)


def delete(pid: str):
    shutil.rmtree(_dir(pid), ignore_errors=True)


def list_all() -> list[dict]:
    out = []
    for d in PROJECTS_DIR.iterdir():
        f = d / "project.json"
        if not f.exists():
            continue
        try:
            j = json.loads(f.read_text("utf-8"))
        except Exception:
            continue
        src = j.get("source") or {}
        out.append({
            "id": j.get("id", d.name), "name": j.get("name") or src.get("name") or "Untitled",
            "updated": j.get("updated", f.stat().st_mtime), "source_name": src.get("name"),
            "source_path": src.get("path"), "duration": (j.get("clip") or {}).get("end", 0) - (j.get("clip") or {}).get("start", 0),
            "captions": len(j.get("captions") or []),
            "source_exists": bool(src.get("path")) and Path(src["path"]).exists(),
        })
    out.sort(key=lambda x: -x["updated"])
    return out


def known_source_paths() -> set[str]:
    s = set()
    for p in list_all():
        if p.get("source_path"):
            s.add(str(Path(p["source_path"]).resolve()).lower())
    return s
