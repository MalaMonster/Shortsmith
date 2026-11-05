import { ArrowUpDown, Gamepad2, LayoutTemplate, PaintBucket, RotateCcw, Video } from "lucide-react";
import { useStore } from "../../store";
import type { LayoutCfg } from "../../types";
import { ColorInput, Field, Section, Seg, Slider, Tip } from "../ui";
import { NextStep } from "./ImportPanel";

const PRESETS: { name: string; desc: string; apply: Partial<LayoutCfg> & { cam?: boolean; game?: boolean } }[] = [
  { name: "Classic", desc: "40 / 60", apply: { order: "camera-top", split: 0.4, gap: 0, margin: 0, cam: true, game: true } },
  { name: "Equal", desc: "50 / 50", apply: { order: "camera-top", split: 0.5, gap: 0, margin: 0, cam: true, game: true } },
  { name: "Small cam", desc: "30 / 70", apply: { order: "camera-top", split: 0.3, gap: 0, margin: 0, cam: true, game: true } },
  { name: "Spaced", desc: "gap + margin", apply: { order: "camera-top", split: 0.38, gap: 24, margin: 24, cam: true, game: true } },
  { name: "Cam bottom", desc: "60 / 40", apply: { order: "gameplay-top", split: 0.62, gap: 0, margin: 0, cam: true, game: true } },
  { name: "Gameplay only", desc: "full", apply: { cam: false, game: true, margin: 0 } },
];

function Mini({ split, order, cam, game, gap }: { split: number; order: string; cam: boolean; game: boolean; gap: number }) {
  const both = cam && game;
  const top = both ? split : 1;
  const g = both ? gap / 1920 : 0;
  const topColor = order === "camera-top" ? (cam ? "var(--cam)" : "var(--game)") : (game ? "var(--game)" : "var(--cam)");
  const botColor = order === "camera-top" ? "var(--game)" : "var(--cam)";
  return (
    <div style={{ width: 27, height: 48, background: "#000", borderRadius: 3, overflow: "hidden", display: "flex", flexDirection: "column", flex: "none", border: "1px solid var(--line2)" }}>
      <div style={{ height: `${top * (1 - g) * 100}%`, background: topColor, opacity: 0.85 }} />
      {both && <div style={{ height: `${g * 100}%` }} />}
      {both && <div style={{ flex: 1, background: botColor, opacity: 0.85 }} />}
    </div>
  );
}

