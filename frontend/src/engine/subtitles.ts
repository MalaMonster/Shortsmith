/**
 * Subtitle renderer. The exact same function draws the live preview and rasterises the PNG
 * overlays used by the export, which is what guarantees "what you see is what you export".
 * Geometry is expressed at 1080 px width and scaled with `W / 1080` (no canvas transforms, so
 * shadow blur scales correctly too).
 */
import type { Caption, Rect, SubtitleStyle, Track } from "../types";
import { fontString } from "../fonts";

export interface CaptionBox { captionId: string; trackId: string; rect: Rect }

interface Token { text: string; w: number; x: number; idx: number }
interface Line { tokens: Token[]; w: number; y: number }

export function displayText(text: string, style: SubtitleStyle) {
  return style.uppercase ? text.toUpperCase() : text;
}

export function tokenTimes(cap: Caption, n: number): { start: number; end: number }[] {
  if (cap.words && cap.words.length === n) return cap.words.map((w) => ({ start: w.start, end: w.end }));
  const toks = cap.text.split(/\s+/).filter(Boolean);
  const total = toks.reduce((a, t) => a + t.length + 1, 0) || 1;
  let t0 = cap.start;
  return toks.map((t) => {
    const d = ((cap.end - cap.start) * (t.length + 1)) / total;
    const r = { start: t0, end: t0 + d };
    t0 += d;
    return r;
  });
}

export function activeTokenIndex(cap: Caption, n: number, t: number): number {
  const times = tokenTimes(cap, n);
  let idx = -1;
  for (let i = 0; i < times.length; i++) if (t >= times[i].start - 0.0005) idx = i;
  return idx;
}

function layout(ctx: CanvasRenderingContext2D, cap: Caption, style: SubtitleStyle, W: number, H: number) {
  const s = W / 1080;
  const px = style.fontSize * s;
  ctx.font = fontString(style, px);
  (ctx as any).letterSpacing = `${style.letterSpacing * s}px`;
  const words = displayText(cap.text, style).split(/\s+/).filter(Boolean);
  const space = ctx.measureText(" ").width;
  const maxW = Math.max(40, style.maxWidth * W);
  const lines: Line[] = [];
  let cur: Token[] = [];
  let curW = 0;
  words.forEach((w, idx) => {
    const ww = ctx.measureText(w).width;
    const next = cur.length ? curW + space + ww : ww;
    if (cur.length && next > maxW) {
      lines.push({ tokens: cur, w: curW, y: 0 });
      cur = []; curW = 0;
    }
    cur.push({ text: w, w: ww, x: cur.length ? curW + space : 0, idx });
    curW = cur.length === 1 ? ww : curW + space + ww;
  });
  if (cur.length) lines.push({ tokens: cur, w: curW, y: 0 });
  const lh = px * style.lineHeight;
  const blockW = Math.max(0, ...lines.map((l) => l.w));
  const blockH = lines.length * lh;
  const pos = cap.pos ?? { x: style.x, y: style.y };
  const cx = pos.x * W, cy = pos.y * H;
  const left = cx - blockW / 2, top = cy - blockH / 2;
  lines.forEach((l, i) => {
    l.y = top + lh * (i + 0.5);
    const off = style.align === "left" ? 0 : style.align === "right" ? blockW - l.w : (blockW - l.w) / 2;
    l.tokens.forEach((t) => (t.x += left + off));
  });
  return { lines, px, lh, s, block: { x: left, y: top, w: blockW, h: blockH }, count: words.length };
}

