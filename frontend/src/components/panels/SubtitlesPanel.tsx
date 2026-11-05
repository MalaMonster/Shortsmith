import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, Loader2, Merge, Palette, Plus, Scissors, Sparkles, Trash2, Users, X, ListChecks, MapPin, Settings2 } from "lucide-react";
import { api, waitJob } from "../../api";
import {
  addCaption, addTrack, applyTranscription, deleteCaption, deleteTrack, mergeWithNext, seek, splitCaption,
  updateCaption, useStore, useTime, type TranscribeResult,
} from "../../store";
import { CAPTION_LENGTHS, LANGUAGES } from "../../defaults";
import type { Caption, Project } from "../../types";
import { Field, NumberInput, Section, Seg, Slider, Tip, Toggle, fmtTime } from "../ui";
import StyleEditor from "./StyleEditor";
import { NextStep } from "./ImportPanel";

type Tab = "generate" | "captions" | "style";

export default function SubtitlesPanel() {
  const [tab, setTab] = useState<Tab>(() => (useStore.getState().project!.captions.length ? "captions" : "generate"));
  const n = useStore((s) => s.project!.captions.length);
  return (
    <div>
      <div className="tabs">
        <button className={tab === "generate" ? "on" : ""} onClick={() => setTab("generate")}><Sparkles size={13} /> Generate</button>
        <button className={tab === "captions" ? "on" : ""} onClick={() => setTab("captions")}><ListChecks size={13} /> Captions <span className="badge">{n}</span></button>
        <button className={tab === "style" ? "on" : ""} onClick={() => setTab("style")}><Palette size={13} /> Style</button>
      </div>
      {tab === "generate" && <GenerateTab onDone={() => setTab("captions")} />}
      {tab === "captions" && <CaptionsTab />}
      {tab === "style" && <StyleTab />}
      <NextStep to="export" label="Next: export" />
    </div>
  );
}

