import { useEffect, useState } from "react";
import { Cpu, Cloud, X } from "lucide-react";
import { api, type Settings } from "../api";
import { useStore } from "../store";
import { Field, Seg } from "./ui";
import { GpuPackSettings, UpdatesSettings } from "./Updates";

const LOCAL_MODELS: [string, string][] = [
  ["auto", "Automatic (large-v3-turbo on GPU, small on CPU)"],
  ["large-v3-turbo", "large-v3-turbo — best speed/accuracy (1.6 GB)"],
  ["large-v3", "large-v3 — most accurate, slowest (3 GB)"],
  ["distil-large-v3", "distil-large-v3 — fast, English only (1.5 GB)"],
  ["medium", "medium (1.5 GB)"], ["small", "small — good on CPU (0.5 GB)"], ["base", "base (145 MB)"], ["tiny", "tiny — fastest, rough (75 MB)"],
];

export default function SettingsDialog() {
  const [s, setS] = useState<Settings | null>(null);
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const health = useStore((st) => st.health);
  const close = () => useStore.setState({ showSettings: false });
  useEffect(() => { api.settings().then(setS).catch((e) => useStore.getState().toast("error", e.message)); }, []);
  if (!s) return null;
  const set = (k: keyof Settings, v: string) => setS({ ...s, [k]: v });

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.saveSettings({ ...s, openai_api_key: key });
      setS(r); setKey("");
      useStore.setState({ health: await api.health() });
      useStore.getState().toast("success", "Settings saved");
      close();
    } catch (e: any) { useStore.getState().toast("error", e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-bg" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header>Settings <button className="btn ghost sm icon" onClick={close}><X size={14} /></button></header>
        <div style={{ padding: 16 }}>
          <div className="lbl" style={{ marginBottom: 8, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em" }}>Subtitle transcription</div>
          <Field label="Provider">
            <Seg value={s.provider} onChange={(v) => set("provider", v)} options={[
              { v: "local", label: <><Cpu size={12} /> Local (free, private)</> },
              { v: "openai", label: <><Cloud size={12} /> Cloud API</> },
            ]} />
          </Field>
          {s.provider === "local" ? (
            <>
              <Field label="Whisper model">
                <select className="input" value={s.local_model} onChange={(e) => set("local_model", e.target.value)}>
                  {LOCAL_MODELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
              <Field label="Run on">
                <Seg value={s.local_device} onChange={(v) => set("local_device", v)} options={[{ v: "auto", label: "Auto" }, { v: "cuda", label: "NVIDIA GPU" }, { v: "cpu", label: "CPU" }]} />
              </Field>
              <div className="hint">GPU: {health?.cuda ? "NVIDIA CUDA available ✓" : "not available — using CPU"}. Models download once to your user folder. Speaker detection runs locally too (sherpa-onnx, ~40 MB).</div>
            </>
          ) : (
            <>
              <Field label="API base URL" tip="Any OpenAI-compatible /audio/transcriptions endpoint.">
                <input className="input" value={s.openai_base_url} onChange={(e) => set("openai_base_url", e.target.value)} />
              </Field>
              <div className="row wrap" style={{ marginBottom: 10 }}>
                <button className="btn sm" onClick={() => setS({ ...s, openai_base_url: "https://api.openai.com/v1", openai_model: "whisper-1" })}>OpenAI</button>
                <button className="btn sm" onClick={() => setS({ ...s, openai_base_url: "https://api.groq.com/openai/v1", openai_model: "whisper-large-v3-turbo" })}>Groq (cheap, fast)</button>
              </div>
              <Field label="Model" tip="whisper-1 / whisper-large-v3(-turbo) give word timestamps. gpt-4o-transcribe-diarize gives speaker labels (segment timing only).">
                <input className="input" value={s.openai_model} onChange={(e) => set("openai_model", e.target.value)} list="models" />
                <datalist id="models">
                  <option value="whisper-1" /><option value="gpt-4o-transcribe-diarize" /><option value="whisper-large-v3-turbo" /><option value="whisper-large-v3" />
                </datalist>
              </Field>
              <Field label={<>API key {s.openai_api_key_set && <span className="badge">saved {s.openai_api_key_hint}</span>}</>}>
                <input className="input" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={s.openai_api_key_set ? "Leave empty to keep the saved key" : "sk-…"} autoComplete="off" />
              </Field>
              {s.openai_api_key_set && <button className="btn sm danger" onClick={async () => { const r = await api.saveSettings({ clear_api_key: true }); setS(r); }}>Remove saved key</button>}
              <div className="hint" style={{ marginTop: 8 }}>The key is stored only on this PC (data/settings.json) and audio of the selected clip is sent to the provider. Editing and export never need a key.</div>
            </>
          )}

          <div className="lbl" style={{ margin: "20px 0 8px", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em" }}>GPU acceleration</div>
          <GpuPackSettings />

          <div className="lbl" style={{ margin: "20px 0 8px", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em" }}>Updates</div>
          <UpdatesSettings auto={s.auto_update_check !== false} onAuto={(v) => setS({ ...s, auto_update_check: v })} />

          <div className="lbl" style={{ margin: "20px 0 8px", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em" }}>FFmpeg</div>
          <div className="hint" style={{ marginBottom: 8, wordBreak: "break-all" }}>
            {health?.ffmpeg.error ? <span style={{ color: "var(--err)" }}>{health.ffmpeg.error}</span> : <>{health?.ffmpeg.version}<br />{health?.ffmpeg.ffmpeg}</>}
          </div>
          <Field label="FFmpeg folder (optional)" tip="Folder containing ffmpeg.exe and ffprobe.exe. Leave empty to auto-detect.">
            <input className="input" value={s.ffmpeg_path} onChange={(e) => set("ffmpeg_path", e.target.value)} placeholder="Auto-detect" />
          </Field>
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
            <button className="btn" onClick={close}>Cancel</button>
            <button className="btn primary" onClick={save} disabled={saving}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}
