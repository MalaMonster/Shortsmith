import { useEffect, useState } from "react";
import { Cpu, Download, ExternalLink, Loader2, RefreshCw, Sparkles, X, Zap } from "lucide-react";
import { api, waitJob, type GpuStatus, type UpdateInfo } from "../api";
import { saveNow, useStore } from "../store";

/** Global store slice for the update flow (kept tiny and local to this module). */
let listeners: ((u: UpdateInfo | null) => void)[] = [];
let current: UpdateInfo | null = null;
export const setUpdateInfo = (u: UpdateInfo | null) => { current = u; listeners.forEach((l) => l(u)); };
export function useUpdateInfo() {
  const [u, setU] = useState<UpdateInfo | null>(current);
  useEffect(() => { listeners.push(setU); return () => { listeners = listeners.filter((l) => l !== setU); }; }, []);
  return u;
}

/** Shared flag so the "engine not running" screen can say "updating" instead. */
export const updateState = { installing: false };

/** Checks GitHub on startup (if enabled) and shows a small card when a new version exists. */
export function UpdateNotifier() {
  const info = useUpdateInfo();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    api.settings().then((s) => {
      if (s.auto_update_check === false) return;
      api.updateCheck().then(setUpdateInfo).catch(() => {});
    }).catch(() => {});
  }, []);
  if (!info?.available) return null;
  const snoozed = sessionStorage.getItem(`ss-snooze-${info.latest}`) === "1";
  return (
    <>
      {!hidden && !snoozed && !open && (
        <div className="card" style={{ position: "fixed", left: 16, bottom: 16, zIndex: 1800, padding: "12px 14px", width: 330, boxShadow: "0 12px 40px rgba(0,0,0,.5)", borderColor: "var(--accent)" }}>
          <div className="row" style={{ marginBottom: 6 }}>
            <Sparkles size={15} color="var(--accent2)" /><b className="grow">Shortsmith {info.latest} is available</b>
            <button className="btn ghost sm icon" title="Remind me next time" onClick={() => { sessionStorage.setItem(`ss-snooze-${info.latest}`, "1"); setHidden(true); }}><X size={13} /></button>
          </div>
          <div className="hint" style={{ marginBottom: 10 }}>You have {info.current}. Your projects are kept when you update.</div>
          <div className="row">
            <button className="btn primary sm" onClick={() => setOpen(true)}><Download size={12} /> {info.can_install ? "Update…" : "What's new"}</button>
            <button className="btn sm ghost" onClick={() => { sessionStorage.setItem(`ss-snooze-${info.latest}`, "1"); setHidden(true); }}>Later</button>
          </div>
        </div>
      )}
      {open && <UpdateDialog info={info} onClose={() => setOpen(false)} />}
    </>
  );
}

