import { create } from "zustand";
import { produce, type Draft } from "immer";
import type { Caption, JobInfo, Project, Step, Track, Word } from "./types";
import { newTrack, uid } from "./defaults";
import { clamp, fitRectToAspect, slotAspectNormalized } from "./engine/layout";
import { api, type Health } from "./api";

export interface Toast { id: string; kind: "info" | "error" | "success"; text: string; detail?: string }

interface State {
  project: Project | null;
  projectId: string | null;
  past: Project[];
  future: Project[];
  coalesce: { key: string; at: number } | null;
  saveState: "saved" | "saving" | "dirty" | "error";
  selectedCaption: string | null;
  selectedTrack: string | null;
  drawMode: "camera" | "gameplay" | null;
  activeRegion: "camera" | "gameplay" | null;
  playing: boolean;
  loop: boolean;
  toasts: Toast[];
  health: Health | null;
  jobs: { transcribe?: JobInfo | null; export?: JobInfo | null; proxy?: JobInfo | null };
  showSettings: boolean;

  load(p: Project, id: string): void;
  close(): void;
  update(recipe: (d: Draft<Project>) => void, opts?: { coalesce?: string; history?: boolean }): void;
  undo(): void;
  redo(): void;
  setStep(s: Step): void;
  toast(kind: Toast["kind"], text: string, detail?: string): void;
  dismissToast(id: string): void;
  set(p: Partial<State>): void;
}

const HISTORY_LIMIT = 200;

/** Keep aspect-locked regions matched to their slot whenever the layout changes. */
function syncLocks(d: Draft<Project>) {
  for (const kind of ["camera", "gameplay"] as const) {
    const reg = d[kind];
    if (!reg.lockAspect || !reg.enabled) continue;
    const a = slotAspectNormalized(d as Project, kind);
    if (!a) continue;
    const cur = reg.rect.w / reg.rect.h;
    if (Math.abs(cur - a) / a > 0.004) reg.rect = fitRectToAspect(reg.rect, a);
  }
}

export const useStore = create<State>((set, get) => ({
  project: null, projectId: null, past: [], future: [], coalesce: null, saveState: "saved",
  selectedCaption: null, selectedTrack: null, drawMode: null, activeRegion: null, playing: false, loop: true,
  toasts: [], health: null, jobs: {}, showSettings: false,

  load(p, id) {
    const fixed = produce(p, (d) => { syncLocks(d); });
    set({ project: fixed, projectId: id, past: [], future: [], saveState: "saved", selectedCaption: null,
      selectedTrack: fixed.tracks[0]?.id ?? null, drawMode: null, jobs: {} });
  },
  close() { set({ project: null, projectId: null, past: [], future: [] }); },

  update(recipe, opts) {
    const { project, past, coalesce } = get();
    if (!project) return;
    const next = produce(project, (d) => { recipe(d); syncLocks(d); });
    if (next === project) return;
    const now = performance.now();
    const merge = opts?.coalesce && coalesce && coalesce.key === opts.coalesce && now - coalesce.at < 1200;
    const history = opts?.history !== false;
    set({
      project: next,
      past: !history ? past : merge ? past : [...past.slice(-HISTORY_LIMIT), project],
      future: history ? [] : get().future,
      coalesce: opts?.coalesce ? { key: opts.coalesce, at: now } : null,
      saveState: "dirty",
    });
  },
  undo() {
    const { past, project, future } = get();
    if (!past.length || !project) return;
    set({ project: { ...past[past.length - 1], ui: project.ui }, past: past.slice(0, -1), future: [project, ...future], coalesce: null, saveState: "dirty" });
  },
  redo() {
    const { past, project, future } = get();
    if (!future.length || !project) return;
    set({ project: { ...future[0], ui: project.ui }, future: future.slice(1), past: [...past, project], coalesce: null, saveState: "dirty" });
  },
  setStep(s) {
    get().update((d) => { d.ui.step = s; }, { history: false });
    set({ drawMode: null });
  },
  toast(kind, text, detail) {
    const id = uid();
    set({ toasts: [...get().toasts, { id, kind, text, detail }] });
    if (kind !== "error") setTimeout(() => get().dismissToast(id), 4500);
  },
  dismissToast(id) { set({ toasts: get().toasts.filter((t) => t.id !== id) }); },
  set(p) { set(p); },
}));