// ---------------------------------------------------------------- generate
function GenerateTab({ onDone }: { onDone: () => void }) {
  const p = useStore((s) => s.project!);
  const job = useStore((s) => s.jobs.transcribe);
  const health = useStore((s) => s.health);
  const [opts, setOpts] = useState(() => {
    const saved = JSON.parse(localStorage.getItem("ss-stt") || "{}");
    return { language: "auto", audio: 0, diarize: true, speakers: 0, length: "standard" as keyof typeof CAPTION_LENGTHS, target: "speakers", prompt: "", ...saved };
  });
  const [provider, setProvider] = useState<string>("local");
  useEffect(() => { api.settings().then((s) => setProvider(s.provider)).catch(() => {}); }, []);
  const set = (k: string, v: unknown) => { const o = { ...opts, [k]: v }; setOpts(o); localStorage.setItem("ss-stt", JSON.stringify({ ...o, target: "speakers" })); };
  const audio = p.source.audio;
  const running = job && (job.status === "running" || job.status === "queued");
  const existing = p.captions.filter((c) => c.start < p.clip.end && c.end > p.clip.start).length;
  const target = opts.target === "speakers" || p.tracks.some((t) => t.id === opts.target) ? opts.target : "speakers";

  const run = async () => {
    if (existing && !confirm(`Replace the ${existing} existing caption(s) in this clip on the affected track(s)?`)) return;
    const seg = CAPTION_LENGTHS[opts.length as keyof typeof CAPTION_LENGTHS];
    try {
      const j = await api.transcribe({
        path: p.source.path, start: p.clip.start, end: p.clip.end, audio_index: opts.audio, language: opts.language,
        diarize: target === "speakers" && opts.diarize, num_speakers: opts.speakers, prompt: opts.prompt,
        segmentation: { max_words: seg.max_words, max_chars: seg.max_chars, max_duration: seg.max_duration, pause_split: seg.pause_split },
      });
      useStore.setState({ jobs: { ...useStore.getState().jobs, transcribe: j } });
      const fin = await waitJob(j.id, (jj) => useStore.setState({ jobs: { ...useStore.getState().jobs, transcribe: jj } }), 500);
      if (fin.status === "done") {
        const res = fin.result as TranscribeResult;
        if (!res.captions.length) { useStore.getState().toast("info", "No speech was found in this clip/audio track."); return; }
        applyTranscription(res, target, p.clip);
        useStore.getState().toast("success", `${res.captions.length} captions · ${res.speakers > 1 ? `${res.speakers} speakers · ` : ""}${res.language?.toUpperCase() || ""} · ${res.model} (${res.device})`);
        onDone();
      } else if (fin.status === "error") {
        useStore.getState().toast("error", `Transcription failed: ${fin.error}`, fin.detail ?? undefined);
      }
    } catch (e: any) {
      useStore.getState().toast("error", e.message);
    }
  };

  return (
    <div>
      <Section title={<><Sparkles size={13} /> AI subtitles</>}>
        <div className="hint" style={{ marginBottom: 12 }}>
          Transcribes the clip ({fmtTime(p.clip.end - p.clip.start, false)}) with Whisper{provider === "local" ? ` on your ${health?.cuda ? "GPU" : "CPU"}` : " via your cloud API"} and times every word.
          Your edits are never lost — undo with <span className="kbd">Ctrl+Z</span>.
        </div>
        {provider === "local" && health?.gpu?.needs_pack && (
          <div className="card" style={{ padding: 10, marginBottom: 12, borderColor: "var(--accent)" }}>
            <div className="hint" style={{ marginBottom: 6 }}>⚡ An NVIDIA GPU was found. Install the free GPU pack to transcribe many times faster.</div>
            <button className="btn sm" onClick={() => useStore.setState({ showSettings: true })}>Open GPU settings</button>
          </div>
        )}
        <Field label="Spoken language">
          <select className="input" value={opts.language} onChange={(e) => set("language", e.target.value)}>
            {LANGUAGES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
        </Field>
        {audio.length > 1 && (
          <Field label="Audio track" tip="Recordings from OBS often have separate tracks (e.g. your mic and a friend/Discord). Transcribing each into its own subtitle track gives perfect simultaneous subtitles.">
            <select className="input" value={opts.audio} onChange={(e) => set("audio", Number(e.target.value))}>
              {audio.map((a) => <option key={a.index} value={a.index}>Track {a.index + 1}{a.title ? ` — ${a.title}` : ""} ({a.channels}ch)</option>)}
              <option value={-1}>All tracks mixed</option>
            </select>
          </Field>
        )}
        <Field label="Put subtitles on">
          <select className="input" value={target} onChange={(e) => set("target", e.target.value)}>
            <option value="speakers">One track per speaker (auto)</option>
            {p.tracks.map((t) => <option key={t.id} value={t.id}>{t.name} only</option>)}
          </select>
        </Field>
        {target === "speakers" && (
          <div className="row" style={{ marginBottom: 10, justifyContent: "space-between" }}>
            <Toggle on={opts.diarize} onChange={(v) => set("diarize", v)} label={<span className="row" style={{ gap: 5 }}><Users size={13} /> Detect speakers</span>} />
            {opts.diarize && (
              <select className="input sm" style={{ width: 120 }} value={opts.speakers} onChange={(e) => set("speakers", Number(e.target.value))}>
                <option value={0}>Auto count</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} speaker{n > 1 ? "s" : ""}</option>)}
              </select>
            )}
          </div>
        )}
        <Field label="Caption length">
          <Seg value={opts.length} onChange={(v) => set("length", v)} options={Object.entries(CAPTION_LENGTHS).map(([k, v]) => ({ v: k as any, label: v.label.split(" ")[0], title: v.label }))} />
        </Field>
        <Field label="Names & words to spell correctly" tip="Optional. Gamer tags, game names and slang help Whisper spell things right, e.g. 'Luigi, Bowser, speedrun, GG'.">
          <input className="input" value={opts.prompt} placeholder="e.g. Luigi, Kaizo, frame-perfect" onChange={(e) => set("prompt", e.target.value)} />
        </Field>

        {running ? (
          <div className="card" style={{ padding: 12 }}>
            <div className="row" style={{ marginBottom: 8 }}><Loader2 size={14} className="spin" /> <span className="grow">{job!.message || "Starting…"}</span>
              <button className="btn sm" onClick={() => api.cancelJob(job!.id)}><X size={12} /> Cancel</button></div>
            <div className="progress"><div style={{ width: `${job!.progress * 100}%` }} /></div>
            <div className="hint" style={{ marginTop: 8 }}>The first run downloads the speech model (~0.5–1.6 GB). You can keep editing meanwhile.</div>
          </div>
        ) : (
          <button className="btn primary lg" style={{ width: "100%", justifyContent: "center" }} onClick={run} disabled={!audio.length}>
            <Sparkles size={16} /> Generate subtitles
          </button>
        )}
        {!audio.length && <div className="hint" style={{ marginTop: 8, color: "var(--warn)" }}>This video has no audio track — add captions manually in the Captions tab.</div>}
        {job?.status === "error" && <div className="err-box" style={{ marginTop: 10 }}><b>Transcription failed.</b> {job.error}<div className="hint" style={{ marginTop: 4 }}>Your project is unchanged. Check Settings (model / provider) and try again.</div></div>}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn sm ghost" onClick={() => useStore.setState({ showSettings: true })}><Settings2 size={12} /> Model & provider settings</button>
        </div>
      </Section>
      <Section title="Manual">
        <div className="hint" style={{ marginBottom: 10 }}>Prefer typing? Add captions at the playhead (<span className="kbd">N</span>) or double-click a subtitle lane on the timeline.</div>
        <button className="btn" onClick={() => { addCaption(useTime.getState().t); }}><Plus size={13} /> Add caption at playhead</button>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------- captions list
