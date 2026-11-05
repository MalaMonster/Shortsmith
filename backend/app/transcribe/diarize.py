"""Local speaker diarization with sherpa-onnx (pyannote segmentation 3.0 + speaker embeddings).

No PyTorch, no Hugging Face token. Models (~40 MB total) are downloaded on first use from the
official sherpa-onnx GitHub releases into data/models/diarization.
"""
from __future__ import annotations

import tarfile
import threading
import wave
from pathlib import Path
from typing import Callable

import httpx
import numpy as np

from ..config import MODELS_DIR

DIR = MODELS_DIR / "diarization"
SEG_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2"
EMB_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx"
SEG_MODEL = DIR / "sherpa-onnx-pyannote-segmentation-3-0" / "model.onnx"
EMB_MODEL = DIR / "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx"

_lock = threading.Lock()


def _download(url: str, dest: Path, log: Callable[[str], None]):
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    log(f"Downloading diarization model {dest.name}…")
    with httpx.stream("GET", url, follow_redirects=True, timeout=httpx.Timeout(120, connect=20)) as r:
        r.raise_for_status()
        with open(tmp, "wb") as f:
            for chunk in r.iter_bytes(1 << 16):
                f.write(chunk)
    tmp.replace(dest)


def ensure_models(log: Callable[[str], None]):
    with _lock:
        if not SEG_MODEL.exists():
            arc = DIR / "seg.tar.bz2"
            _download(SEG_URL, arc, log)
            with tarfile.open(arc, "r:bz2") as t:
                t.extractall(DIR, filter="data")
            arc.unlink(missing_ok=True)
        if not EMB_MODEL.exists():
            _download(EMB_URL, EMB_MODEL, log)


def models_present() -> bool:
    return SEG_MODEL.exists() and EMB_MODEL.exists()


def _read_wav(path: str) -> tuple[np.ndarray, int]:
    with wave.open(path, "rb") as w:
        sr = w.getframerate()
        ch = w.getnchannels()
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    if ch > 1:
        data = data.reshape(-1, ch).mean(axis=1)
    return data, sr


def diarize(wav_path: str, num_speakers: int, on_progress: Callable[[float, str], None]) -> list[dict]:
    """Returns [{start, end, speaker}] sorted by start. num_speakers<=0 → automatic."""
    import sherpa_onnx

    ensure_models(lambda m: on_progress(0.0, m))
    cfg = sherpa_onnx.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(model=str(SEG_MODEL)),
            num_threads=4,
        ),
        embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=str(EMB_MODEL), num_threads=4),
        clustering=sherpa_onnx.FastClusteringConfig(num_clusters=num_speakers if num_speakers > 0 else -1,
                                                    threshold=0.6),
        min_duration_on=0.2,
        min_duration_off=0.4,
    )
    if not cfg.validate():
        raise RuntimeError("Diarization model configuration is invalid (models missing?)")
    sd = sherpa_onnx.OfflineSpeakerDiarization(cfg)
    audio, sr = _read_wav(wav_path)
    if sr != sd.sample_rate:
        raise RuntimeError(f"Expected {sd.sample_rate} Hz audio for diarization, got {sr}")

    def cb(done: int, total: int) -> int:
        on_progress(done / max(1, total), "Identifying speakers…")
        return 0

    result = sd.process(audio, callback=cb).sort_by_start_time()
    return [{"start": float(r.start), "end": float(r.end), "speaker": int(r.speaker)} for r in result]


def assign_speakers(words: list[dict], turns: list[dict]) -> None:
    """Give each word the speaker whose turn overlaps it most (nearest turn if none overlaps)."""
    if not turns:
        return
    for w in words:
        best, best_ov = None, 0.0
        for t in turns:
            ov = min(w["end"], t["end"]) - max(w["start"], t["start"])
            if ov > best_ov:
                best, best_ov = t["speaker"], ov
        if best is None:
            mid = (w["start"] + w["end"]) / 2
            best = min(turns, key=lambda t: min(abs(mid - t["start"]), abs(mid - t["end"])))["speaker"]
        w["speaker"] = best
