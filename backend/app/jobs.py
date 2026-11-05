"""Tiny in-process background job manager (proxy, transcription, export)."""
from __future__ import annotations

import threading
import time
import traceback
import uuid
from typing import Any, Callable


class Job:
    def __init__(self, kind: str, meta: dict | None = None):
        self.id = uuid.uuid4().hex[:12]
        self.kind = kind
        self.meta = meta or {}
        self.status = "queued"        # queued | running | done | error | cancelled
        self.progress = 0.0
        self.message = ""
        self.result: Any = None
        self.error: str | None = None
        self.detail: str | None = None
        self.cancelled = False
        self.created = time.time()
        self.finished: float | None = None

    def set(self, progress: float | None = None, message: str | None = None):
        if progress is not None:
            self.progress = max(0.0, min(1.0, progress))
        if message is not None:
            self.message = message

    def to_dict(self) -> dict:
        return {
            "id": self.id, "kind": self.kind, "status": self.status, "progress": round(self.progress, 4),
            "message": self.message, "result": self.result, "error": self.error, "detail": self.detail,
            "meta": self.meta,
        }


class JobCancelled(Exception):
    pass


_jobs: dict[str, Job] = {}
_lock = threading.Lock()
# heavy GPU/CPU jobs run one at a time per kind to keep the UI responsive
_kind_locks: dict[str, threading.Lock] = {}


def submit(kind: str, fn: Callable[[Job], Any], meta: dict | None = None, exclusive: bool = True) -> Job:
    job = Job(kind, meta)
    with _lock:
        _jobs[job.id] = job
        lk = _kind_locks.setdefault(kind, threading.Lock())

    def runner():
        try:
            if exclusive:
                job.message = "Waiting for another task to finish…"
                lk.acquire()
            try:
                if job.cancelled:
                    raise JobCancelled()
                job.status = "running"
                job.result = fn(job)
                job.status = "cancelled" if job.cancelled else "done"
                job.progress = 1.0 if job.status == "done" else job.progress
            finally:
                if exclusive:
                    lk.release()
        except JobCancelled:
            job.status = "cancelled"
            job.message = "Cancelled"
        except Exception as e:  # noqa: BLE001 - surface every error to the UI
            job.status = "error"
            job.error = str(e) or e.__class__.__name__
            job.detail = traceback.format_exc()[-4000:]
            print(f"[job {job.kind} {job.id}] failed:\n{job.detail}")
        finally:
            job.finished = time.time()

    threading.Thread(target=runner, daemon=True, name=f"job-{kind}-{job.id}").start()
    return job


def get(job_id: str) -> Job | None:
    return _jobs.get(job_id)


def cancel(job_id: str) -> bool:
    j = _jobs.get(job_id)
    if not j:
        return False
    j.cancelled = True
    return True


def find_active(kind: str, key: str) -> Job | None:
    for j in _jobs.values():
        if j.kind == kind and j.meta.get("key") == key and j.status in ("queued", "running"):
            return j
    return None


def any_active() -> bool:
    return any(j.status in ("queued", "running") for j in list(_jobs.values()))
