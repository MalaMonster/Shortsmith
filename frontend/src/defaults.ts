import type { ExportCfg, LayoutCfg, MediaInfo, Project, RegionCfg, SubtitleStyle, Track } from "./types";

export const uid = () => Math.random().toString(36).slice(2, 12);

export const BASE_STYLE: SubtitleStyle = {
  fontFamily: "Montserrat", fontSize: 76, fontWeight: 900, italic: false, uppercase: false,
  color: "#FFFFFF", strokeColor: "#000000", strokeWidth: 9,
  shadowColor: "rgba(0,0,0,0.55)", shadowBlur: 14, shadowX: 0, shadowY: 6,
  bgMode: "none", bgColor: "#000000", bgOpacity: 0.65, bgPadding: 18, bgRadius: 18,
  x: 0.5, y: 0.42, align: "center", maxWidth: 0.86, lineHeight: 1.12, letterSpacing: 0,
  highlight: false, highlightColor: "#39FF14",
};

export interface StylePreset { id: string; name: string; style: Partial<SubtitleStyle> }

/** Presets change the *look*; they never move the captions (position is kept). */
export const STYLE_PRESETS: StylePreset[] = [
  { id: "classic", name: "Classic Bold", style: { fontFamily: "Montserrat", fontWeight: 900, fontSize: 76, color: "#FFFFFF", strokeColor: "#000000", strokeWidth: 9, bgMode: "none", uppercase: false, italic: false, letterSpacing: 0, shadowColor: "rgba(0,0,0,0.55)", shadowBlur: 14, shadowY: 6, shadowX: 0, highlight: false } },
  { id: "yellow", name: "Yellow Punch", style: { fontFamily: "Montserrat", fontWeight: 900, fontSize: 76, color: "#FFD60A", strokeColor: "#000000", strokeWidth: 9, bgMode: "none", uppercase: false, italic: false, letterSpacing: 0, shadowColor: "rgba(0,0,0,0.55)", shadowBlur: 14, shadowY: 6, shadowX: 0, highlight: false } },
  { id: "boxed", name: "Boxed", style: { fontFamily: "Poppins", fontWeight: 700, fontSize: 62, color: "#FFFFFF", strokeWidth: 0, bgMode: "line", bgColor: "#000000", bgOpacity: 0.72, bgPadding: 16, bgRadius: 14, uppercase: false, italic: false, shadowBlur: 0, shadowY: 0, shadowX: 0, letterSpacing: 0, highlight: false } },
  { id: "impact", name: "Meme Impact", style: { fontFamily: "Anton", fontWeight: 400, fontSize: 92, color: "#FFFFFF", strokeColor: "#000000", strokeWidth: 8, bgMode: "none", uppercase: true, italic: false, letterSpacing: 1, shadowBlur: 0, shadowY: 4, shadowX: 0, shadowColor: "rgba(0,0,0,0.8)", highlight: false } },
  { id: "comic", name: "Comic Pop", style: { fontFamily: "Bangers", fontWeight: 400, fontSize: 96, color: "#FFE600", strokeColor: "#1A1A1A", strokeWidth: 9, bgMode: "none", uppercase: true, italic: false, letterSpacing: 3, shadowColor: "rgba(0,0,0,0.9)", shadowBlur: 0, shadowX: 5, shadowY: 7, highlight: false } },
  { id: "karaoke", name: "Word Highlight", style: { fontFamily: "Montserrat", fontWeight: 900, fontSize: 80, color: "#FFFFFF", strokeColor: "#000000", strokeWidth: 10, bgMode: "none", uppercase: true, italic: false, letterSpacing: 0, shadowColor: "rgba(0,0,0,0.6)", shadowBlur: 12, shadowY: 6, shadowX: 0, highlight: true, highlightColor: "#39FF14" } },
  { id: "clean", name: "Clean Minimal", style: { fontFamily: "Inter", fontWeight: 700, fontSize: 58, color: "#FFFFFF", strokeWidth: 0, bgMode: "none", uppercase: false, italic: false, letterSpacing: 0, shadowColor: "rgba(0,0,0,0.75)", shadowBlur: 18, shadowX: 0, shadowY: 4, highlight: false } },
  { id: "neon", name: "Neon Glow", style: { fontFamily: "Luckiest Guy", fontWeight: 400, fontSize: 84, color: "#7DF9FF", strokeColor: "#002B45", strokeWidth: 7, bgMode: "none", uppercase: true, italic: false, letterSpacing: 2, shadowColor: "rgba(0,229,255,0.95)", shadowBlur: 30, shadowX: 0, shadowY: 0, highlight: false } },
  { id: "marker", name: "Handwritten", style: { fontFamily: "Permanent Marker", fontWeight: 400, fontSize: 74, color: "#FFFFFF", strokeColor: "#111111", strokeWidth: 7, bgMode: "none", uppercase: false, italic: false, letterSpacing: 0, shadowColor: "rgba(0,0,0,0.6)", shadowBlur: 10, shadowX: 0, shadowY: 5, highlight: false } },
  { id: "tag", name: "Speaker Tag", style: { fontFamily: "Archivo Black", fontWeight: 400, fontSize: 60, color: "#111111", strokeWidth: 0, bgMode: "block", bgColor: "#FFFFFF", bgOpacity: 0.95, bgPadding: 20, bgRadius: 24, uppercase: false, italic: false, letterSpacing: 0, shadowColor: "rgba(0,0,0,0.4)", shadowBlur: 16, shadowX: 0, shadowY: 6, highlight: false } },
];

