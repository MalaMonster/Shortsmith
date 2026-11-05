export interface Rect { x: number; y: number; w: number; h: number }

export interface AudioStream {
  index: number; stream_index: number; codec: string; channels: number; sample_rate: number; title: string; language: string;
}

export interface MediaInfo {
  path: string; name: string; size: number; duration: number; width: number; height: number; fps: number;
  video_codec: string; container: string; bit_rate: number; audio: AudioStream[]; browser_playable: boolean;
  proxy_ready?: boolean;
}

export type FitMode = "fill" | "fit";

export interface RegionCfg {
  /** normalised (0..1) rectangle on the source frame */
  rect: Rect;
  enabled: boolean;
  fit: FitMode;
  zoom: number;   // 1 = rect fills slot exactly (fill) / fits slot (fit)
  panX: number;   // -1..1
  panY: number;   // -1..1
  lockAspect: boolean; // keep rect at the slot aspect ratio → what you select is exactly what's shown
}

export interface LayoutCfg {
  order: "camera-top" | "gameplay-top";
  split: number;   // fraction of usable height given to the top section
  gap: number;     // px at 1080×1920
  margin: number;  // outer padding, px at 1080×1920
  background: { type: "color" | "blur"; color: string; blur: number; dim: number };
}

export interface SubtitleStyle {
  fontFamily: string;
  fontSize: number;       // px at 1080 wide
  fontWeight: number;
  italic: boolean;
  uppercase: boolean;
  color: string;
  strokeColor: string;
  strokeWidth: number;    // px at 1080 wide (outline thickness outside the glyph)
  shadowColor: string;
  shadowBlur: number;
  shadowX: number;
  shadowY: number;
  bgMode: "none" | "block" | "line";
  bgColor: string;
  bgOpacity: number;
  bgPadding: number;
  bgRadius: number;
  x: number;              // 0..1 anchor
  y: number;              // 0..1 anchor (vertical centre of the text block)
  align: "left" | "center" | "right";
  maxWidth: number;       // fraction of frame width
  lineHeight: number;     // multiple of font size
  letterSpacing: number;  // px at 1080 wide
  highlight: boolean;     // karaoke-style active word colour
  highlightColor: string;
}

export interface Track { id: string; name: string; style: SubtitleStyle; visible: boolean }

export interface Word { text: string; start: number; end: number }

export interface Caption {
  id: string;
  trackId: string;
  start: number;   // absolute source seconds
  end: number;
  text: string;
  words?: Word[];
  pos?: { x: number; y: number } | null; // per-caption position override
}

export interface ExportCfg {
  resolution: "1080x1920" | "720x1280" | "1440x2560" | "2160x3840";
  fps: "source" | "30" | "60";
  quality: "max" | "high" | "balanced" | "fast";
  encoder: "libx264" | "h264_nvenc";
  burnSubtitles: boolean;
  srt: boolean;
  audioMode: "track" | "mix" | "none";
  audioIndex: number;
  audioBitrate: number;
  volume: number;
  output: string;
}

export type Step = "import" | "select" | "arrange" | "subtitles" | "export";

export interface Project {
  version: 1;
  id?: string;
  name: string;
  source: MediaInfo;
  clip: { start: number; end: number };
  camera: RegionCfg;
  gameplay: RegionCfg;
  layout: LayoutCfg;
  tracks: Track[];
  captions: Caption[];
  export: ExportCfg;
  ui: { step: Step; useProxy: boolean };
}

export interface JobInfo {
  id: string; kind: string; status: "queued" | "running" | "done" | "error" | "cancelled";
  progress: number; message: string; result: any; error: string | null; detail: string | null;
}