function CaptionsTab() {
  const p = useStore((s) => s.project!);
  const selected = useStore((s) => s.selectedCaption);
  const [filter, setFilter] = useState<string>("all");
  const [onlyClip, setOnlyClip] = useState(true);
  const t = useTime((s) => Math.round(s.t * 10) / 10);
  const list = useMemo(() => p.captions
    .filter((c) => (filter === "all" || c.trackId === filter) && (!onlyClip || (c.end > p.clip.start && c.start < p.clip.end)))
    .sort((a, b) => a.start - b.start), [p.captions, filter, onlyClip, p.clip]);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selected) return;
    listRef.current?.querySelector(`[data-id="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <div>
      <TracksSection p={p} />
      <Section title={<>Captions <span className="badge">{list.length}</span></>}
        right={<button className="btn sm" onClick={() => addCaption(useTime.getState().t, filter !== "all" ? filter : undefined)} title="New caption at playhead (N)"><Plus size={12} /> Add</button>}>
        <div className="row" style={{ marginBottom: 10 }}>
          <select className="input sm" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 150 }}>
            <option value="all">All speakers</option>
            {p.tracks.map((tr) => <option key={tr.id} value={tr.id}>{tr.name}</option>)}
          </select>
          <Toggle on={onlyClip} onChange={setOnlyClip} label={<span className="hint">In clip only</span>} />
        </div>
        {list.length === 0 && <div className="hint">No captions yet. Generate them with AI or press <span className="kbd">N</span> to add one.</div>}
        <div className="cap-list" ref={listRef}>
          {list.map((c) => <CaptionItem key={c.id} c={c} p={p} sel={selected === c.id} live={t >= c.start && t < c.end} />)}
        </div>
      </Section>
    </div>
  );
}

function CaptionItem({ c, p, sel, live }: { c: Caption; p: Project; sel: boolean; live: boolean }) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const track = p.tracks.find((t) => t.id === c.trackId);
  const select = () => useStore.setState({ selectedCaption: c.id, selectedTrack: c.trackId });
  return (
    <div className={`cap-item ${sel ? "sel" : ""} ${live ? "live" : ""}`} data-id={c.id} onClick={select}>
      <div className="meta">
        <span className="dot" style={{ background: track?.style.color, boxShadow: "0 0 0 1px #000" }} />
        <select className="input sm" style={{ width: 110 }} value={c.trackId} title="Speaker / track"
          onChange={(e) => updateCaption(c.id, { trackId: e.target.value })} onClick={(e) => e.stopPropagation()}>
          {p.tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <span className="grow" />
        <button className="btn sm ghost" style={{ padding: "0 4px", fontFamily: "monospace" }} title="Jump to caption" onClick={(e) => { e.stopPropagation(); seek(c.start + 0.001); select(); }}>
          {fmtTime(c.start - p.clip.start)}
        </button>
      </div>
      <textarea ref={taRef} className="input" rows={2} value={c.text} onFocus={select}
        onChange={(e) => updateCaption(c.id, { text: e.target.value }, `text-${c.id}`)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); splitCaption(c.id, { charIndex: taRef.current!.selectionStart }); }
        }} />
      {sel && (
        <>
          <div className="row" style={{ gap: 6 }}>
            <span className="hint">Start</span>
            <NumberInput value={c.start} step={0.05} digits={2} min={0} max={c.end - 0.05} className="sm" onChange={(v) => updateCaption(c.id, { start: v })} />
            <span className="hint">End</span>
            <NumberInput value={c.end} step={0.05} digits={2} min={c.start + 0.05} className="sm" onChange={(v) => updateCaption(c.id, { end: v })} />
            <span className="hint">{(c.end - c.start).toFixed(2)}s</span>
          </div>
          <div className="row wrap" style={{ gap: 4 }}>
            <button className="btn sm" title="Set start to playhead" onClick={() => updateCaption(c.id, { start: Math.min(useTime.getState().t, c.end - 0.05) })}>⇤ Start</button>
            <button className="btn sm" title="Set end to playhead" onClick={() => updateCaption(c.id, { end: Math.max(useTime.getState().t, c.start + 0.05) })}>End ⇥</button>
            <button className="btn sm" title="Split at the text cursor (Enter in the text box) or at the playhead (S)"
              onClick={() => {
                const ta = taRef.current!;
                const t = useTime.getState().t;
                if (document.activeElement === ta || (t <= c.start || t >= c.end)) splitCaption(c.id, { charIndex: ta.selectionStart || Math.floor(c.text.length / 2) });
                else splitCaption(c.id, { time: t });
              }}><Scissors size={12} /> Split</button>
            <button className="btn sm" title="Merge with the next caption of this speaker (M)" onClick={() => mergeWithNext(c.id)}><Merge size={12} /> Merge</button>
            <button className={`btn sm ${c.pos ? "active" : ""}`} title="Give this caption its own position (or Shift+drag it in the preview)"
              onClick={() => updateCaption(c.id, { pos: c.pos ? null : { x: track!.style.x, y: track!.style.y } })}><MapPin size={12} /> {c.pos ? "Own position" : "Position"}</button>
            <span className="grow" />
            <button className="btn sm danger icon" title="Delete (Del)" onClick={() => deleteCaption(c.id)}><Trash2 size={12} /></button>
          </div>
          {c.pos && (
            <div>
              <Field label="Caption X"><Slider value={c.pos.x} min={0} max={1} step={0.005} digits={1} display={{ scale: 100 }} suffix="%" onChange={(v) => updateCaption(c.id, { pos: { ...c.pos!, x: v } }, `pos-${c.id}`)} /></Field>
              <Field label="Caption Y"><Slider value={c.pos.y} min={0} max={1} step={0.005} digits={1} display={{ scale: 100 }} suffix="%" onChange={(v) => updateCaption(c.id, { pos: { ...c.pos!, y: v } }, `pos-${c.id}`)} /></Field>
            </div>
          )}
          <div className="hint">Enter = split at cursor · words timed by AI: {c.words ? c.words.length : "none (even spacing)"}</div>
        </>
      )}
    </div>
  );
}

function TracksSection({ p }: { p: Project }) {
  const selTrack = useStore((s) => s.selectedTrack);
  const upd = useStore((s) => s.update);
  return (
    <Section title={<><Users size={13} /> Speakers / tracks</>} right={<button className="btn sm" onClick={() => addTrack()}><Plus size={12} /> Track</button>}>
      {p.tracks.map((tr) => {
        const n = p.captions.filter((c) => c.trackId === tr.id).length;
        return (
          <div key={tr.id} className={`track-row ${selTrack === tr.id ? "sel" : ""}`} onClick={() => useStore.setState({ selectedTrack: tr.id })}>
            <input type="color" value={tr.style.color.startsWith("#") ? tr.style.color.slice(0, 7) : "#ffffff"} title="Subtitle colour"
              style={{ width: 22, height: 22, border: 0, padding: 0, background: "none", cursor: "pointer" }}
              onChange={(e) => upd((d) => { d.tracks.find((t) => t.id === tr.id)!.style.color = e.target.value; }, { coalesce: `tc-${tr.id}` })} />
            <input className="input sm grow" value={tr.name} onChange={(e) => upd((d) => { d.tracks.find((t) => t.id === tr.id)!.name = e.target.value; }, { coalesce: `tn-${tr.id}` })} />
            <span className="badge">{n}</span>
            <button className="btn sm ghost icon" title={tr.visible ? "Hide track" : "Show track"} onClick={(e) => { e.stopPropagation(); upd((d) => { const t = d.tracks.find((t) => t.id === tr.id)!; t.visible = !t.visible; }); }}>
              {tr.visible ? <Eye size={13} /> : <EyeOff size={13} />}</button>
            <button className="btn sm ghost icon danger" title="Delete track and its captions" onClick={(e) => {
              e.stopPropagation();
              if (!n || confirm(`Delete "${tr.name}" and its ${n} caption(s)?`)) deleteTrack(tr.id);
            }}><Trash2 size={12} /></button>
          </div>
        );
      })}
      <div className="hint" style={{ marginTop: 6 }}>Each speaker has its own style and position; captions on different tracks can overlap in time and show together. <Tip text="Change a caption's speaker with its dropdown, or drag its block to another lane on the timeline." /></div>
    </Section>
  );
}

// ---------------------------------------------------------------- style
function StyleTab() {
  const p = useStore((s) => s.project!);
  const selTrack = useStore((s) => s.selectedTrack);
  const track = p.tracks.find((t) => t.id === selTrack) ?? p.tracks[0];
  if (!track) return null;
  return (
    <div>
      <div className="section" style={{ paddingBottom: 10 }}>
        <div className="lbl" style={{ marginBottom: 6 }}>Editing style of</div>
        <div className="row wrap">
          {p.tracks.map((t) => (
            <button key={t.id} className={`btn sm ${t.id === track.id ? "active" : ""}`} onClick={() => useStore.setState({ selectedTrack: t.id })}>
              <span className="dot" style={{ background: t.style.color, boxShadow: "0 0 0 1px #000" }} /> {t.name}
            </button>
          ))}
        </div>
        {p.tracks.length > 1 && (
          <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => useStore.getState().update((d) => {
            const src = d.tracks.find((t) => t.id === track.id)!.style;
            d.tracks.forEach((t) => { if (t.id !== track.id) t.style = { ...src, color: t.style.color, x: t.style.x, y: t.style.y }; });
          })} title="Applies this font, size, outline, shadow and box to every other speaker. Their colour and position are kept.">Copy look to other speakers</button>
        )}
      </div>
      <StyleEditor track={track} />
    </div>
  );
}
