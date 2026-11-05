import { Gamepad2, Lock, MousePointerSquareDashed, Unlock, Video } from "lucide-react";
import { useStore } from "../../store";
import { fitRectToAspect, slotAspectNormalized } from "../../engine/layout";
import type { Rect } from "../../types";
import { NumberInput, Section, Tip, Toggle } from "../ui";
import { NextStep } from "./ImportPanel";

export default function SelectPanel() {
  const p = useStore((s) => s.project!);
  const drawMode = useStore((s) => s.drawMode);
  const upd = useStore((s) => s.update);

  const place = (kind: "camera" | "gameplay", corner: string) => {
    const a = slotAspectNormalized(p, kind) ?? 1;
    const h = kind === "camera" ? 0.36 : 1;
    const w = Math.min(1, h * a);
    const hh = w / a;
    const m = 0.015;
    const x = corner.includes("l") ? m : corner.includes("r") ? 1 - w - m : (1 - w) / 2;
    const y = corner.includes("t") ? m : corner.includes("b") ? 1 - hh - m : (1 - hh) / 2;
    upd((d) => { d[kind].rect = { x: Math.max(0, x), y: Math.max(0, y), w, h: hh }; d[kind].enabled = true; });
  };

  const region = (kind: "camera" | "gameplay") => {
    const r = p[kind];
    const isCam = kind === "camera";
    const px = (v: number, dim: number) => Math.round(v * dim);
    const setPx = (key: keyof Rect, v: number) => upd((d) => {
      const dim = key === "x" || key === "w" ? p.source.width : p.source.height;
      const rr = { ...d[kind].rect, [key]: v / dim };
      rr.w = Math.min(rr.w, 1); rr.h = Math.min(rr.h, 1);
      rr.x = Math.max(0, Math.min(rr.x, 1 - rr.w)); rr.y = Math.max(0, Math.min(rr.y, 1 - rr.h));
      d[kind].rect = rr;
      if (key === "w" || key === "h") d[kind].lockAspect = false; // explicit sizes win
    }, { coalesce: `px-${kind}-${key}` });
    return (
      <Section title={<>{isCam ? <Video size={13} color="var(--cam)" /> : <Gamepad2 size={13} color="var(--game)" />} {isCam ? "Facecam" : "Gameplay"}</>}
        right={<Toggle on={r.enabled} onChange={(v) => upd((d) => { d[kind].enabled = v; })} label={<span className="hint">{r.enabled ? "On" : "Off"}</span>} />}>
        {r.enabled ? (
          <>
            <div className="row" style={{ marginBottom: 10 }}>
              <button className={`btn ${isCam ? "cam" : "game"} ${drawMode === kind ? "active" : ""}`} style={{ flex: 1, justifyContent: "center" }}
                onClick={() => useStore.setState({ drawMode: drawMode === kind ? null : kind, activeRegion: kind })}>
                <MousePointerSquareDashed size={14} /> {drawMode === kind ? "Drawing… (drag on video)" : `Draw ${isCam ? "facecam" : "gameplay"} box`}
              </button>
            </div>
            <div className="hint" style={{ marginBottom: 10 }}>Or drag the {isCam ? "pink" : "cyan"} box on the video to move it, and its handles to resize.</div>
            {isCam ? (
              <div className="row wrap" style={{ marginBottom: 10 }}>
                <span className="lbl">Snap to</span>
                {[["tl", "↖ Top-left"], ["tr", "↗ Top-right"], ["bl", "↙ Bottom-left"], ["br", "↘ Bottom-right"]].map(([c, l]) =>
                  <button key={c} className="btn sm" onClick={() => place("camera", c)}>{l}</button>)}
              </div>
            ) : (
              <div className="row wrap" style={{ marginBottom: 10 }}>
                <span className="lbl">Snap to</span>
                <button className="btn sm" onClick={() => place("gameplay", "c")}>Centre</button>
                <button className="btn sm" onClick={() => place("gameplay", "l")}>Left</button>
                <button className="btn sm" onClick={() => place("gameplay", "r")}>Right</button>
                <button className="btn sm" onClick={() => upd((d) => { d.gameplay.rect = { x: 0, y: 0, w: 1, h: 1 }; d.gameplay.lockAspect = false; })}>Whole frame</button>
              </div>
            )}
            <div className="row" style={{ marginBottom: 10, justifyContent: "space-between" }}>
              <Toggle on={r.lockAspect} onChange={(v) => upd((d) => {
                d[kind].lockAspect = v;
                const a = slotAspectNormalized(d as any, kind);
                if (v && a) d[kind].rect = fitRectToAspect(d[kind].rect, a);
              })} label={<span className="row" style={{ gap: 4 }}>{r.lockAspect ? <Lock size={12} /> : <Unlock size={12} />} Match section shape</span>} />
              <Tip text="When on, the box keeps the exact shape of its section in the short, so what you select is exactly what's shown. When off, you can draw any shape and the extra is cropped (or letterboxed in Arrange → Fit). Hold Shift while resizing to temporarily ignore it." />
            </div>
            <div className="row" style={{ gap: 6 }}>
              {(["x", "y", "w", "h"] as const).map((k) => (
                <div key={k} className="field" style={{ marginBottom: 0 }}>
                  <label>{k === "w" ? "Width" : k === "h" ? "Height" : k.toUpperCase()}</label>
                  <NumberInput value={px(r.rect[k], k === "x" || k === "w" ? p.source.width : p.source.height)} digits={0} step={2}
                    min={0} onChange={(v) => setPx(k, v)} className="sm" />
                </div>
              ))}
            </div>
            <div className="hint" style={{ marginTop: 6 }}>In source pixels ({p.source.width}×{p.source.height}). The dashed inner box shows what's actually visible.</div>
          </>
        ) : (
          <div className="hint">{isCam ? "No facecam — the gameplay fills the whole short." : "No gameplay — the facecam fills the whole short."}</div>
        )}
      </Section>
    );
  };

  return (
    <div>
      <div className="section">
        <div className="hint">Mark the two parts of your recording. The preview on the right updates live — it's exactly what the export will look like.</div>
      </div>
      {region("camera")}
      {region("gameplay")}
      <NextStep to="arrange" label="Next: arrange the layout" />
    </div>
  );
}
