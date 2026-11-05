import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { useStore } from "../store";
import { api } from "../api";
import Home from "./Home";
import Editor from "./Editor";
import SettingsDialog from "./SettingsDialog";
import { UpdateNotifier, updateState } from "./Updates";

export default function App() {
  const project = useStore((s) => s.project);
  const showSettings = useStore((s) => s.showSettings);

  useEffect(() => {
    api.health().then((h) => useStore.setState({ health: h })).catch((e) => useStore.getState().toast("error", e.message));
    // reopen the last project after a reload
    const last = sessionStorage.getItem("shortsmith-open");
    if (last) api.loadProject(last).then((p) => useStore.getState().load(p, last)).catch(() => sessionStorage.removeItem("shortsmith-open"));
  }, []);

  const pid = useStore((s) => s.projectId);
  useEffect(() => {
    if (pid) sessionStorage.setItem("shortsmith-open", pid);
    else sessionStorage.removeItem("shortsmith-open");
  }, [pid]);

  // heartbeat: tells the launcher the window is still open (it quits the server after the window closes)
  const [engineDown, setEngineDown] = useState(false);
  useEffect(() => {
    let fails = 0, down = false, timer: ReturnType<typeof setTimeout>;
    const beat = () => {
      fetch("/api/ping", { method: "POST" })
        .then((r) => {
          if (!r.ok) throw new Error();
          // the engine came back (e.g. after an update) → reload to get the new version's interface
          if (down) { location.reload(); return; }
          fails = 0;
        })
        .catch(() => { if (++fails >= 2) { down = true; setEngineDown(true); } })
        .finally(() => { timer = setTimeout(beat, down || updateState.installing ? 1000 : 5000); });
    };
    beat();
    const bye = () => { if (!updateState.installing) navigator.sendBeacon("/api/bye"); };
    window.addEventListener("pagehide", bye);
    return () => { clearTimeout(timer); window.removeEventListener("pagehide", bye); };
  }, []);

  return (
    <>
      {engineDown && (
        <div className="modal-bg" style={{ zIndex: 3000 }}>
          <div className="modal" style={{ padding: 24, width: 440 }}>
            {updateState.installing ? (
              <>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }} className="row"><Loader2 size={16} className="spin" /> Installing the update…</div>
                <div className="hint">Shortsmith will reopen here by itself in a few seconds.</div>
              </>
            ) : (
              <>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>Shortsmith's engine isn't running</div>
                <div className="hint">Your work up to the last save is safe. Close this window and open Shortsmith again from its shortcut. (This window reconnects automatically if the engine comes back.)</div>
              </>
            )}
          </div>
        </div>
      )}
      <UpdateNotifier />
      {project ? <Editor /> : <Home />}
      {showSettings && <SettingsDialog />}
      <Toasts />
    </>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <div className="grow">
            <div>{t.text}</div>
            {t.detail && <details><summary className="hint" style={{ cursor: "pointer" }}>Details</summary><pre>{t.detail}</pre></details>}
          </div>
          <button className="btn ghost sm icon" onClick={() => dismiss(t.id)}><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}
