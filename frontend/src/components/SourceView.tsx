import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { api, mediaUrl, waitJob } from "../api";
import { getVideoEl, setVideoEl, useStore, useTime } from "../store";
import { clamp, slotAspectNormalized, visibleSourceRect } from "../engine/layout";
import type { Rect } from "../types";
import { startDrag, useSize } from "./ui";

export default function SourceView() {
  const source = useStore((s) => s.project!.source);
  const useProxy = useStore((s) => s.project!.ui.useProxy);
  const step = useStore((s) => s.project!.ui.step);
  const loop = useStore((s) => s.loop);
  const [proxyState, setProxyState] = useState<{ ready: boolean; progress: number; msg: string; error?: string }>({ ready: !useProxy, progress: 0, msg: "" });
  const [bodyRef, size] = useSize<HTMLDivElement>();
  const videoRef = useRef<HTMLVideoElement>(null);

  // ---------------- proxy handling
  useEffect(() => {
    let cancelled = false;
    if (!useProxy) { setProxyState({ ready: true, progress: 1, msg: "" }); return; }
    setProxyState({ ready: false, progress: 0, msg: "Preparing preview…" });
    (async () => {
      try {
        const r = await api.proxy(source.path);
        if (r.ready) { if (!cancelled) setProxyState({ ready: true, progress: 1, msg: "" }); return; }
        const j = await waitJob(r.job!.id, (j) => !cancelled && setProxyState({ ready: false, progress: j.progress, msg: j.message }), 500);
        if (cancelled) return;
        if (j.status === "done") setProxyState({ ready: true, progress: 1, msg: "" });
        else setProxyState({ ready: false, progress: 0, msg: "", error: j.error || "Preview proxy failed" });
      } catch (e: any) {
        if (!cancelled) setProxyState({ ready: false, progress: 0, msg: "", error: e.message });
      }
    })();
    return () => { cancelled = true; };
  }, [useProxy, source.path]);

  const src = proxyState.ready ? mediaUrl(source.path, useProxy) : undefined;

  // ---------------- playback wiring
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    setVideoEl(v);
    let raf = 0;
    const tick = () => {
      const p = useStore.getState().project;
      if (p && !v.paused) {
        if (v.currentTime >= p.clip.end) {
          if (useStore.getState().loop) v.currentTime = p.clip.start;
          else { v.pause(); v.currentTime = p.clip.end; }
        }
        useTime.setState({ t: v.currentTime });
        raf = requestAnimationFrame(tick);
      }
    };
    const onPlay = () => { useStore.setState({ playing: true }); raf = requestAnimationFrame(tick); };
    const onPause = () => { useStore.setState({ playing: false }); cancelAnimationFrame(raf); useTime.setState({ t: v.currentTime }); };
    const onSeeked = () => useTime.setState({ t: v.currentTime });
    const onLoaded = () => {
      const p = useStore.getState().project!;
      const t = useTime.getState().t;
      v.currentTime = t > 0 && t < p.source.duration ? t : p.clip.start;
    };
    const onError = () => {
      const p = useStore.getState().project!;
      if (!p.ui.useProxy) {
        useStore.getState().toast("info", "Your browser can't decode this video directly — creating a smooth preview copy. The original is still used for export.");
        useStore.getState().update((d) => { d.ui.useProxy = true; }, { history: false });
      }
    };
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("seeked", onSeeked);
    v.addEventListener("loadedmetadata", onLoaded);
    v.addEventListener("error", onError);
    return () => {
      cancelAnimationFrame(raf);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("seeked", onSeeked);
      v.removeEventListener("loadedmetadata", onLoaded);
      v.removeEventListener("error", onError);
      if (getVideoEl() === v) setVideoEl(null);
    };
  }, []);
  void loop;

  // ---------------- frame geometry
  const frame = useMemo(() => {
    const ar = source.width / source.height;
    const availW = Math.max(10, size.w - 28), availH = Math.max(10, size.h - 48);
    let w = availW, h = w / ar;
    if (h > availH) { h = availH; w = h * ar; }
    return { w: Math.floor(w), h: Math.floor(h) };
  }, [size, source.width, source.height]);

  const showRegions = step === "select" || step === "arrange";

  return (
    <>
      <div className="pane-title">Original <span className="badge">{source.width}×{source.height} · {source.fps} fps{useProxy ? " · preview proxy" : ""}</span></div>
      <div className="pane-body" ref={bodyRef}>
        <div className="source-frame" style={{ width: frame.w, height: frame.h }}>
          <video ref={videoRef} src={src} preload="auto" playsInline onClick={() => { const v = getVideoEl(); v && (v.paused ? v.play() : v.pause()); }} />
          {showRegions && <RegionLayer w={frame.w} h={frame.h} />}
          {!proxyState.ready && (
            <div className="overlay-msg">
              {proxyState.error ? (
                <div className="err-box" style={{ maxWidth: 460 }}><b>Couldn't prepare a preview.</b><pre>{proxyState.error}</pre></div>
              ) : (
                <div style={{ width: 300 }}>
                  <div className="row" style={{ justifyContent: "center", marginBottom: 10 }}><Loader2 className="spin" size={16} /> {proxyState.msg || "Preparing preview…"}</div>
                  <div className="progress"><div style={{ width: `${proxyState.progress * 100}%` }} /></div>
                  <div className="hint" style={{ marginTop: 10 }}>This format can't be played by the browser directly, so a lightweight preview copy is being made once. Export always uses your original file.</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const HANDLES: Handle[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

function RegionLayer({ w, h }: { w: number; h: number }) {
  const project = useStore((s) => s.project!);
  const drawMode = useStore((s) => s.drawMode);
  const active = useStore((s) => s.activeRegion);
  const [draft, setDraft] = useState<Rect | null>(null);

  const aspectFor = (kind: "camera" | "gameplay") => (project[kind].lockAspect ? slotAspectNormalized(project, kind) : null);

  const setRect = (kind: "camera" | "gameplay", r: Rect, coalesce: string) =>
    useStore.getState().update((d) => { d[kind].rect = r; d[kind].enabled = true; }, { coalesce });

  const onDrawStart = (e: React.PointerEvent) => {
    if (!drawMode) return;
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x0 = (e.clientX - box.left) / w, y0 = (e.clientY - box.top) / h;
    const kind = drawMode;
    const a = aspectFor(kind);
    let last: Rect | null = null;
    startDrag(e, (dx, dy, ev) => {
      let nw = dx / w, nh = dy / h;
      if (a && !ev.shiftKey) nh = Math.sign(nh || 1) * Math.abs(nw) / a;
      let x = nw < 0 ? x0 + nw : x0, y = nh < 0 ? y0 + nh : y0;
      let rw = Math.abs(nw), rh = Math.abs(nh);
      x = clamp(x, 0, 1); y = clamp(y, 0, 1);
      rw = Math.min(rw, 1 - x); rh = Math.min(rh, 1 - y);
      last = { x, y, w: rw, h: rh };
      setDraft(last);
    }, () => {
      setDraft(null);
      if (last && last.w > 0.015 && last.h > 0.015) {
        setRect(kind, last, `draw-${Math.random()}`);
        useStore.setState({ activeRegion: kind });
      }
      useStore.setState({ drawMode: null });
    });
  };

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {(["gameplay", "camera"] as const).map((kind) => project[kind].enabled && (
        <RegionBox key={kind} kind={kind} rect={project[kind].rect} w={w} h={h} aspect={aspectFor(kind)}
          visible={visibleSourceRect(project, kind)} dim={!!active && active !== kind}
          onChange={(r) => setRect(kind, r, `rect-${kind}`)} onSelect={() => useStore.setState({ activeRegion: kind })} />
      ))}
      {drawMode && (
        <div className="draw-layer" onPointerDown={onDrawStart}>
          <div className="draw-hint">Drag to draw the {drawMode === "camera" ? "facecam" : "gameplay"} area · Esc to cancel</div>
          {draft && <div className={`region ${drawMode === "camera" ? "cam" : "game"}`}
            style={{ left: draft.x * w, top: draft.y * h, width: draft.w * w, height: draft.h * h }} />}
        </div>
      )}
    </div>
  );
}

function RegionBox({ kind, rect, w, h, aspect, visible, dim, onChange, onSelect }: {
  kind: "camera" | "gameplay"; rect: Rect; w: number; h: number; aspect: number | null; visible: Rect | null; dim: boolean;
  onChange: (r: Rect) => void; onSelect: () => void;
}) {
  const MIN = 0.02;
  const move = (e: React.PointerEvent) => {
    e.stopPropagation();
    onSelect();
    const r0 = { ...rect };
    startDrag(e, (dx, dy) => {
      onChange({ ...r0, x: clamp(r0.x + dx / w, 0, 1 - r0.w), y: clamp(r0.y + dy / h, 0, 1 - r0.h) });
    });
  };
  const resize = (hd: Handle) => (e: React.PointerEvent) => {
    e.stopPropagation();
    onSelect();
    const r0 = { ...rect };
    startDrag(e, (dx, dy, ev) => {
      const nx = dx / w, ny = dy / h;
      let x1 = r0.x, y1 = r0.y, x2 = r0.x + r0.w, y2 = r0.y + r0.h;
      if (hd.includes("w")) x1 = Math.min(x2 - MIN, x1 + nx);
      if (hd.includes("e")) x2 = Math.max(x1 + MIN, x2 + nx);
      if (hd.includes("n")) y1 = Math.min(y2 - MIN, y1 + ny);
      if (hd.includes("s")) y2 = Math.max(y1 + MIN, y2 + ny);
      let r = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
      if (aspect && !ev.shiftKey) {
        if (hd === "n" || hd === "s") {
          const nw = r.h * aspect;
          r = { ...r, x: r0.x + (r0.w - nw) / 2, w: nw };
        } else if (hd === "e" || hd === "w") {
          const nh = r.w / aspect;
          r = { ...r, y: r0.y + (r0.h - nh) / 2, h: nh };
        } else {
          const nh = r.w / aspect;
          r = { ...r, h: nh, y: hd.includes("n") ? r0.y + r0.h - nh : r0.y };
        }
      }
      // keep inside the frame while preserving aspect
      if (r.w > 1) { const s = 1 / r.w; r.w = 1; r.h *= aspect ? s : 1; }
      if (r.h > 1) { const s = 1 / r.h; r.h = 1; r.w *= aspect ? s : 1; }
      r.x = clamp(r.x, 0, 1 - r.w); r.y = clamp(r.y, 0, 1 - r.h);
      onChange(r);
    });
  };
  const cls = kind === "camera" ? "cam" : "game";
  const hp = (hd: Handle) => ({
    left: hd.includes("w") ? 0 : hd.includes("e") ? "100%" : "50%",
    top: hd.includes("n") ? 0 : hd.includes("s") ? "100%" : "50%",
    cursor: `${hd}-resize`,
  });
  const showVis = visible && (Math.abs(visible.w - rect.w) > 0.004 || Math.abs(visible.h - rect.h) > 0.004 || Math.abs(visible.x - rect.x) > 0.004);
  return (
    <div className={`region ${cls} ${dim ? "dim" : ""}`} onPointerDown={move}
      style={{ left: rect.x * w, top: rect.y * h, width: rect.w * w, height: rect.h * h, zIndex: kind === "camera" ? 2 : 1 }}>
      <div className="tag">{kind === "camera" ? "Facecam" : "Gameplay"}</div>
      {showVis && visible && (
        <div className="vis" title="Part that is visible in the short"
          style={{ left: (visible.x - rect.x) * w, top: (visible.y - rect.y) * h, width: visible.w * w, height: visible.h * h }} />
      )}
      {HANDLES.map((hd) => <div key={hd} className="h" style={hp(hd)} onPointerDown={resize(hd)} />)}
    </div>
  );
}