// ------------------------------------------------------------------ playback time (high-frequency)
type TimeState = { t: number };
export const useTime = create<TimeState>(() => ({ t: 0 }));

let videoEl: HTMLVideoElement | null = null;
export const setVideoEl = (v: HTMLVideoElement | null) => { videoEl = v; };
export const getVideoEl = () => videoEl;

export function seek(t: number) {
  const p = useStore.getState().project;
  if (!p) return;
  const tt = clamp(t, 0, p.source.duration);
  if (videoEl) videoEl.currentTime = tt;
  useTime.setState({ t: tt });
}

export function togglePlay() {
  const v = videoEl;
  const p = useStore.getState().project;
  if (!v || !p) return;
  if (v.paused) {
    if (v.currentTime >= p.clip.end - 0.05 || v.currentTime < p.clip.start - 0.05) v.currentTime = p.clip.start;
    v.play().catch(() => {});
  } else v.pause();
}

export function stepFrames(n: number) {
  const p = useStore.getState().project;
  if (!p || !videoEl) return;
  videoEl.pause();
  seek(videoEl.currentTime + n / (p.source.fps || 30));
}

// ------------------------------------------------------------------ autosave
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSaved: Project | null = null;
useStore.subscribe((s) => {
  if (!s.project || !s.projectId || s.project === lastSaved || s.saveState !== "dirty") return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void saveNow(), 700);
});

export async function saveNow() {
  const { project, projectId } = useStore.getState();
  if (!project || !projectId) return;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  useStore.setState({ saveState: "saving" });
  try {
    await api.saveProject(projectId, project);
    lastSaved = project;
    if (useStore.getState().project === project) useStore.setState({ saveState: "saved" });
    else useStore.setState({ saveState: "dirty" });
  } catch (e) {
    useStore.setState({ saveState: "error" });
    try { localStorage.setItem(`shortsmith-backup-${projectId}`, JSON.stringify(project)); } catch { /* quota */ }
  }
}
window.addEventListener("beforeunload", (e) => {
  if (useStore.getState().saveState === "dirty" || useStore.getState().saveState === "saving") {
    void saveNow();
    e.preventDefault();
  }
});

// ------------------------------------------------------------------ caption operations
const upd = (r: (d: Draft<Project>) => void, coalesce?: string) => useStore.getState().update(r, { coalesce });

export function addCaption(at: number, trackId?: string) {
  const p = useStore.getState().project!;
  const tid = trackId ?? useStore.getState().selectedTrack ?? p.tracks[0]?.id;
  if (!tid) return;
  const start = clamp(at, p.clip.start, Math.max(p.clip.start, p.clip.end - 0.3));
  const later = p.captions.filter((c) => c.trackId === tid && c.start > start).sort((a, b) => a.start - b.start)[0];
  const end = Math.min(start + 1.5, later ? later.start : Infinity, p.clip.end);
  const cap: Caption = { id: uid(), trackId: tid, start, end: Math.max(end, start + 0.3), text: "New caption" };
  upd((d) => { d.captions.push(cap); });
  useStore.setState({ selectedCaption: cap.id });
  return cap.id;
}

export function deleteCaption(id: string) {
  upd((d) => { d.captions = d.captions.filter((c) => c.id !== id); });
  if (useStore.getState().selectedCaption === id) useStore.setState({ selectedCaption: null });
}

export function updateCaption(id: string, patch: Partial<Caption>, coalesce?: string) {
  upd((d) => {
    const c = d.captions.find((c) => c.id === id);
    if (!c) return;
    if (patch.text !== undefined && patch.text !== c.text) {
      // keep word timings only while the word count still matches
      const n = patch.text.split(/\s+/).filter(Boolean).length;
      if (c.words && c.words.length !== n) c.words = undefined;
      else if (c.words) patch.text.split(/\s+/).filter(Boolean).forEach((w, i) => { c.words![i].text = w; });
    }
    Object.assign(c, patch);
    if (c.end < c.start + 0.05) c.end = c.start + 0.05;
  }, coalesce);
}

