import type { JobInfo, MediaInfo, Project } from "./types";

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  let r: Response;
  try {
    r = await fetch(url, init);
  } catch {
    throw new Error("Can't reach the Shortsmith server. Is the start window still open?");
  }
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try {
      const j = await r.json();
      msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail ?? j);
    } catch { /* not json */ }
    throw new Error(msg);
  }
  return r.json() as Promise<T>;
}

export const mediaUrl = (path: string, proxy: boolean) =>
  `/api/media?path=${encodeURIComponent(path)}&proxy=${proxy ? 1 : 0}`;
export const thumbUrl = (path: string, t: number, w = 320) =>
  `/api/thumbnail?path=${encodeURIComponent(path)}&t=${t.toFixed(2)}&w=${w}`;

export interface GpuStatus { nvidia_gpu: boolean; ready: boolean; pack_installed: boolean; needs_pack: boolean; download_mb: number }

export interface UpdateInfo {
  current: string; latest: string | null; available: boolean; can_install: boolean; repo: string; releases_url: string;
  notes?: string; published?: string; page?: string; asset?: { name: string; url: string; size: number } | null; error: string | null;
}

export interface Health {
  ok: boolean; version: string; cuda: boolean; gpu: GpuStatus; diarization_models: boolean; exports_dir: string;
  ffmpeg: { ffmpeg: string | null; ffprobe: string | null; version: string | null; encoders: Record<string, boolean>; error: string | null };
}

export interface Settings {
  provider: "local" | "openai"; local_model: string; local_device: string;
  openai_base_url: string; openai_api_key: string; openai_model: string; ffmpeg_path: string; auto_update_check: boolean;
  openai_api_key_set?: boolean; openai_api_key_hint?: string;
}

export const api = {
  health: () => req<Health>("GET", "/api/health"),
  settings: () => req<Settings>("GET", "/api/settings"),
  saveSettings: (s: Partial<Settings> & { clear_api_key?: boolean }) => req<Settings>("PUT", "/api/settings", s),
  updateCheck: (force = false) => req<UpdateInfo>("GET", `/api/update/check?force=${force ? 1 : 0}`),
  updateInstall: () => req<JobInfo>("POST", "/api/update/install"),
  gpu: () => req<GpuStatus>("GET", "/api/gpu"),
  gpuInstall: () => req<JobInfo>("POST", "/api/gpu/install"),
  openDialog: () => req<{ path: string }>("POST", "/api/dialog/open", {}),
  saveDialog: (path: string) => req<{ path: string }>("POST", "/api/dialog/save", { path }),
  probe: (path: string) => req<MediaInfo>("POST", "/api/probe", { path }),
  upload: (file: File, onProgress: (f: number) => void) =>
    new Promise<{ path: string }>((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open("POST", "/api/upload");
      x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      x.onload = () => (x.status < 300 ? resolve(JSON.parse(x.responseText)) : reject(new Error(x.responseText)));
      x.onerror = () => reject(new Error("Upload failed"));
      const fd = new FormData();
      fd.append("file", file);
      x.send(fd);
    }),
  proxy: (path: string) => req<{ ready: boolean; job?: JobInfo }>("POST", "/api/proxy", { path }),
  waveform: (path: string, audio: number) =>
    req<{ pps: number; peaks: number[] }>("GET", `/api/waveform?path=${encodeURIComponent(path)}&audio=${audio}`),
  job: (id: string) => req<JobInfo>("GET", `/api/jobs/${id}`),
  cancelJob: (id: string) => req<{ ok: boolean }>("POST", `/api/jobs/${id}/cancel`),
  transcribe: (p: Record<string, unknown>) => req<JobInfo>("POST", "/api/transcribe", p),
  exportVideo: (fd: FormData) => req<JobInfo>("POST", "/api/export", fd),
  defaultExportPath: (name: string) => req<{ path: string }>("GET", `/api/export/default-path?name=${encodeURIComponent(name)}`),
  reveal: (path: string) => req("POST", "/api/reveal", { path }),
  open: (path: string) => req("POST", "/api/open", { path }),
  projects: () => req<ProjectSummary[]>("GET", "/api/projects"),
  createProject: (p: Project) => req<{ id: string }>("POST", "/api/projects", p),
  loadProject: (id: string) => req<Project>("GET", `/api/projects/${id}`),
  saveProject: (id: string, p: Project) => req<{ id: string; updated: number }>("PUT", `/api/projects/${id}`, p),
  deleteProject: (id: string) => req("DELETE", `/api/projects/${id}`),
};

export interface ProjectSummary {
  id: string; name: string; updated: number; source_name: string; source_path: string; duration: number; captions: number; source_exists: boolean;
}

/** Poll a background job until it finishes. */
export async function waitJob(id: string, onUpdate: (j: JobInfo) => void, interval = 400): Promise<JobInfo> {
  for (;;) {
    const j = await api.job(id);
    onUpdate(j);
    if (j.status === "done" || j.status === "error" || j.status === "cancelled") return j;
    await new Promise((r) => setTimeout(r, interval));
  }
}
