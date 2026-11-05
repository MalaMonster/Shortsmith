import { useEffect, useState } from "react";
import { Check, CloudOff, Home as HomeIcon, Keyboard, Loader2, Redo2, Settings, Undo2, X } from "lucide-react";
import { addCaption, deleteCaption, getVideoEl, mergeWithNext, saveNow, seek, splitCaption, stepFrames, togglePlay, useStore, useTime } from "../store";
import type { Step } from "../types";
import SourceView from "./SourceView";
import PreviewCanvas from "./PreviewCanvas";
import Timeline from "./Timeline";
import ImportPanel from "./panels/ImportPanel";
import SelectPanel from "./panels/SelectPanel";
import ArrangePanel from "./panels/ArrangePanel";
import SubtitlesPanel from "./panels/SubtitlesPanel";
import ExportPanel from "./panels/ExportPanel";
import { startDrag } from "./ui";

const STEPS: { id: Step; label: string }[] = [
  { id: "import", label: "Clip" },
  { id: "select", label: "Select" },
  { id: "arrange", label: "Arrange" },
  { id: "subtitles", label: "Subtitles" },
  { id: "export", label: "Export" },
];

function usePersisted(key: string, init: number): [number, (v: number) => void] {
  const [v, setV] = useState(() => Number(localStorage.getItem(key)) || init);
  return [v, (x) => { setV(x); localStorage.setItem(key, String(x)); }];
}