/** Split at a time (playhead) or a character index (text cursor). */
export function splitCaption(id: string, opt: { time?: number; charIndex?: number }) {
  const p = useStore.getState().project!;
  const c = p.captions.find((c) => c.id === id);
  if (!c) return;
  const tokens = c.text.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) { useStore.getState().toast("info", "Need at least two words to split"); return; }
  const words: Word[] | undefined = c.words && c.words.length === tokens.length ? c.words : undefined;
  let k: number; // number of tokens in the first part
  if (opt.charIndex !== undefined) {
    k = c.text.slice(0, opt.charIndex).split(/\s+/).filter(Boolean).length;
  } else {
    const t = opt.time ?? (c.start + c.end) / 2;
    if (words) k = words.filter((w) => (w.start + w.end) / 2 < t).length;
    else k = Math.round(tokens.length * clamp((t - c.start) / (c.end - c.start), 0, 1));
  }
  k = clamp(k, 1, tokens.length - 1);
  let tSplit: number;
  if (opt.time !== undefined && opt.time > c.start && opt.time < c.end) tSplit = opt.time;
  else if (words) tSplit = (words[k - 1].end + words[k].start) / 2;
  else {
    const chars = tokens.slice(0, k).join(" ").length / c.text.length;
    tSplit = c.start + (c.end - c.start) * chars;
  }
  const a: Caption = { ...c, end: tSplit, text: tokens.slice(0, k).join(" "), words: words?.slice(0, k) };
  const b: Caption = { ...c, id: uid(), start: tSplit, text: tokens.slice(k).join(" "), words: words?.slice(k) };
  upd((d) => {
    const i = d.captions.findIndex((x) => x.id === id);
    d.captions.splice(i, 1, a, b);
  });
  useStore.setState({ selectedCaption: b.id });
}

export function mergeWithNext(id: string) {
  const p = useStore.getState().project!;
  const c = p.captions.find((c) => c.id === id);
  if (!c) return;
  const next = p.captions.filter((x) => x.trackId === c.trackId && x.start >= c.start && x.id !== id).sort((a, b) => a.start - b.start)[0];
  if (!next) { useStore.getState().toast("info", "No following caption on this track to merge with"); return; }
  upd((d) => {
    const a = d.captions.find((x) => x.id === id)!;
    a.text = `${a.text} ${next.text}`.trim();
    a.words = a.words && next.words ? [...a.words, ...next.words] : undefined;
    a.end = Math.max(a.end, next.end);
    d.captions = d.captions.filter((x) => x.id !== next.id);
  });
}

export function addTrack(): Track {
  const p = useStore.getState().project!;
  const t = newTrack(p.tracks.length);
  upd((d) => { d.tracks.push(t); });
  useStore.setState({ selectedTrack: t.id });
  return t;
}

export function deleteTrack(id: string) {
  const p = useStore.getState().project!;
  if (p.tracks.length <= 1) { useStore.getState().toast("info", "Keep at least one subtitle track"); return; }
  upd((d) => {
    d.tracks = d.tracks.filter((t) => t.id !== id);
    d.captions = d.captions.filter((c) => c.trackId !== id);
  });
  useStore.setState({ selectedTrack: useStore.getState().project!.tracks[0].id });
}

export interface TranscribeResult {
  captions: { id: string; start: number; end: number; text: string; speaker: number | null; words: Word[] }[];
  speakers: number; language: string; model: string; device: string;
}

/** Insert AI captions. target = "speakers" (one track per detected speaker) or a track id. */
export function applyTranscription(res: TranscribeResult, target: string, range: { start: number; end: number }) {
  upd((d) => {
    const trackFor = (spk: number | null): string => {
      if (target !== "speakers") return target;
      const i = spk ?? 0;
      while (d.tracks.length <= i) d.tracks.push(newTrack(d.tracks.length) as Draft<Track>);
      return d.tracks[i].id;
    };
    const ids = new Set(res.captions.map((c) => trackFor(c.speaker)));
    if (target === "speakers") d.tracks.forEach((t, i) => { if (i < Math.max(1, res.speakers)) ids.add(t.id); });
    // replace existing captions of the affected tracks inside the transcribed range
    d.captions = d.captions.filter((c) => !(ids.has(c.trackId) && c.start < range.end && c.end > range.start));
    for (const c of res.captions) {
      d.captions.push({ id: uid(), trackId: trackFor(c.speaker), start: c.start, end: c.end, text: c.text, words: c.words });
    }
    d.captions.sort((a, b) => a.start - b.start);
  });
}
