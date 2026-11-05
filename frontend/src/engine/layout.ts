/**
 * Composition math shared by the live preview and the FFmpeg export.
 * Everything is computed in OUTPUT pixels (dst) and SOURCE pixels (src), rounded to integers once,
 * so canvas drawImage() and FFmpeg crop/scale/overlay receive identical rectangles.
 */
import type { LayoutCfg, Project, Rect, RegionCfg } from "../types";

export interface Layer { kind: "camera" | "gameplay"; src: Rect; dst: Rect; slot: Rect }
export interface Composition {
  W: number; H: number;
  slots: { camera: Rect | null; gameplay: Rect | null };
  layers: Layer[];            // draw order (bottom → top)
  background: { type: "color"; color: string } | { type: "blur"; src: Rect; sigma: number; dim: number; color: string };
  gap: Rect | null;           // the band between the two sections (for the divider handle)
}

export function computeSlots(layout: LayoutCfg, camOn: boolean, gameOn: boolean, W: number, H: number) {
  const s = H / 1920;
  const m = Math.round(layout.margin * s);
  const inner: Rect = { x: m, y: m, w: W - 2 * m, h: H - 2 * m };
  if (!camOn || !gameOn) {
    return { camera: camOn ? inner : null, gameplay: gameOn ? inner : null, gap: null as Rect | null };
  }
  const gap = Math.round(layout.gap * s);
  const avail = inner.h - gap;
  const topH = Math.round(avail * clamp(layout.split, 0.05, 0.95));
  const top: Rect = { x: inner.x, y: inner.y, w: inner.w, h: topH };
  const bottom: Rect = { x: inner.x, y: inner.y + topH + gap, w: inner.w, h: avail - topH };
  const gapR: Rect = { x: 0, y: inner.y + topH, w: W, h: gap };
  return layout.order === "camera-top"
    ? { camera: top, gameplay: bottom, gap: gapR }
    : { camera: bottom, gameplay: top, gap: gapR };
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Map a region of the source onto its slot.
 * fill: scale so the region covers the slot (excess is cropped, pan chooses which part).
 * fit:  scale so the region fits inside the slot (empty space shows the background).
 * Aspect ratio is ALWAYS preserved — one uniform scale factor `k` for both axes.
 */
export function mapRegion(region: RegionCfg, slot: Rect, sw: number, sh: number): { src: Rect; dst: Rect } | null {
  const r = { x: region.rect.x * sw, y: region.rect.y * sh, w: region.rect.w * sw, h: region.rect.h * sh };
  if (r.w < 1 || r.h < 1 || slot.w < 1 || slot.h < 1) return null;
  const zoom = clamp(region.zoom || 1, 0.2, 8);
  let k: number;        // output px per source px
  let ox: number, oy: number; // output position of source pixel (0,0)
  if (region.fit === "fill") {
    k = Math.max(slot.w / r.w, slot.h / r.h) * zoom;
    const vw = slot.w / k, vh = slot.h / k;          // visible source size
    const vx = r.x + (r.w - vw) * (region.panX + 1) / 2;
    const vy = r.y + (r.h - vh) * (region.panY + 1) / 2;
    ox = slot.x - vx * k;
    oy = slot.y - vy * k;
  } else {
    k = Math.min(slot.w / r.w, slot.h / r.h) * zoom;
    const dw = r.w * k, dh = r.h * k;
    const dx = slot.x + (slot.w - dw) * (region.panX + 1) / 2;
    const dy = slot.y + (slot.h - dh) * (region.panY + 1) / 2;
    ox = dx - r.x * k;
    oy = dy - r.y * k;
  }
  // destination = (region rect mapped) for fit, slot for fill — then clip to slot and to the source frame
  const mapped: Rect = region.fit === "fill" ? { ...slot } : { x: ox + r.x * k, y: oy + r.y * k, w: r.w * k, h: r.h * k };
  const srcBounds: Rect = { x: ox, y: oy, w: sw * k, h: sh * k };
  const d = intersect(intersect(mapped, slot), srcBounds);
  if (!d) return null;
  const dst = roundRect(d);
  if (dst.w < 2 || dst.h < 2) return null;
  const src: Rect = {
    x: (dst.x - ox) / k, y: (dst.y - oy) / k, w: dst.w / k, h: dst.h / k,
  };
  const srcR = roundRect(src);
  srcR.x = clamp(srcR.x, 0, sw - 2); srcR.y = clamp(srcR.y, 0, sh - 2);
  srcR.w = clamp(srcR.w, 2, sw - srcR.x); srcR.h = clamp(srcR.h, 2, sh - srcR.y);
  return { src: srcR, dst };
}

export function intersect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a || !b) return null;
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 - x <= 0 || y2 - y <= 0) return null;
  return { x, y, w: x2 - x, h: y2 - y };
}

