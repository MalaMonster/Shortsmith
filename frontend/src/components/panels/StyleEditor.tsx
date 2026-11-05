import { useEffect, useRef, useState } from "react";
import { AlignCenter, AlignLeft, AlignRight } from "lucide-react";
import { useStore } from "../../store";
import { BASE_STYLE, STYLE_PRESETS } from "../../defaults";
import { FONTS, ensureFontsLoaded, loadInstalledFonts } from "../../fonts";
import { drawCaption } from "../../engine/subtitles";
import type { SubtitleStyle, Track } from "../../types";
import { ColorInput, Field, Section, Seg, Slider, Toggle } from "../ui";

function PresetThumb({ style, name, onClick }: { style: SubtitleStyle; name: string; onClick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let live = true;
    void ensureFontsLoaded([style]).then(() => {
      const c = ref.current;
      if (!c || !live) return;
      const ctx = c.getContext("2d")!;
      ctx.clearRect(0, 0, c.width, c.height);
      const W = 1080 * 0.32;
      const s = { ...style, x: 0.5, y: 0.5, maxWidth: 0.95, fontSize: Math.min(style.fontSize, 84) * 1.1 };
      drawCaption(ctx, { id: "p", trackId: "p", start: 0, end: 1, text: "Just go!", words: [{ text: "Just", start: 0, end: 0.4 }, { text: "go!", start: 0.4, end: 1 }] },
        s, W, c.height * (W / c.width), 0.2);
    });
    return () => { live = false; };
  }, [style]);
  return (
    <div className="preset" onClick={onClick} title={`Apply "${name}"`}>
      <canvas ref={ref} width={346} height={104} />
      <span>{name}</span>
    </div>
  );
}

