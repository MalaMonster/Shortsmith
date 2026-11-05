# Shortsmith — turn gaming clips into YouTube Shorts

Shortsmith turns a landscape gaming recording (gameplay plus a facecam in a corner) into a vertical
1080×1920 Short, with the facecam on top, gameplay below and AI subtitles. Each speaker gets their own
subtitle track and style.

Everything runs on your PC: FFmpeg does the rendering and Whisper does the transcription (on your NVIDIA
GPU if you have one). No account or API key is needed. A cloud transcription API is optional.

---

## Download

**[⬇ Download the latest Shortsmith-Setup.exe](https://github.com/MalaMonster/Shortsmith/releases/latest)** (Windows 10/11, 64-bit)

Run the installer. It needs no admin rights and installs to `%LOCALAPPDATA%\Programs\Shortsmith`, with a Start menu
entry and an optional desktop shortcut. FFmpeg is included, so there's nothing else to install.

- **Windows SmartScreen** may warn the first time, because the installer isn't code-signed. Click *More info → Run anyway*.
- **Updates:** Shortsmith checks GitHub for new releases at startup and offers to install them. The download is checked
  against the release's SHA-256 checksum, installs silently, and the app reopens where you were. You can turn the
  check off or run it by hand in *Settings → Updates*.
- **NVIDIA GPU:** to keep the installer small (about 170 MB), the CUDA runtime isn't included. If you have an NVIDIA
  card, *Settings → GPU acceleration → Download GPU pack* fetches NVIDIA's official cuBLAS package (527 MB) from PyPI.
  On an RTX 5060, a 25-second clip took 5 s on the GPU and 22 s on the CPU.
- Your projects, settings and AI models are kept in `%LOCALAPPDATA%\Shortsmith`, and they survive updates.
  The uninstaller asks whether to delete them.

---

## Run from source (Windows)

Requirements: **Python 3.10+**, **Node.js 18+** and **FFmpeg**. The setup script installs FFmpeg for you with `winget` if it's missing.

```bat
winget install Python.Python.3.13
winget install OpenJS.NodeJS.LTS
```

Then double-click **`setup.bat`**. It:

1. creates a Python environment in `.venv` inside the Shortsmith folder. If the folder's path is longer than 80
   characters it uses `%LOCALAPPDATA%\Shortsmith\venv` instead, because some packages fail to load from deep paths on Windows.
2. installs the backend packages (`backend/requirements.txt`), plus the CUDA runtime if an NVIDIA GPU is detected.
3. installs FFmpeg via `winget install Gyan.FFmpeg` if it isn't found.
4. builds the interface (`frontend/` → `frontend/dist`).
5. creates **Shortsmith** shortcuts on your Desktop, in the Start menu and in the Shortsmith folder.

## Run

Open the **Shortsmith** shortcut. No console window appears: the server runs in the background (`pythonw`)
and the editor opens in its own app window (Edge or Chrome app mode, with its own taskbar icon).

- **Closing the editor window quits Shortsmith.** If an export or transcription is still running, it finishes first.
- **Opening the shortcut again** while Shortsmith is running just opens another editor window.
- If something goes wrong at startup you get a message box. The server log is in `data\shortsmith.log`.
- **`start.bat`** runs the same thing with a console window showing the log, for troubleshooting.

The first time you generate subtitles, the speech model downloads once: about 1.6 GB for `large-v3-turbo`,
0.5 GB for `small`, plus about 40 MB for speaker detection. Models are kept in `data\models`.

---

## How to use it

The top bar walks through five steps. You can jump between them at any time (keys `1`–`5`).

1. **Clip**: shows the duration, resolution, fps, codecs and audio tracks. Set the start and end by dragging the purple
   handles on the timeline, pressing `I` / `O` at the playhead, or typing exact times. MKV/HEVC/4K sources get a
   low-res *preview proxy* automatically; export always uses the original file.
2. **Select**: a pink **Facecam** box and a cyan **Gameplay** box sit on the original video. Drag them, resize them with
   the handles, redraw them with *Draw box*, or snap the facecam to a corner. With *Match section shape* on, the box keeps
   the exact shape of its slot in the Short, so what you select is exactly what's shown. Hold **Shift** while resizing
   for a free shape. The dashed inner box shows the part that's actually visible.
3. **Arrange**: pick a layout preset, or:
   - **drag the divider** in the preview to change the camera/gameplay split
   - drag the small white bars above or below the divider (or use the slider) to change the **gap**
   - change the outer margin
   - fill empty space with a colour or **blurred gameplay**
   - for each section: *Fill* (crop) or *Fit* (letterbox), zoom (or scroll over the section in the preview) and position (or drag inside the section in the preview)

   Footage is never stretched: every mapping uses a single uniform scale.
4. **Subtitles**
   - **Generate**: choose the language (or auto-detect), the audio track, *One track per speaker* with
     **Detect speakers**, and a caption length. You can also add names or game words so Whisper spells them right.
     Then click **Generate subtitles**.
   - **Captions**: edit any caption's text, change its speaker, set start/end (typed or *at playhead*), **split**
     (Enter at the text cursor, or `S` at the playhead), **merge** (`M`), delete, or give one caption its own position.
     On the timeline, drag caption blocks to move them, drag their edges to retime them, drag them to another lane to
     change speaker, and double-click a lane to add a caption.
   - **Style**: each speaker/track has its own font, size, weight, colour, outline, shadow, background box (per line
     or whole caption), alignment, line and letter spacing, max width, position and optional word highlight.
     There are ten presets. You can also drag subtitles in the preview to move that speaker's captions; **Shift+drag**
     moves a single caption.
   - Captions on different tracks can overlap in time, so **two people talking at once show at the same time**
     (e.g. Speaker 1 in white, Speaker 2 in yellow).
5. **Export**: the YouTube Shorts preset is 1080×1920, H.264 High, AAC 48 kHz stereo, source fps (30/60 selectable),
   with subtitles burned in. Options: resolution (720p → 4K), quality, x264 (best quality) or NVENC (fast GPU),
   audio track / mix / none, volume, bitrate, *no burned-in subtitles* and *.srt sidecar*. When it's done you get
   the probed result (size, fps, codecs) plus **Show in folder** and **Play**. Exports go to `Videos\Shortsmith` by default.

Projects **autosave** (`data/projects`, with a backup copy) and appear under *Recent projects*. Undo/redo
covers every edit (`Ctrl+Z` / `Ctrl+Y`). Press `?` in the editor for all keyboard shortcuts.

### Tip for perfect simultaneous subtitles

If you record with OBS using **separate audio tracks** (e.g. your mic on track 2, Discord/friend on track 3),
choose that audio track in *Generate* and set *Put subtitles on* to that speaker's track. Do this once per person.
Each person is transcribed cleanly, even when you talk over each other.

---

## Optional: cloud transcription

Settings (gear icon) → *Subtitle transcription* → **Cloud API**. Any OpenAI-compatible `/audio/transcriptions`
endpoint works:

| Provider | Base URL | Model | Notes |
|---|---|---|---|
| OpenAI | `https://api.openai.com/v1` | `whisper-1` | word timestamps |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-transcribe-diarize` | speaker labels, segment-level timing |
| Groq | `https://api.groq.com/openai/v1` | `whisper-large-v3-turbo` | very cheap and fast, word timestamps |
| Self-hosted | e.g. `http://localhost:8000/v1` | your model | speaches / faster-whisper-server |

The API key is stored only in `data/settings.json` on your PC (or set the `OPENAI_API_KEY` environment variable).
Only the audio of the selected clip is uploaded, as a 64 kb/s mono MP3. Editing and export never need a key.

---

## Architecture

```
backend/  (Python · FastAPI, served on 127.0.0.1 only)
  app/main.py            REST API + serves the built UI; rejects requests from other web origins
  app/ffmpeg_utils.py    FFmpeg discovery, probing, proxy generation, audio extraction, waveform
  app/export.py          builds one FFmpeg filter graph: crop → scale → overlay → subtitle overlay → H.264/AAC
  app/transcribe/        local_whisper.py (faster-whisper), openai_api.py, diarize.py (sherpa-onnx),
                         segmenter.py (word timestamps → readable captions)
  app/projects.py        JSON project files, atomic writes + backup
  app/jobs.py            background jobs (proxy / transcription / export) with progress + cancel
frontend/ (React + TypeScript + Vite)
  src/engine/layout.ts     composition math, shared by preview and export
  src/engine/subtitles.ts  canvas subtitle renderer, shared by preview and export
  src/engine/exporter.ts   rasterises each subtitle "state" to PNG + builds the export spec
  src/store.ts             project state, undo/redo history, autosave
  src/components/          editor UI (source view, 9:16 preview, timeline, step panels)
```

**Why it matches the preview exactly:** the browser computes every crop and destination rectangle once, using
the same code that draws the preview, and sends integer rectangles to FFmpeg. Subtitles are drawn by the same
canvas renderer at export resolution. Each distinct on-screen subtitle state becomes a transparent PNG, and FFmpeg
overlays them with a timed concat stream. So fonts, outlines, shadows, boxes, word highlights and overlapping
speakers look the same in the export as on screen.

**Why a local web UI instead of Electron:** Python is needed for Whisper and diarization anyway, FFmpeg does
all the heavy work, and a Chromium window gives native H.264 playback, canvas text rendering and the Local
Font Access API with no extra 150 MB runtime. Native open/save dialogs come from the OS via Tk.

### Development

```bat
rem terminal 1 — API with auto-reload
.venv\Scripts\python.exe backend\run.py --dev
rem terminal 2 — UI with hot reload on http://localhost:5173 (proxies /api to :8765)
cd frontend && npm run dev
```

`scripts/make_test_video.ps1` creates a synthetic two-speaker, three-audio-track test recording in `data/testmedia`.
`scripts/make_icon.py` regenerates the app icon, and `scripts/create_shortcuts.ps1` recreates the shortcuts.

### Building the installer and publishing releases

```powershell
# local build → dist\Shortsmith-Setup-1.2.3.exe + dist\SHA256SUMS.txt
# (needs .venv with `pip install pyinstaller`, Node.js, and Inno Setup 6: winget install JRSoftware.InnoSetup)
powershell -ExecutionPolicy Bypass -File packaging\build.ps1 -Version 1.2.3
```

To publish a release, push a version tag. GitHub Actions (`.github/workflows/release.yml`) builds the installer on
Windows, stamps the version from the tag, and attaches `Shortsmith-Setup-X.Y.Z.exe` and `SHA256SUMS.txt` to a new
GitHub release. Installed copies then offer the update automatically.

```bat
git tag v1.2.3
git push origin v1.2.3
```

How the build works: `packaging/shortsmith.spec` (PyInstaller) freezes the backend into a windowless
`Shortsmith.exe` with the built UI inside it. `packaging/installer.iss` (Inno Setup) packages that together with a
static FFmpeg build (BtbN, checksum-verified) into a per-user installer. The installer also performs the silent
self-updates: `/SILENT /LAUNCHARGS=--after-update`.

---

## Known limitations (honest list)

- **Crosstalk on a single mixed track:** Whisper mostly transcribes the dominant voice. When two people talk at
  the same moment on one mixed audio track, the quieter words may be missing, and diarization can give words
  spoken during the overlap to the wrong speaker. Fix those in the Captions tab, or transcribe separate audio
  tracks as described above.
- **Speaker detection** clusters voices automatically. If it finds too many or too few speakers, set the count.
- **No caption animations** (pop/bounce/slide). Static styles and word-by-word highlight are supported.
- **One continuous clip per Short.** No cuts inside a clip, transitions, music, stickers or zoom keyframes. Crop regions are fixed for the whole clip.
- **No automatic facecam detection.** You place the facecam box yourself (corner snaps help).
- The **blurred background** uses CSS blur in the preview and FFmpeg's `gblur` in the export. They look nearly the same but not pixel-identical.
- The **cloud providers** are implemented to the documented APIs but weren't tested here, because no API keys were available. Local transcription and diarization were tested end to end.
- HDR sources are not tone-mapped. Very long sources (hours) work, but the preview proxy takes a while to build the first time.
- **Windows only.** The installer and setup scripts are Windows-only. The code has macOS/Linux paths for dialogs and Explorer, but they're untested.
- The **installer isn't code-signed**, so SmartScreen shows a warning on first install. Auto-updates verify the
  SHA-256 checksum published with each release, but that's not a substitute for a signature.