function hexToRgba(c: string, a: number) {
  if (c.startsWith("rgb")) return c;
  let h = c.replace("#", "");
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  const n = parseInt(h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function drawCaption(ctx: CanvasRenderingContext2D, cap: Caption, style: SubtitleStyle, W: number, H: number, t: number, measureOnly = false): Rect {
  ctx.save();
  const L = layout(ctx, cap, style, W, H);
  const { s, lines, px } = L;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const pad = style.bgPadding * s;
  const stroke = style.strokeWidth * s;
  // bounding box (for hit-testing / drag) including outline + padding
  const ext = Math.max(stroke, style.bgMode !== "none" ? pad : 0);
  const box: Rect = { x: L.block.x - ext, y: L.block.y - ext, w: L.block.w + 2 * ext, h: L.block.h + 2 * ext };
  if (measureOnly) { ctx.restore(); (ctx as any).letterSpacing = "0px"; return box; }

  if (style.bgMode !== "none" && lines.length) {
    ctx.fillStyle = hexToRgba(style.bgColor, style.bgOpacity);
    const r = style.bgRadius * s;
    if (style.bgMode === "block") {
      ctx.beginPath();
      ctx.roundRect(L.block.x - pad, L.block.y - pad * 0.6, L.block.w + pad * 2, L.block.h + pad * 1.2, r);
      ctx.fill();
    } else {
      for (const l of lines) {
        const x0 = l.tokens[0].x;
        ctx.beginPath();
        ctx.roundRect(x0 - pad, l.y - L.lh / 2 - pad * 0.25, l.w + pad * 2, L.lh + pad * 0.5, r);
        ctx.fill();
      }
    }
  }

  const active = style.highlight ? activeTokenIndex(cap, L.count, t) : -1;
  const hasShadow = style.shadowBlur > 0 || style.shadowX !== 0 || style.shadowY !== 0;

  const strokePass = () => {
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    ctx.lineWidth = stroke * 2;
    ctx.strokeStyle = style.strokeColor;
    for (const l of lines) for (const tk of l.tokens) ctx.strokeText(tk.text, tk.x, l.y);
  };
  const fillPass = () => {
    for (const l of lines)
      for (const tk of l.tokens) {
        ctx.fillStyle = tk.idx === active ? style.highlightColor : style.color;
        ctx.fillText(tk.text, tk.x, l.y);
      }
  };

  if (hasShadow) {
    ctx.shadowColor = style.shadowColor;
    ctx.shadowBlur = style.shadowBlur * s;
    ctx.shadowOffsetX = style.shadowX * s;
    ctx.shadowOffsetY = style.shadowY * s;
    if (stroke > 0) strokePass(); else fillPass();
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    if (stroke > 0) strokePass();
  } else if (stroke > 0) {
    strokePass();
  }
  fillPass();
  void px;
  ctx.restore();
  (ctx as any).letterSpacing = "0px";
  return box;
}

export function visibleCaptions(captions: Caption[], tracks: Track[], t: number): Caption[] {
  const vis = new Set(tracks.filter((tr) => tr.visible).map((tr) => tr.id));
  const order = new Map(tracks.map((tr, i) => [tr.id, i]));
  return captions
    .filter((c) => vis.has(c.trackId) && t >= c.start && t < c.end)
    .sort((a, b) => (order.get(a.trackId)! - order.get(b.trackId)!) || a.start - b.start);
}

/** Draws all captions visible at time t (source seconds). Returns their boxes for hit-testing. */
export function drawSubtitles(ctx: CanvasRenderingContext2D, captions: Caption[], tracks: Track[], t: number, W: number, H: number): CaptionBox[] {
  const byId = new Map(tracks.map((tr) => [tr.id, tr]));
  const out: CaptionBox[] = [];
  const placed: CaptionBox[] = [];
  for (let c of visibleCaptions(captions, tracks, t)) {
    const tr = byId.get(c.trackId)!;
    // two captions of the SAME track overlapping in time would collide: stack the later one below
    for (let guard = 0; guard < 6; guard++) {
      const box = drawCaption(ctx, c, tr.style, W, H, t, true);
      const hit = placed.find((b) => b.trackId === c.trackId && b.rect.x < box.x + box.w && box.x < b.rect.x + b.rect.w && b.rect.y < box.y + box.h && box.y < b.rect.y + b.rect.h);
      if (!hit) break;
      const pos = c.pos ?? { x: tr.style.x, y: tr.style.y };
      c = { ...c, pos: { x: pos.x, y: pos.y + (hit.rect.y + hit.rect.h - box.y + 4 * (W / 1080)) / H } };
    }
    const rect = drawCaption(ctx, c, tr.style, W, H, t);
    const b = { captionId: c.id, trackId: c.trackId, rect };
    placed.push(b);
    out.push(b);
  }
  return out;
}