export default function Editor() {
  const step = useStore((s) => s.project!.ui.step);
  const name = useStore((s) => s.project!.name);
  const saveState = useStore((s) => s.saveState);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const [inspW, setInspW] = usePersisted("ss-insp-w", 360);
  const [tlH, setTlH] = usePersisted("ss-tl-h", 230);
  const [prevW, setPrevW] = usePersisted("ss-prev-w", 420);
  const [drag, setDrag] = useState<string | null>(null);
  const [showKeys, setShowKeys] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target as HTMLElement)?.isContentEditable;
      const st = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); void saveNow(); return; }
      if (typing) return;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? st.redo() : st.undo(); return; }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); st.redo(); return; }
      if (mod) return;
      const t = getVideoEl()?.currentTime ?? useTime.getState().t;
      const p = st.project!;
      switch (e.key) {
        case " ": e.preventDefault(); togglePlay(); break;
        case "ArrowLeft": e.preventDefault(); e.shiftKey ? seek(t - 1) : stepFrames(-1); break;
        case "ArrowRight": e.preventDefault(); e.shiftKey ? seek(t + 1) : stepFrames(1); break;
        case "Home": seek(p.clip.start); break;
        case "End": seek(p.clip.end - 0.01); break;
        case "i": case "I": st.update((d) => { d.clip.start = Math.min(t, d.clip.end - 0.2); }); break;
        case "o": case "O": st.update((d) => { d.clip.end = Math.max(t, d.clip.start + 0.2); }); break;
        case "n": case "N": addCaption(t); break;
        case "s": case "S": if (st.selectedCaption) splitCaption(st.selectedCaption, { time: t }); break;
        case "m": case "M": if (st.selectedCaption) mergeWithNext(st.selectedCaption); break;
        case "Delete": case "Backspace": if (st.selectedCaption) deleteCaption(st.selectedCaption); break;
        case "Escape": st.set({ selectedCaption: null, drawMode: null }); break;
        case "?": setShowKeys((v) => !v); break;
        default:
          if (/^[1-5]$/.test(e.key)) st.setStep(STEPS[Number(e.key) - 1].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const resizer = (id: string, axis: "x" | "y", get: () => number, setter: (v: number) => void, sign = 1, min = 200, max = 900) =>
    (e: React.PointerEvent) => {
      const v0 = get();
      setDrag(id);
      startDrag(e, (dx, dy) => setter(Math.max(min, Math.min(max, v0 + sign * (axis === "x" ? dx : dy)))), () => setDrag(null));
    };

  const idx = STEPS.findIndex((s) => s.id === step);
  return (
    <div className="app">
      <div className="topbar">
        <div className="logo" title="Back to projects" onClick={async () => { await saveNow(); useStore.getState().close(); }}>
          <div className="logo-mark" />
        </div>
        <button className="btn ghost sm" onClick={async () => { await saveNow(); useStore.getState().close(); }}><HomeIcon size={14} /> Projects</button>
        <input className="input" style={{ width: 200, height: 28, background: "transparent", borderColor: "transparent", fontWeight: 600 }}
          value={name} title="Project name" onChange={(e) => useStore.getState().update((d) => { d.name = e.target.value; }, { coalesce: "name" })} />
        <div className="steps">
          {STEPS.map((s, i) => (
            <button key={s.id} className={`${s.id === step ? "on" : ""} ${i < idx ? "done" : ""}`} onClick={() => useStore.getState().setStep(s.id)} title={`${s.label} (${i + 1})`}>
              <span className="n">{i < idx ? <Check size={11} /> : i + 1}</span>{s.label}
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 2 }}>
          <button className="btn ghost icon" disabled={!canUndo} onClick={() => useStore.getState().undo()} title="Undo (Ctrl+Z)"><Undo2 size={16} /></button>
          <button className="btn ghost icon" disabled={!canRedo} onClick={() => useStore.getState().redo()} title="Redo (Ctrl+Y)"><Redo2 size={16} /></button>
        </div>
        <div className="save-state" title="Projects save automatically">
          {saveState === "saved" && <><Check size={13} color="var(--ok)" /> Saved</>}
          {saveState === "saving" && <><Loader2 size={13} className="spin" /> Saving…</>}
          {saveState === "dirty" && <><Loader2 size={13} /> Editing…</>}
          {saveState === "error" && <span style={{ color: "var(--err)" }} className="row"><CloudOff size={13} /> Not saved</span>}
        </div>
        <button className="btn ghost icon" onClick={() => setShowKeys(true)} title="Keyboard shortcuts (?)"><Keyboard size={16} /></button>
        <button className="btn ghost icon" onClick={() => useStore.setState({ showSettings: true })} title="Settings"><Settings size={16} /></button>
      </div>

      <div className="editor" style={{ gridTemplateRows: `1fr auto ${tlH}px` }}>
        <div className="workspace">
          <div className="inspector" style={{ width: inspW, flex: "none" }} onScroll={(e) => { if (e.currentTarget.scrollLeft) e.currentTarget.scrollLeft = 0; }}>
            {step === "import" && <ImportPanel />}
            {step === "select" && <SelectPanel />}
            {step === "arrange" && <ArrangePanel />}
            {step === "subtitles" && <SubtitlesPanel />}
            {step === "export" && <ExportPanel />}
          </div>
          <div className={`splitter-v ${drag === "insp" ? "drag" : ""}`} onPointerDown={resizer("insp", "x", () => inspW, setInspW, 1, 280, 700)} />
          <div className="stage">
            <div className="stage-pane" style={{ flex: 1 }}>
              <SourceView />
            </div>
            <div className={`splitter-v ${drag === "prev" ? "drag" : ""}`} onPointerDown={resizer("prev", "x", () => prevW, setPrevW, -1, 240, 1100)} />
            <div className="stage-pane" style={{ width: prevW, flex: "none", borderLeft: "1px solid var(--line)" }}>
              <PreviewCanvas />
            </div>
          </div>
        </div>
        <div className={`splitter-h ${drag === "tl" ? "drag" : ""}`} onPointerDown={resizer("tl", "y", () => tlH, setTlH, -1, 130, 600)} />
        <Timeline />
      </div>
      {showKeys && <KeysDialog onClose={() => setShowKeys(false)} />}
    </div>
  );
}

function KeysDialog({ onClose }: { onClose: () => void }) {
  const keys: [string, string][] = [
    ["Space", "Play / pause (loops the clip)"], ["← / →", "Previous / next frame"], ["Shift + ← / →", "Jump 1 second"],
    ["Home / End", "Go to clip start / end"], ["I / O", "Set clip start / end at playhead"], ["1 – 5", "Switch step"],
    ["N", "New caption at playhead"], ["S", "Split selected caption at playhead"], ["M", "Merge selected caption with next"],
    ["Delete", "Delete selected caption"], ["Esc", "Deselect / cancel drawing"], ["Ctrl + Z / Ctrl + Y", "Undo / redo"],
    ["Ctrl + S", "Save now (also autosaves)"], ["Shift + drag", "Resize a region freely / move one caption only"], ["Mouse wheel on preview", "Zoom the section under the cursor"],
  ];
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header>Keyboard shortcuts <button className="btn ghost icon sm" onClick={onClose}><X size={14} /></button></header>
        <div style={{ padding: 16 }} className="kv">
          {keys.map(([k, d]) => [<span key={k}><span className="kbd">{k}</span></span>, <span key={k + "d"}>{d}</span>])}
        </div>
      </div>
    </div>
  );
}
