"""Subtitle generation pipeline: extract audio → speech-to-text → (diarize) → caption segments."""
from __future__ import annotations

import uuid

from ..config import CACHE_DIR, load_settings
from ..ffmpeg_utils import extract_audio
from ..jobs import Job, JobCancelled
from . import diarize as diar
from . import local_whisper, openai_api
from .segmenter import build_captions


def run(job: Job, p: dict) -> dict:
    settings = load_settings()
    provider = p.get("provider") or settings["provider"]
    start, end = float(p["start"]), float(p["end"])
    duration = end - start
    audio_index = int(p.get("audio_index", 0))
    language = p.get("language") or "auto"
    want_diarize = bool(p.get("diarize"))
    num_speakers = int(p.get("num_speakers") or 0)
    tag = uuid.uuid4().hex[:8]

    def prog(lo: float, hi: float):
        return lambda f, msg=None: job.set(lo + (hi - lo) * f, msg)

    def check():
        if job.cancelled:
            raise JobCancelled()

    job.set(0.01, "Extracting audio…")
    wav = extract_audio(p["path"], start, end, audio_index, CACHE_DIR / f"stt_{tag}.wav")
    try:
        check()
        stt_hi = 0.75 if want_diarize else 0.95
        if provider == "openai":
            mp3 = extract_audio(p["path"], start, end, audio_index, CACHE_DIR / f"stt_{tag}.mp3", fmt="mp3")
            try:
                res = openai_api.transcribe(str(mp3), duration, language, settings, p.get("prompt", ""), prog(0.02, stt_hi))
            finally:
                mp3.unlink(missing_ok=True)
        else:
            res = local_whisper.transcribe(str(wav), duration, language, p.get("model") or settings["local_model"],
                                           settings["local_device"], p.get("prompt", ""), prog(0.02, stt_hi),
                                           lambda: job.cancelled)
        check()
        words = res["words"]
        turns = []
        if want_diarize and not res.get("speakers_from_api") and words:
            job.set(stt_hi, "Identifying speakers…")
            turns = diar.diarize(str(wav), num_speakers, prog(stt_hi, 0.97))
            diar.assign_speakers(words, turns)
            check()
        # normalise speaker ids to 0..n-1 in order of first appearance
        order: dict = {}
        for w in words:
            if "speaker" in w:
                w["speaker"] = order.setdefault(w["speaker"], len(order))
        seg = p.get("segmentation") or {}
        caps = build_captions(words, max_words=int(seg.get("max_words", 6)), max_chars=int(seg.get("max_chars", 32)),
                              max_duration=float(seg.get("max_duration", 3.0)),
                              pause_split=float(seg.get("pause_split", 0.6)), offset=start)
        job.set(1.0, f"Done — {len(caps)} captions")
        return {"captions": caps, "language": res.get("language"), "model": res.get("model"),
                "device": res.get("device"), "speakers": len(order) if order else (1 if caps else 0),
                "turns": [{"start": t["start"] + start, "end": t["end"] + start, "speaker": order.get(t["speaker"], t["speaker"])}
                          for t in turns]}
    finally:
        wav.unlink(missing_ok=True)