const SPEAKER_DEFAULTS: { preset: string; color?: string; y: number }[] = [
  { preset: "classic", y: 0.41 },
  { preset: "yellow", y: 0.52 },
  { preset: "classic", color: "#7DF9FF", y: 0.62 },
  { preset: "classic", color: "#FF7AD9", y: 0.32 },
];

export function speakerStyle(i: number): SubtitleStyle {
  const d = SPEAKER_DEFAULTS[i % SPEAKER_DEFAULTS.length];
  const p = STYLE_PRESETS.find((p) => p.id === d.preset)!;
  return { ...BASE_STYLE, ...p.style, ...(d.color ? { color: d.color } : {}), y: d.y };
}

export function newTrack(i: number): Track {
  return { id: uid(), name: `Speaker ${i + 1}`, style: speakerStyle(i), visible: true };
}

export const DEFAULT_LAYOUT: LayoutCfg = {
  order: "camera-top", split: 0.4, gap: 0, margin: 0,
  background: { type: "color", color: "#000000", blur: 40, dim: 0.35 },
};

export const DEFAULT_EXPORT: ExportCfg = {
  resolution: "1080x1920", fps: "source", quality: "high", encoder: "libx264", burnSubtitles: true, srt: false,
  audioMode: "track", audioIndex: 0, audioBitrate: 192, volume: 1, output: "",
};

export function defaultRegion(kind: "camera" | "gameplay"): RegionCfg {
  return kind === "camera"
    ? { rect: { x: 0.02, y: 0.62, w: 0.24, h: 0.36 }, enabled: true, fit: "fill", zoom: 1, panX: 0, panY: 0, lockAspect: true }
    : { rect: { x: 0.2, y: 0, w: 0.6, h: 1 }, enabled: true, fit: "fill", zoom: 1, panX: 0, panY: 0, lockAspect: true };
}

export function newProject(source: MediaInfo): Project {
  const name = source.name.replace(/\.[^.]+$/, "");
  return {
    version: 1, name, source,
    clip: { start: 0, end: Math.min(source.duration, 60) },
    camera: defaultRegion("camera"),
    gameplay: defaultRegion("gameplay"),
    layout: structuredClone(DEFAULT_LAYOUT),
    tracks: [newTrack(0), newTrack(1)],
    captions: [],
    export: { ...DEFAULT_EXPORT },
    ui: { step: "select", useProxy: !source.browser_playable },
  };
}

export const LANGUAGES: [string, string][] = [
  ["auto", "Auto-detect"], ["en", "English"], ["es", "Spanish"], ["pt", "Portuguese"], ["fr", "French"], ["de", "German"],
  ["it", "Italian"], ["nl", "Dutch"], ["pl", "Polish"], ["tr", "Turkish"], ["ru", "Russian"], ["uk", "Ukrainian"],
  ["sv", "Swedish"], ["no", "Norwegian"], ["da", "Danish"], ["fi", "Finnish"], ["cs", "Czech"], ["ro", "Romanian"],
  ["hu", "Hungarian"], ["el", "Greek"], ["ar", "Arabic"], ["he", "Hebrew"], ["hi", "Hindi"], ["id", "Indonesian"],
  ["vi", "Vietnamese"], ["th", "Thai"], ["ja", "Japanese"], ["ko", "Korean"], ["zh", "Chinese"], ["tl", "Tagalog"],
];

export const CAPTION_LENGTHS = {
  punchy: { label: "Punchy (1–3 words)", max_words: 3, max_chars: 18, max_duration: 1.6, pause_split: 0.4 },
  standard: { label: "Standard (~6 words)", max_words: 6, max_chars: 32, max_duration: 3.0, pause_split: 0.6 },
  long: { label: "Sentences (~10 words)", max_words: 10, max_chars: 56, max_duration: 5.0, pause_split: 0.8 },
} as const;
