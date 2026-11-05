"""Turn word timestamps into readable, well-timed caption segments."""
from __future__ import annotations

import uuid

SENTENCE_END = (".", "?", "!", "…")
SOFT_BREAK = (",", ";", ":", "—", "-")


def build_captions(words: list[dict], max_words: int = 6, max_chars: int = 32, max_duration: float = 3.0,
                   pause_split: float = 0.6, offset: float = 0.0) -> list[dict]:
    """words: [{text,start,end,speaker?}] in clip-local seconds. Returns captions in absolute seconds."""
    caps: list[dict] = []
    cur: list[dict] = []

    def flush():
        if not cur:
            return
        caps.append({
            "id": uuid.uuid4().hex[:10],
            "start": cur[0]["start"],
            "end": cur[-1]["end"],
            "text": " ".join(w["text"] for w in cur),
            "speaker": cur[0].get("speaker"),
            "words": [{"text": w["text"], "start": round(w["start"] + offset, 3), "end": round(w["end"] + offset, 3)}
                      for w in cur],
        })
        cur.clear()

    for w in words:
        if cur:
            prev = cur[-1]
            text_len = sum(len(x["text"]) + 1 for x in cur) + len(w["text"])
            if (w.get("speaker") != prev.get("speaker")
                    or w["start"] - prev["end"] > pause_split
                    or len(cur) >= max_words
                    or text_len > max_chars
                    or w["end"] - cur[0]["start"] > max_duration
                    or prev["text"].endswith(SENTENCE_END)
                    or (prev["text"].endswith(SOFT_BREAK) and len(cur) >= max(2, max_words // 2))):
                flush()
        cur.append(w)
    flush()

    # timing polish: hold captions slightly past the last word, guarantee a minimum on-screen time,
    # never overlap the next caption of the same speaker
    for i, c in enumerate(caps):
        nxt = next((n for n in caps[i + 1:] if n["speaker"] == c["speaker"]), None)
        limit = nxt["start"] if nxt else c["end"] + 0.5
        end = max(c["end"] + 0.15, c["start"] + 0.5)
        c["end"] = min(end, limit) if limit > c["end"] else c["end"]
        c["start"] = round(c["start"] + offset, 3)
        c["end"] = round(c["end"] + offset, 3)
    return caps
