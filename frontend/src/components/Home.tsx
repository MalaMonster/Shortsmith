import { useEffect, useState } from "react";
import { AlertTriangle, Clock, Film, FolderOpen, Loader2, Settings, Trash2, Upload } from "lucide-react";
import { api, thumbUrl, type ProjectSummary } from "../api";
import { useStore } from "../store";
import { newProject } from "../defaults";
import { fmtTime } from "./ui";

export async function importVideo(path: string) {
  const info = await api.probe(path);
  const p = newProject(info);
  const { id } = await api.createProject(p);
  useStore.getState().load({ ...p, id }, id);
}

export default function Home() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const [over, setOver] = useState(false);
  const health = useStore((s) => s.health);
  const toast = useStore((s) => s.toast);

  const refresh = () => api.projects().then(setProjects).catch((e) => toast("error", e.message));
  useEffect(() => { void refresh(); }, []);

  const doImport = async (p: string) => {
    if (!p.trim()) return;
    setBusy("Reading video…");
    try { await importVideo(p.trim().replace(/^"|"$/g, "")); }
    catch (e: any) { toast("error", `Couldn't import: ${e.message}`); }
    finally { setBusy(null); }
  };

  const browse = async () => {
    setBusy("Waiting for file dialog…");
    try {
      const { path } = await api.openDialog();
      if (path) await doImport(path);
    } catch (e: any) { toast("error", e.message); }
    finally { setBusy(null); }
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault(); setOver(false);
    const f = e.dataTransfer.files[0];
    if (!f) return;
    setBusy(`Copying ${f.name}… 0%`);
    try {
      const { path } = await api.upload(f, (x) => setBusy(`Copying ${f.name}… ${(x * 100).toFixed(0)}%`));
      await doImport(path);
    } catch (e: any) { toast("error", `Upload failed: ${e.message}`); setBusy(null); }
  };

  const open = async (id: string) => {
    try { const p = await api.loadProject(id); useStore.getState().load(p, id); }
    catch (e: any) { toast("error", e.message); }
  };

  return (
    <div className="home">
      <div className="topbar" style={{ height: 48 }}>
        <div className="logo"><div className="logo-mark" />Shortsmith{health?.version && <span className="badge" style={{ fontWeight: 500 }}>v{health.version}</span>}</div>
        <div style={{ marginLeft: "auto" }} />
        <button className="btn ghost" onClick={() => useStore.setState({ showSettings: true })}><Settings size={15} /> Settings</button>
      </div>
      <div className="home-inner">
        {health?.ffmpeg.error && (
          <div className="err-box" style={{ marginBottom: 20 }}>
            <b><AlertTriangle size={13} /> FFmpeg not found.</b> Video import and export need FFmpeg. Run <code>setup.bat</code>, or install it
            with <code>winget install Gyan.FFmpeg</code> and restart. You can also set its folder in Settings.
          </div>
        )}
        <div className="hero">
          <div className={`drop card ${over ? "over" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)} onDrop={onDrop}>
            <Film size={40} color="var(--accent2)" />
            <div style={{ fontSize: 20, fontWeight: 800 }}>Turn a gaming clip into a Short</div>
            <div className="hint" style={{ maxWidth: 380 }}>Import a recording (MP4, MOV, MKV, WebM…). Pick your facecam and gameplay,
              generate subtitles with AI, and export a 1080×1920 video ready for YouTube Shorts.</div>
            {busy ? (
              <div className="row" style={{ marginTop: 10 }}><Loader2 className="spin" size={16} /> {busy}</div>
            ) : (
              <>
                <button className="btn primary lg" onClick={browse} style={{ marginTop: 8 }}><FolderOpen size={17} /> Import video…</button>
                <div className="row" style={{ width: "100%", maxWidth: 460 }}>
                  <input className="input" placeholder="…or paste a file path, e.g. D:\Videos\clip.mkv" value={path}
                    onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doImport(path)} />
                  <button className="btn" onClick={() => doImport(path)} disabled={!path.trim()}>Open</button>
                </div>
                <div className="hint"><Upload size={11} /> You can also drag a file here (it gets copied — "Import video…" uses the original in place).</div>
              </>
            )}
          </div>
          <div className="card" style={{ padding: 22 }}>
            <div style={{ fontWeight: 700, marginBottom: 12 }}>How it works</div>
            {[
              ["Select", "Drag boxes over your facecam and the gameplay on the original video."],
              ["Arrange", "Facecam on top, gameplay below. Drag the divider to change the split and gap."],
              ["Subtitles", "One click AI transcription — with separate, simultaneously visible tracks per speaker."],
              ["Export", "H.264/AAC MP4 at 1080×1920, 30/60 fps, subtitles burned in."],
            ].map(([t, d], i) => (
              <div key={t} className="row" style={{ alignItems: "flex-start", marginBottom: 12 }}>
                <div style={{ width: 22, height: 22, borderRadius: 11, background: "var(--panel2)", border: "1px solid var(--line2)", display: "grid", placeItems: "center", fontSize: 11, flex: "none" }}>{i + 1}</div>
                <div><div style={{ fontWeight: 600 }}>{t}</div><div className="hint">{d}</div></div>
              </div>
            ))}
            <div className="hint" style={{ marginTop: 8 }}>
              Transcription runs locally ({health?.cuda ? "NVIDIA GPU detected ⚡" : "CPU"}) — no account or API key needed.
            </div>
          </div>
        </div>

        <div style={{ margin: "36px 0 14px", display: "flex", alignItems: "center", gap: 8 }}>
          <Clock size={15} color="var(--muted)" /><b>Recent projects</b>
        </div>
        {projects === null ? <div className="hint">Loading…</div> : projects.length === 0 ? (
          <div className="hint">No projects yet. Projects save automatically as you edit.</div>
        ) : (
          <div className="proj-grid">
            {projects.map((p) => (
              <div key={p.id} className="card proj" onClick={() => open(p.id)}>
                {p.source_exists ? <img src={thumbUrl(p.source_path, 1)} alt="" loading="lazy" /> :
                  <div style={{ aspectRatio: "16/9", display: "grid", placeItems: "center", background: "#000" }} className="hint">Source file missing</div>}
                <div style={{ padding: "10px 12px" }}>
                  <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                  <div className="hint">{fmtTime(p.duration, false)} clip · {p.captions} captions · {new Date(p.updated * 1000).toLocaleString()}</div>
                </div>
                <button className="btn sm icon danger del" title="Delete project (the video file is not touched)"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!confirm(`Delete project "${p.name}"? Your video file is not deleted.`)) return;
                    await api.deleteProject(p.id); void refresh();
                  }}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
