import { ArrowRight, FileVideo } from "lucide-react";
import { seek, useStore, useTime } from "../../store";
import { Field, NumberInput, Section, Toggle, fmtTime } from "../ui";
import type { Step } from "../../types";

export function NextStep({ to, label }: { to: Step; label: string }) {
  return (
    <div style={{ padding: 16 }}>
      <button className="btn primary" style={{ width: "100%", justifyContent: "center", height: 36 }} onClick={() => useStore.getState().setStep(to)}>
        {label} <ArrowRight size={15} />
      </button>
    </div>
  );
}

const mb = (n: number) => n > 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(1)} MB`;

export default function ImportPanel() {
  const p = useStore((s) => s.project!);
  const upd = useStore((s) => s.update);
  const src = p.source;
  const len = p.clip.end - p.clip.start;
  const setLen = (l: number) => upd((d) => { d.clip.end = Math.min(src.duration, d.clip.start + l); });
  return (
    <div>
      <Section title={<><FileVideo size={13} /> Source video</>}>
        <div style={{ fontWeight: 600, marginBottom: 4, wordBreak: "break-all" }}>{src.name}</div>
        <div className="hint" style={{ wordBreak: "break-all", marginBottom: 10 }}>{src.path}</div>
        <div className="kv">
          <span>Duration</span><span>{fmtTime(src.duration)}</span>
          <span>Resolution</span><span>{src.width} × {src.height}</span>
          <span>Frame rate</span><span>{src.fps} fps</span>
          <span>Video</span><span>{src.video_codec?.toUpperCase()} · {src.container}</span>
          <span>Size</span><span>{mb(src.size)}{src.bit_rate ? ` · ${(src.bit_rate / 1e6).toFixed(1)} Mb/s` : ""}</span>
          <span>Audio</span>
          <span>{src.audio.length === 0 ? "None" : src.audio.map((a) => `#${a.index + 1} ${a.codec} ${a.channels}ch${a.title ? ` “${a.title}”` : ""}`).join(", ")}</span>
        </div>
        <div style={{ marginTop: 12 }}>
          <Toggle on={p.ui.useProxy} onChange={(v) => upd((d) => { d.ui.useProxy = v; }, { history: false })}
            label={<span>Use smooth preview proxy <span className="hint">(for MKV/HEVC/4K files)</span></span>} />
        </div>
      </Section>

      <Section title="Clip range">
        <div className="hint" style={{ marginBottom: 10 }}>Pick the part of the video to turn into a short. Drag the purple handles on the timeline, or press <span className="kbd">I</span> / <span className="kbd">O</span> at the playhead.</div>
        <div className="row" style={{ marginBottom: 10 }}>
          <Field label="Start (s)">
            <NumberInput value={p.clip.start} min={0} max={p.clip.end - 0.2} step={0.1} digits={2}
              onChange={(v) => { upd((d) => { d.clip.start = v; }); seek(v); }} />
          </Field>
          <Field label="End (s)">
            <NumberInput value={p.clip.end} min={p.clip.start + 0.2} max={src.duration} step={0.1} digits={2}
              onChange={(v) => upd((d) => { d.clip.end = v; })} />
          </Field>
          <Field label="Length">
            <div style={{ height: 30, display: "flex", alignItems: "center", fontWeight: 600, color: len > 180 ? "var(--warn)" : undefined }}>{fmtTime(len)}</div>
          </Field>
        </div>
        <div className="row wrap">
          <button className="btn sm" onClick={() => { const t = useTime.getState().t; upd((d) => { d.clip.start = Math.min(t, d.clip.end - 0.2); }); }}>Start at playhead</button>
          <button className="btn sm" onClick={() => { const t = useTime.getState().t; upd((d) => { d.clip.end = Math.max(t, d.clip.start + 0.2); }); }}>End at playhead</button>
        </div>
        <div className="lbl" style={{ margin: "12px 0 6px" }}>Quick length from start</div>
        <div className="row wrap">
          {[15, 30, 45, 60, 90, 180].map((l) => <button key={l} className="btn sm" onClick={() => setLen(l)}>{l < 60 ? `${l}s` : `${l / 60}m`}</button>)}
          <button className="btn sm" onClick={() => upd((d) => { d.clip.start = 0; d.clip.end = src.duration; })}>Whole video</button>
        </div>
        {len > 180 && <div className="hint" style={{ color: "var(--warn)", marginTop: 10 }}>YouTube Shorts can be at most 3 minutes long.</div>}
      </Section>
      <NextStep to="select" label="Next: select facecam & gameplay" />
    </div>
  );
}
