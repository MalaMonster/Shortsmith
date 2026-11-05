/** Builds the export request: composition rectangles + rasterised subtitle states. */
import type { Project } from "../types";
import { compose } from "./layout";
import { activeTokenIndex, displayText, drawSubtitles, tokenTimes, visibleCaptions } from "./subtitles";
import { ensureFontsLoaded } from "../fonts";

export function outputSize(p: Project): [number, number] {
  const [w, h] = p.export.resolution.split("x").map(Number);
  return [w, h];
}

export function outputFps(p: Project): number {
  if (p.export.fps === "source") {
    const f = p.source.fps || 30;
    return f > 61 ? 60 : f;
  }
  return Number(p.export.fps);
}

function tokensOf(text: string, upper: boolean) {
  return displayText(text, { uppercase: upper } as any).split(/\s+/).filter(Boolean).length;
}

export function srtText(p: Project): string {
  const fmt = (t: number) => {
    const ms = Math.max(0, Math.round(t * 1000));
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
  };
  const vis = new Set(p.tracks.filter((t) => t.visible).map((t) => t.id));
  const names = new Map(p.tracks.map((t) => [t.id, t.name]));
  const multi = new Set(p.captions.map((c) => c.trackId)).size > 1;
  return p.captions
    .filter((c) => vis.has(c.trackId) && c.end > p.clip.start && c.start < p.clip.end)
    .sort((a, b) => a.start - b.start)
    .map((c, i) => `${i + 1}\n${fmt(Math.max(0, c.start - p.clip.start))} --> ${fmt(Math.min(p.clip.end, c.end) - p.clip.start)}\n${multi ? `${names.get(c.trackId)}: ` : ""}${c.text}\n`)
    .join("\n");
}

export async function buildExportForm(p: Project, output: string, onProgress: (f: number, msg: string) => void): Promise<FormData> {
  const [W, H] = outputSize(p);
  const comp = compose(p, W, H);
  const fd = new FormData();
  const frames: { file: string; duration: number }[] = [];
  const { start, end } = p.clip;

  const burn = p.export.burnSubtitles && p.captions.some((c) => c.end > start && c.start < end);
  if (burn) {
    onProgress(0, "Preparing subtitles…");
    await ensureFontsLoaded(p.tracks.map((t) => t.style));
    const trackById = new Map(p.tracks.map((t) => [t.id, t]));
    // every instant where the on-screen subtitle picture can change
    const pts = new Set<number>([0, end - start]);
    for (const c of p.captions) {
      if (c.end <= start || c.start >= end) continue;
      const tr = trackById.get(c.trackId);
      if (!tr?.visible) continue;
      pts.add(Math.max(0, c.start - start));
      pts.add(Math.min(end - start, c.end - start));
      if (tr.style.highlight) {
        const n = tokensOf(c.text, tr.style.uppercase);
        for (const tt of tokenTimes(c, n)) if (tt.start > c.start && tt.start < c.end) pts.add(Math.max(0, Math.min(end - start, tt.start - start)));
      }
    }
    const times = [...pts].map((t) => Math.round(t * 1000) / 1000).sort((a, b) => a - b).filter((t, i, a) => i === 0 || t - a[i - 1] > 0.0005);
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    const rendered = new Map<string, string>();
    let fileNo = 0;
    for (let i = 0; i < times.length - 1; i++) {
      const a = times[i], b = times[i + 1];
      const mid = start + (a + b) / 2;
      const vis = visibleCaptions(p.captions, p.tracks, mid);
      const key = vis.map((c) => {
        const tr = trackById.get(c.trackId)!;
        return `${c.id}:${tr.style.highlight ? activeTokenIndex(c, tokensOf(c.text, tr.style.uppercase), mid) : -1}`;
      }).join("|") || "empty";
      let file = rendered.get(key);
      if (!file) {
        ctx.clearRect(0, 0, W, H);
        drawSubtitles(ctx, p.captions, p.tracks, mid, W, H);
        const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("PNG encode failed"))), "image/png"));
        file = `sub_${String(fileNo++).padStart(5, "0")}.png`;
        fd.append("frames", blob, file);
        rendered.set(key, file);
      }
      const last = frames[frames.length - 1];
      if (last && last.file === file) last.duration += b - a;
      else frames.push({ file, duration: b - a });
      if (i % 10 === 0) onProgress(i / times.length, `Rendering subtitles… ${i}/${times.length}`);
    }
    // guarantee the overlay ends transparent
    if (frames.length && rendered.get("empty") !== frames[frames.length - 1].file) {
      let empty = rendered.get("empty");
      if (!empty) {
        ctx.clearRect(0, 0, W, H);
        const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), "image/png"));
        empty = `sub_${String(fileNo++).padStart(5, "0")}.png`;
        fd.append("frames", blob, empty);
      }
      frames.push({ file: empty, duration: 1 });
    }
  }

  const bg = comp.background;
  const spec = {
    source: p.source.path,
    start, end, width: W, height: H, fps: outputFps(p),
    layers: comp.layers.map((l) => ({ kind: l.kind, src: l.src, dst: l.dst })),
    background: bg.type === "blur" ? { type: "blur", src: bg.src, sigma: bg.sigma, dim: bg.dim, color: bg.color } : bg,
    audio: { mode: p.export.audioMode, index: p.export.audioIndex, volume: p.export.volume },
    audio_bitrate: p.export.audioBitrate,
    video: { encoder: p.export.encoder, quality: p.export.quality },
    output,
    subtitles: { burn, frames },
    srt: p.export.srt ? srtText(p) : null,
  };
  fd.append("spec", JSON.stringify(spec));
  return fd;
}