export function UpdateDialog({ info, onClose }: { info: UpdateInfo; onClose: () => void }) {
  const [busy, setBusy] = useState<{ p: number; msg: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const install = async () => {
    setErr(null);
    await saveNow();
    try {
      const j = await api.updateInstall();
      setBusy({ p: 0, msg: "Starting download…" });
      const fin = await waitJob(j.id, (jj) => setBusy({ p: jj.progress, msg: jj.message }), 400);
      if (fin.status === "done") {
        updateState.installing = true;
        setBusy({ p: 1, msg: "Installing… Shortsmith will reopen by itself in a few seconds." });
      } else { setBusy(null); setErr(fin.error || "Update cancelled"); }
    } catch (e: any) { setBusy(null); setErr(e.message); }
  };
  return (
    <div className="modal-bg" onClick={busy ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header>Update to Shortsmith {info.latest}{!busy && <button className="btn ghost sm icon" onClick={onClose}><X size={14} /></button>}</header>
        <div style={{ padding: 16 }}>
          <div className="hint" style={{ marginBottom: 10 }}>Installed: {info.current} · Latest: {info.latest}{info.published ? ` · released ${new Date(info.published).toLocaleDateString()}` : ""}</div>
          {info.notes && <pre style={{ whiteSpace: "pre-wrap", background: "var(--bg2)", border: "1px solid var(--line)", borderRadius: 8, padding: 12, maxHeight: 260, overflow: "auto", fontFamily: "inherit", fontSize: 12.5, margin: "0 0 14px" }}>{info.notes}</pre>}
          {busy ? (
            <div className="card" style={{ padding: 12 }}>
              <div className="row" style={{ marginBottom: 8 }}><Loader2 size={14} className="spin" /> {busy.msg}</div>
              <div className="progress"><div style={{ width: `${busy.p * 100}%` }} /></div>
            </div>
          ) : info.can_install ? (
            <>
              {err && <div className="err-box" style={{ marginBottom: 10 }}>{err}</div>}
              <div className="row" style={{ justifyContent: "flex-end" }}>
                {info.page && <a className="btn ghost" href={info.page} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Release page</a>}
                <button className="btn" onClick={onClose}>Not now</button>
                <button className="btn primary" onClick={install}><Download size={14} /> Download & install{info.asset ? ` (${(info.asset.size / 2 ** 20).toFixed(0)} MB)` : ""}</button>
              </div>
              <div className="hint" style={{ marginTop: 10 }}>The installer is checked against the release's SHA-256 checksum, installs silently and reopens Shortsmith. Unsaved work is saved first.</div>
            </>
          ) : (
            <div className="hint">You're running Shortsmith from source. Update with <code>git pull</code> and run <code>setup.bat</code>, or install the release build from{" "}
              <a href={info.releases_url} target="_blank" rel="noreferrer" style={{ color: "var(--accent2)" }}>GitHub</a>.</div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Settings → Updates section. */
export function UpdatesSettings({ auto, onAuto }: { auto: boolean; onAuto: (v: boolean) => void }) {
  const info = useUpdateInfo();
  const health = useStore((s) => s.health);
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState(false);
  const check = async () => {
    setChecking(true);
    try { setUpdateInfo(await api.updateCheck(true)); } catch (e: any) { useStore.getState().toast("error", e.message); }
    finally { setChecking(false); }
  };
  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="grow">Version <b>{health?.version ?? "…"}</b>
          {info && !info.error && (info.available ? <span className="badge" style={{ marginLeft: 8, color: "var(--accent2)" }}>{info.latest} available</span> : info.latest ? <span className="badge" style={{ marginLeft: 8 }}>up to date</span> : null)}
        </span>
        <button className="btn sm" onClick={check} disabled={checking}>{checking ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />} Check now</button>
        {info?.available && <button className="btn sm primary" onClick={() => setOpen(true)}>Update…</button>}
      </div>
      {info?.error && <div className="hint" style={{ color: "var(--warn)", marginBottom: 6 }}>{info.error}</div>}
      <label className="row" style={{ gap: 8, cursor: "pointer" }}>
        <input type="checkbox" checked={auto} onChange={(e) => onAuto(e.target.checked)} /> Check for updates when Shortsmith starts
      </label>
      {open && info && <UpdateDialog info={info} onClose={() => setOpen(false)} />}
    </div>
  );
}

/** Settings → GPU pack section (installed build without the CUDA runtime). */
export function GpuPackSettings() {
  const [st, setSt] = useState<GpuStatus | null>(null);
  const [busy, setBusy] = useState<{ p: number; msg: string; id: string } | null>(null);
  useEffect(() => { api.gpu().then(setSt).catch(() => {}); }, []);
  if (!st) return null;
  const install = async () => {
    try {
      const j = await api.gpuInstall();
      setBusy({ p: 0, msg: "Starting…", id: j.id });
      const fin = await waitJob(j.id, (jj) => setBusy({ p: jj.progress, msg: jj.message, id: j.id }), 500);
      setBusy(null);
      if (fin.status === "done") {
        const r = fin.result;
        setSt(r);
        useStore.setState({ health: await api.health() });
        useStore.getState().toast(r.ready ? "success" : "info", r.ready ? "GPU acceleration is ready ⚡" : "GPU pack installed — restart Shortsmith to use it.");
      } else if (fin.status === "error") useStore.getState().toast("error", "GPU pack download failed", fin.error ?? undefined);
    } catch (e: any) { setBusy(null); useStore.getState().toast("error", e.message); }
  };
  return (
    <div className="hint">
      {!st.nvidia_gpu ? <span className="row"><Cpu size={12} /> No NVIDIA GPU found — transcription runs on the CPU.</span>
        : st.ready ? <span className="row" style={{ color: "var(--ok)" }}><Zap size={12} /> NVIDIA GPU acceleration is ready.</span>
        : busy ? (
          <div>
            <div className="row" style={{ marginBottom: 6 }}><Loader2 size={12} className="spin" /> <span className="grow">{busy.msg}</span>
              <button className="btn sm" onClick={() => api.cancelJob(busy.id)}>Cancel</button></div>
            <div className="progress"><div style={{ width: `${busy.p * 100}%` }} /></div>
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: 8 }}>An NVIDIA GPU was found. Download NVIDIA's cuBLAS runtime (about {st.download_mb} MB, from PyPI) to transcribe many times faster.</div>
            <button className="btn sm primary" onClick={install}><Zap size={12} /> Download GPU pack</button>
          </div>
        )}
    </div>
  );
}
