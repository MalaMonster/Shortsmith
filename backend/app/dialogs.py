"""Native OS file dialogs (run in a short-lived subprocess so Tk never touches the server threads)."""
from __future__ import annotations

import json
import os
import subprocess
import sys

from .ffmpeg_utils import CREATE_NO_WINDOW

def dialog_main(args_json: str, out_path: str) -> None:
    """Runs in a separate process (`Shortsmith.exe --dialog …` or `python run.py --dialog …`)."""
    import tkinter as tk
    from tkinter import filedialog
    args = json.loads(args_json)
    root = tk.Tk()
    root.withdraw()
    try:
        root.attributes("-topmost", True)
    except Exception:
        pass
    root.update()
    kind = args["kind"]
    if kind == "open":
        p = filedialog.askopenfilename(parent=root, title=args.get("title", "Open"), filetypes=args.get("filetypes") or [("All files", "*.*")],
                                       initialdir=args.get("initialdir") or None)
    elif kind == "save":
        p = filedialog.asksaveasfilename(parent=root, title=args.get("title", "Save"), defaultextension=args.get("ext", ""),
                                         initialfile=args.get("initialfile") or "", initialdir=args.get("initialdir") or None,
                                         filetypes=args.get("filetypes") or [("All files", "*.*")])
    else:
        p = filedialog.askdirectory(parent=root, title=args.get("title", "Choose folder"), initialdir=args.get("initialdir") or None)
    root.destroy()
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"path": p or ""}, f)


VIDEO_TYPES = [("Video files", "*.mp4 *.mov *.mkv *.webm *.m4v *.avi *.flv *.ts *.mts *.wmv"), ("All files", "*.*")]


def _run(args: dict) -> str:
    import tempfile
    fd, out = tempfile.mkstemp(suffix=".json")
    os.close(fd)
    if getattr(sys, "frozen", False):
        cmd = [sys.executable, "--dialog", json.dumps(args), out]
    else:
        cmd = [sys.executable, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "run.py"),
               "--dialog", json.dumps(args), out]
    try:
        subprocess.run(cmd, timeout=3600, creationflags=CREATE_NO_WINDOW)
        with open(out, encoding="utf-8") as f:
            return json.load(f).get("path", "")
    except Exception as e:  # tkinter missing, headless, …
        raise RuntimeError(f"Native file dialog unavailable ({e}). Paste the file path instead.") from e
    finally:
        try:
            os.unlink(out)
        except OSError:
            pass


def open_video(initialdir: str | None = None) -> str:
    return _run({"kind": "open", "title": "Import video", "filetypes": VIDEO_TYPES, "initialdir": initialdir})


def save_video(initial: str) -> str:
    return _run({"kind": "save", "title": "Export short as…", "ext": ".mp4", "initialfile": os.path.basename(initial),
                 "initialdir": os.path.dirname(initial), "filetypes": [("MP4 video", "*.mp4")]})


def pick_folder(initialdir: str | None = None) -> str:
    return _run({"kind": "folder", "initialdir": initialdir})


def reveal(path: str):
    path = os.path.abspath(path)
    if sys.platform == "win32":
        subprocess.Popen(["explorer", "/select,", path])
    elif sys.platform == "darwin":
        subprocess.Popen(["open", "-R", path])
    else:
        subprocess.Popen(["xdg-open", os.path.dirname(path)])


def open_file(path: str):
    if sys.platform == "win32":
        os.startfile(path)  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        subprocess.Popen(["open", path])
    else:
        subprocess.Popen(["xdg-open", path])