export function roundRect(r: Rect): Rect {
  const x = Math.round(r.x), y = Math.round(r.y);
  return { x, y, w: Math.round(r.x + r.w) - x, h: Math.round(r.y + r.h) - y };
}

export function compose(p: Project, W = 1080, H = 1920): Composition {
  const sw = p.source.width, sh = p.source.height;
  const slots = computeSlots(p.layout, p.camera.enabled, p.gameplay.enabled, W, H);
  const layers: Layer[] = [];
  // gameplay first, camera on top (matters only if a fit-mode zoom makes them touch)
  if (slots.gameplay) {
    const m = mapRegion(p.gameplay, slots.gameplay, sw, sh);
    if (m) layers.push({ kind: "gameplay", ...m, slot: slots.gameplay });
  }
  if (slots.camera) {
    const m = mapRegion(p.camera, slots.camera, sw, sh);
    if (m) layers.push({ kind: "camera", ...m, slot: slots.camera });
  }
  const bgc = p.layout.background;
  let background: Composition["background"] = { type: "color", color: bgc.color };
  if (bgc.type === "blur") {
    const reg = p.gameplay.enabled ? p.gameplay.rect : p.camera.rect;
    const r = { x: reg.x * sw, y: reg.y * sh, w: reg.w * sw, h: reg.h * sh };
    const k = Math.max(W / r.w, H / r.h);
    let vw = W / k, vh = H / k;
    vw = Math.min(vw, sw); vh = Math.min(vh, sh);
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const src = roundRect({ x: clamp(cx - vw / 2, 0, sw - vw), y: clamp(cy - vh / 2, 0, sh - vh), w: vw, h: vh });
    background = { type: "blur", src, sigma: bgc.blur, dim: bgc.dim, color: bgc.color };
  }
  return { W, H, slots: { camera: slots.camera, gameplay: slots.gameplay }, layers, background, gap: slots.gap };
}

/** Aspect ratio (w/h in source-normalised units) a locked region must have to exactly fill its slot. */
export function slotAspectNormalized(p: Project, kind: "camera" | "gameplay"): number | null {
  const slots = computeSlots(p.layout, p.camera.enabled, p.gameplay.enabled, 1080, 1920);
  const s = slots[kind];
  if (!s) return null;
  // normalised w/h ratio: (w*sw)/(h*sh) = s.w/s.h → w/h = (s.w/s.h) * (sh/sw)
  return (s.w / s.h) * (p.source.height / p.source.width);
}

/** Resize rect around its centre to the given normalised aspect, staying inside the frame. */
export function fitRectToAspect(r: Rect, aspect: number): Rect {
  // keep area roughly the same
  const area = r.w * r.h;
  let w = Math.sqrt(area * aspect), h = Math.sqrt(area / aspect);
  if (w > 1) { w = 1; h = w / aspect; }
  if (h > 1) { h = 1; w = h * aspect; }
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  return { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h };
}

/** Visible part of the region on the source (normalised) — drawn as the inner dashed box. */
export function visibleSourceRect(p: Project, kind: "camera" | "gameplay"): Rect | null {
  const c = compose(p);
  const l = c.layers.find((l) => l.kind === kind);
  if (!l) return null;
  return { x: l.src.x / p.source.width, y: l.src.y / p.source.height, w: l.src.w / p.source.width, h: l.src.h / p.source.height };
}
