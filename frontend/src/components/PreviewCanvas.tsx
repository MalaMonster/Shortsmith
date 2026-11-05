import { useEffect, useMemo, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { getVideoEl, useStore, useTime } from "../store";
import { clamp, compose, type Composition } from "../engine/layout";
import { drawSubtitles, type CaptionBox } from "../engine/subtitles";
import { ensureFontsLoaded } from "../fonts";
import type { Project } from "../types";
import { startDrag, useSize } from "./ui";

const OW = 1080, OH = 1920;

function drawFrame(ctx: CanvasRenderingContext2D, p: Project, comp: Composition, v: HTMLVideoElement | null, t: number, W: number, H: number): CaptionBox[] {
  const s = W / OW;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = comp.background.color;
  ctx.fillRect(0, 0, W, H);
  const ready = v && v.readyState >= 2 && v.videoWidth > 0;
  if (ready) {
    const kx = v!.videoWidth / p.source.width, ky = v!.videoHeight / p.source.height;
    const bg = comp.background;
    if (bg.type === "blur") {
      const sig = bg.sigma * s;
      const pad = sig * 2;
      ctx.filter = `blur(${sig}px)`;
      ctx.drawImage(v!, bg.src.x * kx, bg.src.y * ky, bg.src.w * kx, bg.src.h * ky, -pad, -pad, W + 2 * pad, H + 2 * pad);
      ctx.filter = "none";
      if (bg.dim > 0) { ctx.fillStyle = `rgba(0,0,0,${bg.dim})`; ctx.fillRect(0, 0, W, H); }
    }
    for (const l of comp.layers) {
      ctx.drawImage(v!, l.src.x * kx, l.src.y * ky, l.src.w * kx, l.src.h * ky, l.dst.x * s, l.dst.y * s, l.dst.w * s, l.dst.h * s);
    }
  }
  return drawSubtitles(ctx, p.captions, p.tracks, t, W, H);
}

export default function PreviewCanvas() {
  const project = useStore((s) => s.project!);
  const selected = useStore((s) => s.selectedCaption);
  const [bodyRef, size] = useSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [boxes, setBoxes] = useState<CaptionBox[]>([]);
  const [safe, setSafe] = useState(() => localStorage.getItem("ss-safe") === "1");
  const [drag, setDrag] = useState<string | null>(null);
  const comp = useMemo(() => compose(project, OW, OH), [project]);

  // css size of the 9:16 preview
  const css = useMemo(() => {
    const aw = Math.max(50, size.w - 28), ah = Math.max(50, size.h - 48);
    let h = ah, w = h * 9 / 16;
    if (w > aw) { w = aw; h = w * 16 / 9; }
    return { w: Math.floor(w), h: Math.floor(h) };
  }, [size]);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pw = Math.min(OW, Math.round(css.w * dpr)), ph = Math.round(pw * 16 / 9);
  const sc = css.w / OW; // css px per output px

  // make sure web fonts are ready (first paint of a new font otherwise uses the fallback)
  const fontsKey = project.tracks.map((t) => `${t.style.fontFamily}${t.style.fontWeight}${t.style.italic}`).join();
  const [fontTick, setFontTick] = useState(0);
  useEffect(() => { void ensureFontsLoaded(project.tracks.map((t) => t.style)).then(() => setFontTick((x) => x + 1)); }, [fontsKey]);

  // render loop: redraw when time, project, size or video frame changes
  const state = useRef({ p: project, comp, dirty: true });
  state.current.p = project; state.current.comp = comp; state.current.dirty = true;
  useEffect(() => { state.current.dirty = true; }, [pw, ph, fontTick]);
  useEffect(() => {
    let raf = 0;
    let lastT = -1;
    let lastBoxesKey = "";
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const c = canvasRef.current, v = getVideoEl();
      if (!c) return;
      const t = v ? v.currentTime : useTime.getState().t;
      const playing = v && !v.paused;
      if (!state.current.dirty && t === lastT && !playing) return;
      state.current.dirty = false;
      lastT = t;
      const ctx = c.getContext("2d")!;
      const b = drawFrame(ctx, state.current.p, state.current.comp, v, t, c.width, c.height);
      const key = b.map((x) => `${x.captionId}${x.rect.x | 0}${x.rect.y | 0}${x.rect.w | 0}`).join();
      if (key !== lastBoxesKey) { lastBoxesKey = key; setBoxes(b); }
    };
    raf = requestAnimationFrame(loop);
    const v = getVideoEl();
    const mark = () => { state.current.dirty = true; };
    v?.addEventListener("seeked", mark);
    v?.addEventListener("loadeddata", mark);
    const unsub = useTime.subscribe(mark);
    return () => { cancelAnimationFrame(raf); v?.removeEventListener("seeked", mark); v?.removeEventListener("loadeddata", mark); unsub(); };
  }, []);

  // ---------------- interactions
  const upd = useStore.getState().update;
  const gap = comp.gap;
  const both = !!(comp.slots.camera && comp.slots.gameplay);

  const dragDivider = (e: React.PointerEvent) => {
    e.stopPropagation();
    const split0 = project.layout.split;
    const m = project.layout.margin, g = project.layout.gap;
    const avail = OH - 2 * m - g;
    setDrag("div");
    startDrag(e, (_dx, dy) => {
      upd((d) => { d.layout.split = clamp(split0 + dy / sc / avail, 0.08, 0.92); }, { coalesce: "split" });
    }, () => setDrag(null));
  };
  const dragGap = (edge: "top" | "bottom") => (e: React.PointerEvent) => {
    e.stopPropagation();
    const g0 = project.layout.gap;
    startDrag(e, (_dx, dy) => {
      const delta = (edge === "bottom" ? dy : -dy) / sc * 2;
      upd((d) => { d.layout.gap = Math.round(clamp(g0 + delta, 0, 600)); }, { coalesce: "gap" });
    });
  };
  const dragSlot = (kind: "camera" | "gameplay") => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const layer = comp.layers.find((l) => l.kind === kind);
    if (!layer) return;
    const k = layer.dst.w / layer.src.w; // output px per source px
    const r0 = { ...project[kind].rect };
    useStore.setState({ activeRegion: kind });
    startDrag(e, (dx, dy) => {
      const ddx = -(dx / sc) / k / project.source.width;
      const ddy = -(dy / sc) / k / project.source.height;
      upd((d) => {
        d[kind].rect.x = clamp(r0.x + ddx, 0, 1 - r0.w);
        d[kind].rect.y = clamp(r0.y + ddy, 0, 1 - r0.h);
      }, { coalesce: `pan-${kind}` });
    });
  };
  const wheelSlot = (kind: "camera" | "gameplay") => (e: React.WheelEvent) => {
    const z = clamp(project[kind].zoom * Math.exp(-e.deltaY * 0.0012), 0.5, 5);
    upd((d) => { d[kind].zoom = +z.toFixed(3); }, { coalesce: `zoom-${kind}` });
  };
  const dragCaption = (b: CaptionBox) => (e: React.PointerEvent) => {
    e.stopPropagation();
    const cap = project.captions.find((c) => c.id === b.captionId);
    const tr = project.tracks.find((t) => t.id === b.trackId);
    if (!cap || !tr) return;
    useStore.setState({ selectedCaption: cap.id, selectedTrack: tr.id });
    const only = e.shiftKey || !!cap.pos;
    const p0 = cap.pos ?? { x: tr.style.x, y: tr.style.y };
    startDrag(e, (dx, dy) => {
      let x = clamp(p0.x + dx / css.w, 0, 1), y = clamp(p0.y + dy / css.h, 0, 1);
      if (Math.abs(x - 0.5) < 0.012) x = 0.5; // centre snap
      upd((d) => {
        if (only) { const c = d.captions.find((c) => c.id === cap.id); if (c) c.pos = { x, y }; }
        else { const t = d.tracks.find((t) => t.id === tr.id); if (t) { t.style.x = x; t.style.y = y; } }
      }, { coalesce: `capmove-${cap.id}` });
    });
  };

  const k = pw / OW; // canvas px per output px (boxes are in canvas px)
  const toCss = pw > 0 ? css.w / pw : 1;
  return (
    <>
      <div className="pane-title">
        Short preview <span className="badge">9:16 · 1080×1920</span>
        <button className={`btn sm ${safe ? "active" : ""}`} title="Show where YouTube's buttons and title cover the video"
          onClick={() => { setSafe(!safe); localStorage.setItem("ss-safe", safe ? "0" : "1"); }}><ShieldCheck size={12} /> Safe zone</button>
      </div>
      <div className="pane-body" ref={bodyRef}>
        <div className="preview-wrap" style={{ width: css.w, height: css.h }}>
          <canvas ref={canvasRef} width={pw} height={ph} />
          <div className="preview-ui">
            {(["gameplay", "camera"] as const).map((kind) => {
              const s = comp.slots[kind];
              return s && (
                <div key={kind} className={`slot-hit ${kind === "camera" ? "cam" : "game"}`} title="Drag to reposition · scroll to zoom"
                  style={{ left: s.x * sc, top: s.y * sc, width: s.w * sc, height: s.h * sc }}
                  onPointerDown={dragSlot(kind)} onWheel={wheelSlot(kind)} />
              );
            })}
            {both && gap && (
              <>
                <div className={`divider-handle ${drag === "div" ? "drag" : ""}`} onPointerDown={dragDivider}
                  style={{ top: (gap.y + gap.h / 2) * sc - 9, height: 18 }} title="Drag to change how much space each section gets">
                  <div className="pill">⇕ {Math.round(project.layout.split * 100)} / {Math.round((1 - project.layout.split) * 100)}</div>
                </div>
                <div className="gap-handle" style={{ top: gap.y * sc - 12 }} onPointerDown={dragGap("top")} title="Drag to change the gap" />
                <div className="gap-handle" style={{ top: (gap.y + gap.h) * sc + 2 }} onPointerDown={dragGap("bottom")} title="Drag to change the gap" />
              </>
            )}
            {boxes.map((b) => (
              <div key={b.captionId} className={`cap-hit ${selected === b.captionId ? "sel" : ""}`} onPointerDown={dragCaption(b)}
                title="Drag to move this speaker's subtitles · Shift+drag to move only this caption"
                style={{ left: b.rect.x * toCss, top: b.rect.y * toCss, width: b.rect.w * toCss, height: b.rect.h * toCss }} />
            ))}
            {safe && (
              <>
                <div className="safe-zone" style={{ left: 0.04 * css.w, top: 0.08 * css.h, width: 0.8 * css.w, height: 0.7 * css.h }} />
                <div style={{ position: "absolute", right: 0, top: 0.42 * css.h, width: 0.14 * css.w, height: 0.5 * css.h, background: "rgba(255,255,255,.07)", pointerEvents: "none" }} />
                <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 0.2 * css.h, background: "linear-gradient(transparent, rgba(255,255,255,.08))", pointerEvents: "none" }} />
              </>
            )}
          </div>
        </div>
      </div>
      {void k}
    </>
  );
}
