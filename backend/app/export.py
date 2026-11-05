"""Render the final vertical short with FFmpeg.

The frontend computes every rectangle (same math it uses for the live preview) and rasterises the
subtitles to transparent PNG "states" with the same canvas renderer used on screen, so the export
matches the preview exactly. This module turns that spec into one FFmpeg filter graph.
"""
from __future__ import annotations

import json
import os
import shutil
from fractions import Fraction
from pathlib import Path

from .ffmpeg_utils import available_h264_encoders, ffmpeg, filter_script_args, probe, run_with_progress
from .jobs import Job, JobCancelled

QUALITY = {
    #            x264 crf, x264 preset, nvenc cq, nvenc preset
    "max":      (16, "slow", 17, "p7"),
    "high":     (18, "slow", 19, "p7"),
    "balanced": (21, "medium", 23, "p5"),
    "fast":     (23, "veryfast", 26, "p3"),
}


def _hex(c: str) -> str:
    c = (c or "#000000").lstrip("#")
    if len(c) == 3:
        c = "".join(ch * 2 for ch in c)
    return "0x" + c[:6]


def _fps_str(fps) -> str:
    f = Fraction(str(fps)).limit_denominator(1001)
    return f"{f.numerator}/{f.denominator}"


def _rect(r: dict) -> tuple[int, int, int, int]:
    return int(round(r["x"])), int(round(r["y"])), int(round(r["w"])), int(round(r["h"]))