export default function ArrangePanel() {
  const p = useStore((s) => s.project!);
  const upd = useStore((s) => s.update);
  const L = p.layout;
  const both = p.camera.enabled && p.gameplay.enabled;

  const regionCtl = (kind: "camera" | "gameplay") => {
    const r = p[kind];
    if (!r.enabled) return null;
    const isCam = kind === "camera";
    return (
      <Section title={<>{isCam ? <Video size={13} color="var(--cam)" /> : <Gamepad2 size={13} color="var(--game)" />} {isCam ? "Facecam section" : "Gameplay section"}</>}
        right={<button className="btn sm ghost" title="Reset zoom and position" onClick={() => upd((d) => { d[kind].zoom = 1; d[kind].panX = 0; d[kind].panY = 0; })}><RotateCcw size={12} /></button>}>
        <Field label="Fit" tip="Fill: covers the whole section (edges may be cropped). Fit: shows the entire selection, with the background colour around it. Footage is never stretched.">
          <Seg value={r.fit} onChange={(v) => upd((d) => { d[kind].fit = v; })}
            options={[{ v: "fill", label: "Fill (crop)" }, { v: "fit", label: "Fit (letterbox)" }]} />
        </Field>
        <Field label="Zoom" tip="Scroll over the section in the preview to zoom too.">
          <Slider value={r.zoom} min={0.5} max={4} step={0.01} onChange={(v) => upd((d) => { d[kind].zoom = v; }, { coalesce: `zoom-${kind}` })} suffix="×" />
        </Field>
        <Field label="Horizontal position" tip="Which part of the selection is shown when it's cropped or zoomed. You can also drag inside the section in the preview.">
          <Slider value={r.panX} min={-1} max={1} step={0.01} onChange={(v) => upd((d) => { d[kind].panX = v; }, { coalesce: `panx-${kind}` })} />
        </Field>
        <Field label="Vertical position">
          <Slider value={r.panY} min={-1} max={1} step={0.01} onChange={(v) => upd((d) => { d[kind].panY = v; }, { coalesce: `pany-${kind}` })} />
        </Field>
      </Section>
    );
  };

  return (
    <div>
      <Section title={<><LayoutTemplate size={13} /> Layout presets</>}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
          {PRESETS.map((pr) => {
            const cam = pr.apply.cam ?? true, game = pr.apply.game ?? true;
            return (
              <button key={pr.name} className="btn" style={{ height: "auto", padding: 8, flexDirection: "column", gap: 6 }}
                onClick={() => upd((d) => {
                  const { cam: c, game: g, ...rest } = pr.apply;
                  Object.assign(d.layout, rest);
                  if (c !== undefined) d.camera.enabled = c;
                  if (g !== undefined) d.gameplay.enabled = g;
                })}>
                <Mini split={pr.apply.split ?? 0.4} order={pr.apply.order ?? "camera-top"} cam={cam} game={game} gap={pr.apply.gap ?? 0} />
                <span style={{ fontSize: 11.5 }}>{pr.name}</span><span className="hint" style={{ fontSize: 10.5 }}>{pr.desc}</span>
              </button>
            );
          })}
        </div>
      </Section>

      {both && (
        <Section title="Sections">
          <Field label="Order">
            <div className="row">
              <Seg value={L.order} onChange={(v) => upd((d) => { d.layout.order = v; })}
                options={[{ v: "camera-top", label: "Cam on top" }, { v: "gameplay-top", label: "Cam on bottom" }]} />
              <button className="btn sm icon" title="Swap" onClick={() => upd((d) => { d.layout.order = d.layout.order === "camera-top" ? "gameplay-top" : "camera-top"; d.layout.split = 1 - d.layout.split; })}><ArrowUpDown size={13} /></button>
            </div>
          </Field>
          <Field label="Top section size" tip="Share of the height given to the top section. Drag the divider in the preview, too.">
            <Slider value={L.split} min={0.1} max={0.9} step={0.005} digits={0} display={{ scale: 100 }} suffix="%"
              onChange={(v) => upd((d) => { d.layout.split = v; }, { coalesce: "split" })} />
          </Field>
          <Field label="Gap between sections" tip="Space between facecam and gameplay, in pixels of the 1080×1920 output. Drag the small white bars above/below the divider in the preview, too.">
            <Slider value={L.gap} min={0} max={300} step={1} digits={0} suffix="px" onChange={(v) => upd((d) => { d.layout.gap = Math.round(v); }, { coalesce: "gap" })} />
          </Field>
        </Section>
      )}

      <Section title={<><PaintBucket size={13} /> Background</>}>
        <Field label="Outer margin" tip="Padding around the whole composition.">
          <Slider value={L.margin} min={0} max={160} step={1} digits={0} suffix="px" onChange={(v) => upd((d) => { d.layout.margin = Math.round(v); }, { coalesce: "margin" })} />
        </Field>
        <Field label="Fill empty space with">
          <Seg value={L.background.type} onChange={(v) => upd((d) => { d.layout.background.type = v; })}
            options={[{ v: "color", label: "Colour" }, { v: "blur", label: "Blurred gameplay" }]} />
        </Field>
        <Field label="Colour"><ColorInput value={L.background.color} onChange={(v) => upd((d) => { d.layout.background.color = v; }, { coalesce: "bgc" })} /></Field>
        {L.background.type === "blur" && (
          <>
            <Field label="Blur strength"><Slider value={L.background.blur} min={5} max={100} step={1} digits={0} onChange={(v) => upd((d) => { d.layout.background.blur = v; }, { coalesce: "blur" })} /></Field>
            <Field label="Darken"><Slider value={L.background.dim} min={0} max={0.9} step={0.01} digits={0} display={{ scale: 100 }} suffix="%" onChange={(v) => upd((d) => { d.layout.background.dim = v; }, { coalesce: "dim" })} /></Field>
          </>
        )}
        <div className="hint">The background shows in gaps, margins and around footage set to "Fit". <Tip text="Blurred gameplay is a popular look for letterboxed layouts." /></div>
      </Section>
      {regionCtl("camera")}
      {regionCtl("gameplay")}
      <NextStep to="subtitles" label="Next: subtitles" />
    </div>
  );
}
