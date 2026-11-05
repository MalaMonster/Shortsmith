"""Optional cloud transcription through any OpenAI-compatible /audio/transcriptions endpoint.

Works with:
  * OpenAI           base_url=https://api.openai.com/v1      model=whisper-1 (word timestamps)
                                                              model=gpt-4o-transcribe-diarize (speaker labels)
  * Groq             base_url=https://api.groq.com/openai/v1 model=whisper-large-v3-turbo (cheap + fast)
  * Self-hosted servers exposing the same API (e.g. faster-whisper-server / speaches).
"""
from __future__ import annotations

import re

import httpx


def _distribute(text: str, start: float, end: float, speaker=None) -> list[dict]:
    """When a provider gives only segment timing, spread words across the segment by length."""
    toks = [t for t in re.split(r"\s+", text.strip()) if t]
    if not toks:
        return []
    total = sum(len(t) + 1 for t in toks)
    out, t0 = [], start
    for t in toks:
        d = (end - start) * (len(t) + 1) / total
        w = {"text": t, "start": round(t0, 3), "end": round(t0 + d, 3)}
        if speaker is not None:
            w["speaker"] = speaker
        out.append(w)
        t0 += d
    return out


def transcribe(audio_path: str, duration: float, language: str | None, settings: dict, prompt: str,
               on_progress) -> dict:
    key = settings.get("openai_api_key") or ""
    base = (settings.get("openai_base_url") or "https://api.openai.com/v1").rstrip("/")
    model = settings.get("openai_model") or "whisper-1"
    if not key:
        raise RuntimeError("No API key configured. Open Settings and add an API key, or switch to Local transcription.")
    diarize_model = "diarize" in model
    data: list[tuple[str, str]] = [("model", model)]
    if diarize_model:
        data += [("response_format", "diarized_json"), ("chunking_strategy", "auto")]
    elif model.startswith("gpt-4o"):
        data += [("response_format", "json")]
    else:
        data += [("response_format", "verbose_json"), ("timestamp_granularities[]", "word"),
                 ("timestamp_granularities[]", "segment")]
    if language and language != "auto":
        data.append(("language", language))
    if prompt and not diarize_model:
        data.append(("prompt", prompt))
    on_progress(0.1, f"Uploading audio to {base.split('//')[-1].split('/')[0]} ({model})…")
    with open(audio_path, "rb") as f:
        files = {"file": ("audio.mp3", f, "audio/mpeg")}
        try:
            r = httpx.post(f"{base}/audio/transcriptions", headers={"Authorization": f"Bearer {key}"},
                           data=data, files=files, timeout=httpx.Timeout(600, connect=20))
        except httpx.HTTPError as e:
            raise RuntimeError(f"Could not reach the transcription service: {e}") from e
    if r.status_code >= 400:
        try:
            msg = r.json().get("error", {}).get("message") or r.text
        except Exception:
            msg = r.text
        raise RuntimeError(f"Transcription service error ({r.status_code}): {msg[:400]}")
    on_progress(0.85, "Processing response…")
    j = r.json()
    words: list[dict] = []
    speakers_from_api = False
    if diarize_model and j.get("segments"):
        labels: dict[str, int] = {}
        for s in j["segments"]:
            spk = labels.setdefault(str(s.get("speaker", "A")), len(labels))
            words += _distribute(s.get("text", ""), float(s["start"]), float(s["end"]), spk)
        speakers_from_api = True
    elif j.get("words"):
        for w in j["words"]:
            t = (w.get("word") or "").strip()
            if t:
                words.append({"text": t, "start": float(w["start"]), "end": float(w["end"])})
        # verbose_json words lack punctuation; restore it from segment text when we can
        words = _restore_punctuation(words, j.get("segments") or [])
    elif j.get("segments"):
        for s in j["segments"]:
            words += _distribute(s.get("text", ""), float(s["start"]), float(s["end"]))
    elif j.get("text"):
        words = _distribute(j["text"], 0.0, duration)
    return {"words": words, "language": j.get("language") or language or "", "model": model,
            "device": "cloud", "speakers_from_api": speakers_from_api}


def _restore_punctuation(words: list[dict], segments: list[dict]) -> list[dict]:
    text = " ".join((s.get("text") or "").strip() for s in segments)
    toks = [t for t in re.split(r"\s+", text) if t]
    if not toks:
        return words
    norm = lambda s: re.sub(r"[^\w']", "", s.lower())  # noqa: E731
    i = 0
    for w in words:
        target = norm(w["text"])
        for j in range(i, min(i + 4, len(toks))):
            if norm(toks[j]) == target:
                w["text"] = toks[j]
                i = j + 1
                break
    return words