def build_command(spec: dict, workdir: Path, out_tmp: Path) -> tuple[list[str], float]:
    src = spec["source"]
    info = probe(src)
    start, end = float(spec["start"]), float(spec["end"])
    dur = max(0.05, end - start)
    W, H = int(spec.get("width", 1080)), int(spec.get("height", 1920))
    W -= W % 2
    H -= H % 2
    fps = spec.get("fps") or info["fps"] or 30
    fps_s = _fps_str(fps)
    sw_max, sh_max = info["width"], info["height"]

    cmd = [ffmpeg(), "-y", "-ss", f"{start:.3f}", "-t", f"{dur:.3f}", "-i", src]
    inputs = 1
    subs_input = None
    subs = spec.get("subtitles") or {}
    if subs.get("burn") and subs.get("frames"):
        lst = workdir / "subs.txt"
        lines = ["ffconcat version 1.0"]
        for fr in subs["frames"]:
            lines.append(f"file '{(workdir / fr['file']).as_posix()}'")
            lines.append(f"duration {max(0.001, float(fr['duration'])):.4f}")
        lines.append(f"file '{(workdir / subs['frames'][-1]['file']).as_posix()}'")  # concat demuxer quirk
        lst.write_text("\n".join(lines), "utf-8")
        cmd += ["-f", "concat", "-safe", "0", "-i", str(lst)]
        subs_input = inputs
        inputs += 1

    layers = [l for l in spec.get("layers", []) if l["src"]["w"] >= 1 and l["src"]["h"] >= 1 and l["dst"]["w"] >= 1 and l["dst"]["h"] >= 1]
    bg = spec.get("background") or {"type": "color", "color": "#000000"}
    use_blur = bg.get("type") == "blur" and bg.get("src")
    n_split = len(layers) + (1 if use_blur else 0)

    f: list[str] = []
    if n_split == 0:
        f.append(f"color=c={_hex(bg.get('color'))}:s={W}x{H}:r={fps_s}:d={dur:.3f},format=yuv420p[comp]")
    else:
        outs = "".join(f"[s{i}]" for i in range(n_split))
        f.append(f"[0:v]fps={fps_s},setpts=PTS-STARTPTS,format=yuv420p,split={n_split}{outs}" if n_split > 1
                 else f"[0:v]fps={fps_s},setpts=PTS-STARTPTS,format=yuv420p[s0]")
        si = 0

        def crop(r):
            x, y, w, h = _rect(r)
            x, y = max(0, min(x, sw_max - 1)), max(0, min(y, sh_max - 1))
            w, h = max(2, min(w, sw_max - x)), max(2, min(h, sh_max - y))
            return f"crop={w}:{h}:{x}:{y}"

        if use_blur:
            sigma = float(bg.get("sigma", 40)) * W / 1080
            dim = float(bg.get("dim", 0.35))
            qw, qh = max(16, W // 4 // 2 * 2), max(16, H // 4 // 2 * 2)
            chain = f"[s{si}]{crop(bg['src'])},scale={qw}:{qh}:flags=bilinear,gblur=sigma={sigma / 4:.2f},scale={W}:{H}:flags=bicubic,setsar=1"
            if dim > 0:
                chain += f",drawbox=x=0:y=0:w=iw:h=ih:color=black@{min(1, dim):.3f}:t=fill"
            f.append(chain + "[base]")
            si += 1
        else:
            f.append(f"color=c={_hex(bg.get('color'))}:s={W}x{H}:r={fps_s},format=yuv420p[base]")
        prev = "base"
        for i, l in enumerate(layers):
            dx, dy, dw, dh = _rect(l["dst"])
            f.append(f"[s{si}]{crop(l['src'])},scale={dw}:{dh}:flags=lanczos,setsar=1[l{i}]")
            f.append(f"[{prev}][l{i}]overlay=x={dx}:y={dy}:shortest=1[c{i}]")
            prev = f"c{i}"
            si += 1
        f.append(f"[{prev}]null[comp]")

    vout = "comp"
    if subs_input is not None:
        f.append(f"[{subs_input}:v]setpts=PTS-STARTPTS,format=rgba,scale={W}:{H}[subs]")
        f.append(f"[comp][subs]overlay=0:0:eof_action=pass:format=auto[withsubs]")
        vout = "withsubs"
    f.append(f"[{vout}]format=yuv420p,setsar=1[vout]")

    # audio
    a = spec.get("audio") or {"mode": "track", "index": 0}
    n_audio = len(info["audio"])
    vol = float(a.get("volume", 1.0))
    amap: list[str] = []
    if a.get("mode") != "none" and n_audio > 0:
        if a.get("mode") == "mix" and n_audio > 1:
            f.append("".join(f"[0:a:{i}]" for i in range(n_audio)) + f"amix=inputs={n_audio}:normalize=0,volume={vol},aresample=48000:async=1:first_pts=0[aout]")
        else:
            idx = int(a.get("index", 0))
            idx = idx if 0 <= idx < n_audio else 0
            f.append(f"[0:a:{idx}]volume={vol},aresample=48000:async=1:first_pts=0[aout]")
        amap = ["-map", "[aout]", "-c:a", "aac", "-b:a", f"{int(spec.get('audio_bitrate', 192))}k", "-ar", "48000", "-ac", "2"]

    script = workdir / "filter.txt"
    script.write_text(";\n".join(f), "utf-8")
    cmd += [*filter_script_args(str(script)), "-map", "[vout]", *amap]

    v = spec.get("video") or {}
    q = QUALITY.get(v.get("quality", "high"), QUALITY["high"])
    enc = v.get("encoder", "libx264")
    if enc != "libx264" and not available_h264_encoders().get(enc):
        enc = "libx264"
    gop = int(round(float(Fraction(fps_s)) * 2))
    if enc == "h264_nvenc":
        cmd += ["-c:v", "h264_nvenc", "-preset", q[3], "-tune", "hq", "-rc", "vbr", "-cq", str(q[2]), "-b:v", "0",
                "-maxrate", "60M", "-bufsize", "120M", "-spatial-aq", "1", "-temporal-aq", "1", "-rc-lookahead", "32",
                "-profile:v", "high", "-bf", "3"]
    elif enc in ("h264_qsv", "h264_amf"):
        cmd += ["-c:v", enc, "-b:v", "16M" if q[0] <= 18 else "10M", "-maxrate", "40M", "-bufsize", "80M"]
    else:
        cmd += ["-c:v", "libx264", "-preset", q[1], "-crf", str(q[0]), "-profile:v", "high"]
    cmd += ["-g", str(gop), "-pix_fmt", "yuv420p", "-r", fps_s,
            "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
            "-movflags", "+faststart", "-t", f"{dur:.3f}", str(out_tmp)]
    return cmd, dur


def run(job: Job, spec: dict, workdir: Path) -> dict:
    out = Path(spec["output"])
    out.parent.mkdir(parents=True, exist_ok=True)
    out_tmp = out.with_name(out.stem + ".rendering" + out.suffix)
    try:
        cmd, dur = build_command(spec, workdir, out_tmp)
        (workdir / "command.json").write_text(json.dumps(cmd, indent=1), "utf-8")
        job.set(0.0, "Rendering video…")
        code, err = run_with_progress(cmd, dur, lambda p: job.set(p, f"Rendering… {p * 100:.0f}%"), lambda: job.cancelled)
        if job.cancelled:
            raise JobCancelled()
        if code != 0:
            raise RuntimeError("FFmpeg failed to render the video.\n\n" + err[-2500:])
        if out.exists():
            out.unlink()
        out_tmp.replace(out)
        if spec.get("srt"):
            out.with_suffix(".srt").write_text(spec["srt"], "utf-8")
        info = probe(str(out))
        job.set(1.0, "Export complete")
        return {"output": str(out), "size": info["size"], "width": info["width"], "height": info["height"],
                "fps": info["fps"], "duration": info["duration"], "video_codec": info["video_codec"],
                "audio": info["audio"][:1], "srt": str(out.with_suffix(".srt")) if spec.get("srt") else None}
    finally:
        out_tmp.unlink(missing_ok=True)
        if not os.environ.get("SHORTSMITH_KEEP_JOBS"):
            shutil.rmtree(workdir, ignore_errors=True)