export default function StyleEditor({ track }: { track: Track }) {
  const upd = useStore((s) => s.update);
  const st = track.style;
  const [, force] = useState(0);
  const set = <K extends keyof SubtitleStyle>(k: K, v: SubtitleStyle[K], co = true) =>
    upd((d) => { const t = d.tracks.find((t) => t.id === track.id); if (t) t.style[k] = v; }, co ? { coalesce: `style-${track.id}-${k}` } : undefined);
  const font = FONTS.find((f) => f.family === st.fontFamily);
  const weights = font?.weights ?? [400, 700];

  return (
    <div>
      <Section title="Presets">
        <div className="preset-grid">
          {STYLE_PRESETS.map((p) => (
            <PresetThumb key={p.id} name={p.name} style={{ ...BASE_STYLE, ...p.style }}
              onClick={() => upd((d) => {
                const t = d.tracks.find((t) => t.id === track.id);
                if (t) t.style = { ...t.style, ...p.style };
              })} />
          ))}
        </div>
        <div className="hint" style={{ marginTop: 8 }}>Presets change the look of <b>{track.name}</b>, not its position.</div>
      </Section>

      <Section title="Text">
        <Field label="Font" right={<button className="btn sm ghost" title="Use any font installed on your PC (Edge/Chrome)"
          onClick={async () => { try { await loadInstalledFonts(); force((x) => x + 1); useStore.getState().toast("success", "Installed fonts added to the list"); } catch (e: any) { useStore.getState().toast("error", e.message); } }}>+ Installed fonts</button>}>
          <select className="input" value={st.fontFamily} onChange={(e) => {
            const f = FONTS.find((x) => x.family === e.target.value);
            upd((d) => {
              const t = d.tracks.find((t) => t.id === track.id)!;
              t.style.fontFamily = e.target.value;
              if (f && !f.weights.includes(t.style.fontWeight)) t.style.fontWeight = f.weights[f.weights.length - 1];
            });
          }}>
            {(["Bundled", "System", "Installed"] as const).map((g) => {
              const fs = FONTS.filter((f) => f.group === g);
              return fs.length ? <optgroup key={g} label={g === "Bundled" ? "Built-in" : g === "System" ? "Windows" : "Installed"}>
                {fs.map((f) => <option key={f.family} value={f.family} style={{ fontFamily: f.family }}>{f.family}</option>)}
              </optgroup> : null;
            })}
          </select>
        </Field>
        <div className="row">
          <Field label="Weight">
            <select className="input" value={st.fontWeight} onChange={(e) => set("fontWeight", Number(e.target.value), false)}>
              {[100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => (
                <option key={w} value={w}>{({ 100: "Thin", 200: "Extra light", 300: "Light", 400: "Regular", 500: "Medium", 600: "Semibold", 700: "Bold", 800: "Extra bold", 900: "Black" } as any)[w]}{weights.includes(w) ? "" : " (synthetic)"}</option>
              ))}
            </select>
          </Field>
          <div className="field"><label>&nbsp;</label>
            <div className="row" style={{ height: 30 }}>
              <Toggle on={st.uppercase} onChange={(v) => set("uppercase", v, false)} label="ABC" />
              <Toggle on={st.italic} onChange={(v) => set("italic", v, false)} label={<i>Italic</i>} />
            </div>
          </div>
        </div>
        <Field label="Size"><Slider value={st.fontSize} min={20} max={200} step={1} digits={0} suffix="px" onChange={(v) => set("fontSize", v)} /></Field>
        <Field label="Colour"><ColorInput value={st.color} onChange={(v) => set("color", v)} /></Field>
        <Field label="Line spacing"><Slider value={st.lineHeight} min={0.7} max={2} step={0.01} onChange={(v) => set("lineHeight", v)} suffix="×" /></Field>
        <Field label="Letter spacing"><Slider value={st.letterSpacing} min={-5} max={20} step={0.5} digits={1} suffix="px" onChange={(v) => set("letterSpacing", v)} /></Field>
        <Field label="Max line width" tip="Captions wrap onto a new line beyond this width.">
          <Slider value={st.maxWidth} min={0.3} max={1} step={0.01} digits={0} display={{ scale: 100 }} suffix="%" onChange={(v) => set("maxWidth", v)} />
        </Field>
        <Field label="Alignment">
          <Seg value={st.align} onChange={(v) => set("align", v, false)} options={[
            { v: "left", label: <AlignLeft size={13} />, title: "Left" }, { v: "center", label: <AlignCenter size={13} />, title: "Centre" }, { v: "right", label: <AlignRight size={13} />, title: "Right" }]} />
        </Field>
      </Section>

      <Section title="Position">
        <div className="hint" style={{ marginBottom: 10 }}>Or drag the subtitle in the preview. <b>Shift+drag</b> moves a single caption.</div>
        <Field label="Horizontal"><Slider value={st.x} min={0} max={1} step={0.005} digits={1} display={{ scale: 100 }} suffix="%" onChange={(v) => set("x", v)} /></Field>
        <Field label="Vertical"><Slider value={st.y} min={0} max={1} step={0.005} digits={1} display={{ scale: 100 }} suffix="%" onChange={(v) => set("y", v)} /></Field>
        <div className="row wrap">
          {[["Top", 0.15], ["Upper", 0.32], ["Divider", 0.41], ["Middle", 0.5], ["Lower", 0.68], ["Bottom", 0.78]].map(([l, y]) => (
            <button key={l} className="btn sm" onClick={() => set("y", y as number, false)}>{l}</button>
          ))}
        </div>
      </Section>

      <Section title="Outline & shadow">
        <Field label="Outline thickness"><Slider value={st.strokeWidth} min={0} max={30} step={0.5} digits={1} suffix="px" onChange={(v) => set("strokeWidth", v)} /></Field>
        <Field label="Outline colour"><ColorInput value={st.strokeColor} onChange={(v) => set("strokeColor", v)} /></Field>
        <Field label="Shadow colour"><ColorInput value={st.shadowColor} alpha onChange={(v) => set("shadowColor", v)} /></Field>
        <Field label="Shadow blur"><Slider value={st.shadowBlur} min={0} max={60} step={1} digits={0} suffix="px" onChange={(v) => set("shadowBlur", v)} /></Field>
        <div className="row">
          <Field label="Offset X"><Slider value={st.shadowX} min={-30} max={30} step={1} digits={0} onChange={(v) => set("shadowX", v)} /></Field>
          <Field label="Offset Y"><Slider value={st.shadowY} min={-30} max={30} step={1} digits={0} onChange={(v) => set("shadowY", v)} /></Field>
        </div>
      </Section>

      <Section title="Background box">
        <Field label="Box">
          <Seg value={st.bgMode} onChange={(v) => set("bgMode", v, false)} options={[{ v: "none", label: "None" }, { v: "line", label: "Per line" }, { v: "block", label: "Whole caption" }]} />
        </Field>
        {st.bgMode !== "none" && (
          <>
            <Field label="Box colour"><ColorInput value={st.bgColor} onChange={(v) => set("bgColor", v)} /></Field>
            <Field label="Opacity"><Slider value={st.bgOpacity} min={0} max={1} step={0.01} digits={0} display={{ scale: 100 }} suffix="%" onChange={(v) => set("bgOpacity", v)} /></Field>
            <Field label="Padding"><Slider value={st.bgPadding} min={0} max={60} step={1} digits={0} suffix="px" onChange={(v) => set("bgPadding", v)} /></Field>
            <Field label="Corner radius"><Slider value={st.bgRadius} min={0} max={60} step={1} digits={0} suffix="px" onChange={(v) => set("bgRadius", v)} /></Field>
          </>
        )}
      </Section>

      <Section title="Word highlight">
        <Toggle on={st.highlight} onChange={(v) => set("highlight", v, false)} label="Highlight the word being spoken" />
        {st.highlight && <div style={{ marginTop: 10 }}><Field label="Highlight colour"><ColorInput value={st.highlightColor} onChange={(v) => set("highlightColor", v)} /></Field></div>}
        <div className="hint" style={{ marginTop: 6 }}>Uses the AI word timestamps (or spreads words evenly for hand-typed captions).</div>
      </Section>
    </div>
  );
}
