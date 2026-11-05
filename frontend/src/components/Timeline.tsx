import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronFirst, ChevronLast, Maximize2, Pause, Play, Repeat, SkipBack, SkipForward, ZoomIn, ZoomOut } from "lucide-react";
import { api } from "../api";
import { addCaption, seek, stepFrames, togglePlay, useStore, useTime } from "../store";
import { clamp } from "../engine/layout";
import { fmtTime, startDrag, useSize } from "./ui";

const LANE_H = 34, RULER_H = 24, WAVE_H = 44;

export default function Timeline() {
  const project = useStore((s) => s.project!);
  const playing = useStore((s) => s.playing);
  const loop = useStore((s) => s.loop);
  const selected = useStore((s) => s.selectedCaption);
  const selTrack = useStore((s) => s.selectedTrack);
  const dur = project.source.duration;
  const [view, setView] = useState(() => {
    const pad = Math.max(1, (project.clip.end - project.clip.start) * 0.08);
    return { a: Math.max(0, project.clip.start - pad), b: Math.min(dur, project.clip.end + pad) };
  });
  const [wrapRef, size] = useSize<HTMLDivElement>();
  const width = size.w || 1;
  const pps = width / Math.max(0.05, view.b - view.a);
  const x = (t: number) => (t - view.a) * pps;
  const tAt = (clientX: number) => {
    const r = wrapRef.current!.getBoundingClientRect();
    return view.a + (clientX - r.left) / pps;
  };

  // waveform for the audio track used by the export
  const audioIdx = project.export.audioMode === "track" ? project.export.audioIndex : 0;
  const [wave, setWave] = useState<{ pps: number; peaks: number[] } | null>(null);
  useEffect(() => {
    if (!project.source.audio.length) return;
    api.waveform(project.source.path, audioIdx).then(setWave).catch(() => setWave(null));
  }, [project.source.path, audioIdx]);
  const waveRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = waveRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.max(1, width * dpr); c.height = WAVE_H * dpr;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!wave) return;
    ctx.fillStyle = "#3d4a66";
    const mid = c.height / 2;
    for (let px = 0; px < c.width; px++) {
      const t0 = view.a + (px / dpr) / pps, t1 = view.a + ((px + 1) / dpr) / pps;
      const i0 = Math.floor(t0 * wave.pps), i1 = Math.max(i0 + 1, Math.ceil(t1 * wave.pps));
      let m = 0;
      for (let i = i0; i < i1 && i < wave.peaks.length; i++) if (i >= 0) m = Math.max(m, wave.peaks[i]);
      const h = Math.max(0.5, m * (c.height / 2 - 2));
      ctx.fillRect(px, mid - h, 1, h * 2);
    }
  }, [wave, view, width, pps]);

  const tNow = () => useTime.getState().t;

  const zoom = (f: number, center?: number) => {
    const c = center ?? (view.a + view.b) / 2;
    const span = clamp((view.b - view.a) * f, 0.5, Math.max(1, dur));
    let a = c - (c - view.a) * (span / (view.b - view.a));
    a = clamp(a, 0, Math.max(0, dur - span));
    setView({ a, b: a + span });
  };
  const fitClip = () => {
    const pad = Math.max(0.5, (project.clip.end - project.clip.start) * 0.06);
    setView({ a: Math.max(0, project.clip.start - pad), b: Math.min(dur, project.clip.end + pad) });
  };

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.altKey) zoom(Math.exp(e.deltaY * 0.0015), tAt(e.clientX));
    else {
      const span = view.b - view.a;
      const d = ((e.deltaX || e.deltaY) / width) * span;
      const a = clamp(view.a + d, 0, Math.max(0, dur - span));
      setView({ a, b: a + span });
    }
  };

  const scrub = (e: React.PointerEvent) => {
    seek(tAt(e.clientX));
    startDrag(e, (_dx, _dy, ev) => seek(tAt(ev.clientX)));
  };

  const trim = (edge: "start" | "end") => (e: React.PointerEvent) => {
    e.stopPropagation();
    startDrag(e, (_dx, _dy, ev) => {
      const tt = clamp(tAt(ev.clientX), 0, dur);
      useStore.getState().update((d) => {
        if (edge === "start") d.clip.start = Math.min(tt, d.clip.end - 0.2);
        else d.clip.end = Math.max(tt, d.clip.start + 0.2);
      }, { coalesce: `trim-${edge}` });
      seek(edge === "start" ? Math.min(tt, project.clip.end - 0.2) : Math.max(tt, project.clip.start + 0.2) - 0.01);
    });
  };

  const lanesRef = useRef<HTMLDivElement>(null);
  const dragCap = (id: string, mode: "move" | "l" | "r") => (e: React.PointerEvent) => {
    e.stopPropagation();
    const c0 = project.captions.find((c) => c.id === id)!;
    useStore.setState({ selectedCaption: id, selectedTrack: c0.trackId });
    let moved = false;
    startDrag(e, (dx, _dy, ev) => {
      if (Math.abs(dx) > 2) moved = true;
      const dt = dx / pps;
      let laneTrack = c0.trackId;
      if (mode === "move" && lanesRef.current) {
        const r = lanesRef.current.getBoundingClientRect();
        const li = Math.floor((ev.clientY - r.top) / LANE_H);
        const tr = project.tracks[clamp(li, 0, project.tracks.length - 1)];
        if (tr && tr.id !== c0.trackId) { laneTrack = tr.id; moved = true; }
      }
      if (!moved) return;
      useStore.getState().update((d) => {
        const c = d.captions.find((c) => c.id === id);
        if (!c) return;
        const len = c0.end - c0.start;
        if (mode === "move") {
          const s = clamp(c0.start + dt, 0, dur - len);
          c.start = s; c.end = s + len;
          c.trackId = laneTrack;
          if (c0.words) c.words = c0.words.map((w) => ({ ...w, start: w.start + (s - c0.start), end: w.end + (s - c0.start) }));
        } else if (mode === "l") c.start = clamp(c0.start + dt, 0, c0.end - 0.1);
        else c.end = clamp(c0.end + dt, c0.start + 0.1, dur);
      }, { coalesce: `capdrag-${id}-${mode}` });
    }, () => { if (!moved) seek(c0.start + 0.001); });
  };

  // ruler ticks
  const ticks = useMemo(() => {
    const span = view.b - view.a;
    const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const step = steps.find((s) => (s * pps) > 70) ?? 600;
    const out: number[] = [];
    for (let tt = Math.ceil(view.a / step) * step; tt <= view.b; tt += step) out.push(+tt.toFixed(3));
    return { out, step, span };
  }, [view, pps]);

  const clipLen = project.clip.end - project.clip.start;
  return (
    <div className="timeline">
      <div className="transport">
        <button className="btn icon ghost" title="Clip start (Home)" onClick={() => seek(project.clip.start)}><ChevronFirst size={16} /></button>
        <button className="btn icon ghost" title="Previous frame (←)" onClick={() => stepFrames(-1)}><SkipBack size={15} /></button>
        <button className="btn icon primary" title="Play / pause (Space)" onClick={togglePlay}>{playing ? <Pause size={15} /> : <Play size={15} />}</button>
        <button className="btn icon ghost" title="Next frame (→)" onClick={() => stepFrames(1)}><SkipForward size={15} /></button>
        <button className="btn icon ghost" title="Clip end (End)" onClick={() => seek(project.clip.end - 0.01)}><ChevronLast size={16} /></button>
        <button className={`btn sm ${loop ? "active" : ""}`} title="Loop playback inside the clip" onClick={() => useStore.setState({ loop: !loop })}><Repeat size={12} /> Loop</button>
        <Timecode start={project.clip.start} len={clipLen} />
        <button className="btn sm" title="Set clip start at playhead (I)" onClick={() => { const t = tNow(); useStore.getState().update((d) => { d.clip.start = Math.min(t, d.clip.end - 0.2); }); }}>[ Set start</button>
        <button className="btn sm" title="Set clip end at playhead (O)" onClick={() => { const t = tNow(); useStore.getState().update((d) => { d.clip.end = Math.max(t, d.clip.start + 0.2); }); }}>Set end ]</button>
        {clipLen > 180 && <span className="badge" style={{ color: "var(--warn)" }} title="YouTube Shorts can be up to 3 minutes long">Over 3:00</span>}
        <div style={{ marginLeft: "auto" }} className="row">
          <button className="btn icon ghost sm" title="Zoom out" onClick={() => zoom(1.5)}><ZoomOut size={14} /></button>
          <button className="btn icon ghost sm" title="Zoom in (Ctrl + wheel)" onClick={() => zoom(1 / 1.5)}><ZoomIn size={14} /></button>
          <button className="btn sm ghost" title="Zoom to clip" onClick={fitClip}><Maximize2 size={12} /> Clip</button>
          <button className="btn sm ghost" title="Show whole video" onClick={() => setView({ a: 0, b: dur })}>All</button>
        </div>
      </div>
      <div className="tl-body" onWheel={onWheel}>
        <div className="tl-labels">
          <div className="tl-label" style={{ height: RULER_H }}>Time</div>
          <div className="tl-label" style={{ height: WAVE_H }}>Audio</div>
          {project.tracks.map((tr) => (
            <div key={tr.id} className={`tl-label ${selTrack === tr.id ? "sel" : ""}`} onClick={() => useStore.setState({ selectedTrack: tr.id })}
              style={{ opacity: tr.visible ? 1 : 0.45 }} title="Subtitle track — drag captions between lanes to change speaker">
              <span className="dot" style={{ background: tr.style.color, boxShadow: "0 0 0 1px #000" }} />{tr.name}
            </div>
          ))}
        </div>
        <div className="tl-canvas-wrap" ref={wrapRef} style={{ overflowY: "auto" }}>
          <div className="tl-ruler" onPointerDown={scrub}>
            {ticks.out.map((tt) => <div key={tt} className="tick" style={{ left: x(tt) }}>{fmtTime(tt, ticks.step < 1)}</div>)}
            <div className="trim-handle" style={{ left: x(project.clip.start) - 12 }} onPointerDown={trim("start")} title="Drag to set clip start" />
            <div className="trim-handle" style={{ left: x(project.clip.end) }} onPointerDown={trim("end")} title="Drag to set clip end" />
          </div>
          <div className="tl-lane tl-wave" onPointerDown={scrub}><canvas ref={waveRef} style={{ width: "100%", height: WAVE_H, display: "block" }} /></div>
          <div ref={lanesRef}>
            {project.tracks.map((tr) => (
              <div key={tr.id} className="tl-lane" onPointerDown={scrub}
                onDoubleClick={(e) => { useStore.setState({ selectedTrack: tr.id }); addCaption(tAt(e.clientX), tr.id); }}
                title="Double-click to add a caption">
                {project.captions.filter((c) => c.trackId === tr.id && c.end > view.a && c.start < view.b).map((c) => (
                  <div key={c.id} className={`cap-block ${selected === c.id ? "sel" : ""}`} onPointerDown={dragCap(c.id, "move")}
                    style={{ left: x(c.start), width: Math.max(4, (c.end - c.start) * pps), background: tr.style.color, opacity: tr.visible ? 1 : 0.4 }}
                    title={`${c.text}\n${fmtTime(c.start)} → ${fmtTime(c.end)}`}>
                    {c.text}
                    <div className="eh l" onPointerDown={dragCap(c.id, "l")} />
                    <div className="eh r" onPointerDown={dragCap(c.id, "r")} />
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="outside" style={{ left: 0, width: Math.max(0, x(project.clip.start)) }} />
          <div className="outside" style={{ left: x(project.clip.end), right: 0 }} />
          <div className="clip-range" style={{ left: x(project.clip.start), width: (project.clip.end - project.clip.start) * pps }} />
          <Playhead x={x} view={view} setView={setView} dur={dur} playing={playing} />
        </div>
      </div>
    </div>
  );
}

function Timecode({ start, len }: { start: number; len: number }) {
  const t = useTime((s) => s.t);
  return (
    <div className="timecode" title="Time inside the short / time in the original video">
      {fmtTime(t - start)} <span>/ {fmtTime(len)} · src {fmtTime(t)}</span>
    </div>
  );
}

function Playhead({ x, view, setView, dur, playing }: { x: (t: number) => number; view: { a: number; b: number }; setView: (v: { a: number; b: number }) => void; dur: number; playing: boolean }) {
  const t = useTime((s) => s.t);
  useEffect(() => {
    // keep the playhead in view while playing
    if (playing && (t > view.b || t < view.a)) {
      const span = view.b - view.a;
      const a = clamp(t - span * 0.1, 0, Math.max(0, dur - span));
      setView({ a, b: a + span });
    }
  }, [t, playing]);
  return <div className="playhead" style={{ left: x(t) }} />;
}
