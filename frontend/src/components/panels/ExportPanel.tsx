import { useEffect, useState } from "react";
import { CheckCircle2, Download, ExternalLink, FolderOpen, Loader2, MonitorPlay, X } from "lucide-react";
import { api, waitJob } from "../../api";
import { saveNow, useStore } from "../../store";
import { buildExportForm, outputFps } from "../../engine/exporter";
import type { ExportCfg } from "../../types";
import { Field, Section, Seg, Slider, Toggle, fmtTime } from "../ui";

export default function ExportPanel() {
  const p = useStore((s) => s.project!);
  const health = useStore((s) => s.health);
  const job = useStore((s) => s.jobs.export);
  const upd = useStore((s) => s.update);
  const e = p.export;
  const [prep, setPrep] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const set = <K extends keyof ExportCfg>(k: K, v: ExportCfg[K]) => upd((d) => { d.export[k] = v; }, { coalesce: `exp-${k}` });

  useEffect(() => {
    if (!e.output) api.defaultExportPath(p.name).then((r) => upd((d) => { d.export.output = r.path; }, { history: false })).catch(() => {});
  }, []);

  const nvenc = !!health?.ffmpeg.encoders?.h264_nvenc;
  const running = job && (job.status === "running" || job.status === "queued");
  const fps = outputFps(p);
  const clipCaps = p.captions.filter((c) => c.end > p.clip.start && c.start < p.clip.end).length;

  const browse = async () => {
    try { const r = await api.saveDialog(e.output); if (r.path) set("output", r.path); }
    catch (err: any) { useStore.getState().toast("error", err.message); }
  };

  const start = async () => {
    setResult(null);
    await saveNow();
    let out = e.output.trim();
    if (!out) out = (await api.defaultExportPath(p.name)).path;
    try {
      setPrep("Preparing…");
      const fd = await buildExportForm(p, out, (_f, msg) => setPrep(msg));
      setPrep("Uploading subtitle layers…");
      const j = await api.exportVideo(fd);
      setPrep(null);
      useStore.setState({ jobs: { ...useStore.getState().jobs, export: j } });
      const fin = await waitJob(j.id, (jj) => useStore.setState({ jobs: { ...useStore.getState().jobs, export: jj } }), 500);
      if (fin.status === "done") {
        setResult(fin.result);
        useStore.getState().toast("success", "Export finished");
        // next export gets a fresh name so nothing is overwritten by accident
        api.defaultExportPath(p.name).then((r) => upd((d) => { d.export.output = r.path; }, { history: false }));
      } else if (fin.status === "error") useStore.getState().toast("error", "Export failed", fin.error ?? undefined);
    } catch (err: any) {
      setPrep(null);
      useStore.getState().toast("error", `Export failed: ${err.message}`);
    }
  };

  return (
    <div>
      <Section title={<><MonitorPlay size={14} color="#ff4444" /> YouTube Shorts preset</>}>
        <div className="kv" style={{ marginBottom: 10 }}>
          <span>Format</span><span>MP4 · H.264 High · AAC 48 kHz</span>
          <span>Size</span><span>{e.resolution.replace("x", " × ")} (9:16)</span>
          <span>Frame rate</span><span>{+fps.toFixed(3)} fps{e.fps === "source" ? " (matches source)" : ""}</span>
          <span>Length</span><span>{fmtTime(p.clip.end - p.clip.start)}{p.clip.end - p.clip.start > 180 ? " ⚠ over 3 min" : ""}</span>
          <span>Subtitles</span><span>{e.burnSubtitles ? `${clipCaps} burned in` : "not burned in"}{e.srt ? " + .srt file" : ""}</span>
        </div>
        <button className="btn sm ghost" onClick={() => upd((d) => { Object.assign(d.export, { resolution: "1080x1920", fps: "source", quality: "high", encoder: "libx264", burnSubtitles: true, audioBitrate: 192 }); })}>Reset to recommended</button>
      </Section>

      <Section title="Video">
        <Field label="Resolution">
          <select className="input" value={e.resolution} onChange={(ev) => set("resolution", ev.target.value as ExportCfg["resolution"])}>
            <option value="1080x1920">1080 × 1920 (recommended)</option>
            <option value="1440x2560">1440 × 2560 (sharper, larger file)</option>
            <option value="2160x3840">2160 × 3840 (4K)</option>
            <option value="720x1280">720 × 1280 (small)</option>
          </select>
        </Field>
        <Field label="Frame rate">
          <Seg value={e.fps} onChange={(v) => set("fps", v)} options={[{ v: "source", label: `Source (${p.source.fps})` }, { v: "30", label: "30" }, { v: "60", label: "60" }]} />
        </Field>
        <Field label="Quality" tip="Higher quality = larger file. 'High' is visually lossless for YouTube's re-encode.">
          <Seg value={e.quality} onChange={(v) => set("quality", v)} options={[{ v: "max", label: "Max" }, { v: "high", label: "High" }, { v: "balanced", label: "Balanced" }, { v: "fast", label: "Fast" }]} />
        </Field>
        <Field label="Encoder" tip="x264 (CPU) gives the best quality per MB. NVENC uses your NVIDIA GPU and is much faster.">
          <Seg value={e.encoder} onChange={(v) => set("encoder", v)} options={[
            { v: "libx264", label: "x264 (CPU, best)" },
            ...(nvenc ? [{ v: "h264_nvenc" as const, label: "NVENC (GPU, fast)" }] : []),
          ]} />
        </Field>
      </Section>

      <Section title="Audio & subtitles">
        <Field label="Audio">
          <select className="input" value={e.audioMode === "track" ? `t${e.audioIndex}` : e.audioMode} onChange={(ev) => {
            const v = ev.target.value;
            upd((d) => {
              if (v === "mix" || v === "none") d.export.audioMode = v;
              else { d.export.audioMode = "track"; d.export.audioIndex = Number(v.slice(1)); }
            });
          }}>
            {p.source.audio.map((a) => <option key={a.index} value={`t${a.index}`}>Track {a.index + 1}{a.title ? ` — ${a.title}` : ""}</option>)}
            {p.source.audio.length > 1 && <option value="mix">Mix all tracks</option>}
            <option value="none">No audio</option>
          </select>
        </Field>
        {e.audioMode !== "none" && (
          <div className="row">
            <Field label="Volume"><Slider value={e.volume} min={0} max={2} step={0.01} digits={0} display={{ scale: 100 }} suffix="%" onChange={(v) => set("volume", v)} /></Field>
            <Field label="Bitrate">
              <select className="input" value={e.audioBitrate} onChange={(ev) => set("audioBitrate", Number(ev.target.value))}>
                {[128, 192, 256, 320].map((b) => <option key={b} value={b}>{b} kb/s</option>)}
              </select>
            </Field>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Toggle on={e.burnSubtitles} onChange={(v) => set("burnSubtitles", v)} label="Burn subtitles into the video" />
          <Toggle on={e.srt} onChange={(v) => set("srt", v)} label="Also save an .srt subtitle file" />
        </div>
      </Section>

      <Section title="Save to">
        <div className="row">
          <input className="input grow" value={e.output} onChange={(ev) => set("output", ev.target.value)} placeholder="Output .mp4 path" />
          <button className="btn icon" onClick={browse} title="Choose location…"><FolderOpen size={14} /></button>
        </div>
      </Section>

      <div style={{ padding: 16 }}>
        {running || prep ? (
          <div className="card" style={{ padding: 12 }}>
            <div className="row" style={{ marginBottom: 8 }}><Loader2 size={14} className="spin" /><span className="grow">{prep ?? job?.message ?? "Rendering…"}</span>
              {job && !prep && <button className="btn sm" onClick={() => api.cancelJob(job.id)}><X size={12} /> Cancel</button>}</div>
            <div className="progress"><div style={{ width: `${(prep ? 0.02 : job?.progress ?? 0) * 100}%` }} /></div>
          </div>
        ) : (
          <button className="btn primary lg" style={{ width: "100%", justifyContent: "center" }} onClick={start}><Download size={16} /> Export short</button>
        )}
        {job?.status === "error" && !running && (
          <div className="err-box" style={{ marginTop: 12 }}><b>Export failed.</b> Your project is safe — adjust settings and try again.
            <pre>{job.error}</pre></div>
        )}
        {result && (
          <div className="ok-box" style={{ marginTop: 12 }}>
            <div className="row" style={{ marginBottom: 6 }}><CheckCircle2 size={15} color="var(--ok)" /><b>Your short is ready</b></div>
            <div className="hint" style={{ wordBreak: "break-all", marginBottom: 8 }}>{result.output}</div>
            <div className="kv" style={{ marginBottom: 10 }}>
              <span>Video</span><span>{result.width}×{result.height} · {result.fps} fps · {result.video_codec}</span>
              <span>Audio</span><span>{result.audio?.[0] ? `${result.audio[0].codec} · ${result.audio[0].sample_rate / 1000} kHz` : "none"}</span>
              <span>Length</span><span>{fmtTime(result.duration)}</span>
              <span>Size</span><span>{(result.size / 1e6).toFixed(1)} MB</span>
            </div>
            <div className="row">
              <button className="btn sm" onClick={() => api.reveal(result.output)}><FolderOpen size={12} /> Show in folder</button>
              <button className="btn sm" onClick={() => api.open(result.output)}><ExternalLink size={12} /> Play</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
