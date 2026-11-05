"""Shortsmith launcher.

Starts the local server and opens the editor in its own app window. Designed to run under
pythonw.exe (no console window): output goes to a log file, startup errors appear in a message box,
and the server shuts itself down when the editor window is closed (after any running export or
transcription finishes). Launching again while it's running just opens another window.

    pythonw run.py              # normal, windowless (what the Shortsmith shortcut does)
    python  run.py --console    # same, but logs to the console (start.bat)
    python  run.py --dev        # API only with auto-reload, no window, never auto-exits
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

# native file dialogs run as a separate short-lived process of this same program
if len(sys.argv) >= 4 and sys.argv[1] == "--dialog":
    from app.dialogs import dialog_main
    dialog_main(sys.argv[2], sys.argv[3])
    sys.exit(0)

from app.config import DATA_DIR  # noqa: E402  (installed build → %LOCALAPPDATA%\Shortsmith, source → ./data)

DATA = str(DATA_DIR)
LOG_FILE = os.path.join(DATA, "shortsmith.log")
CREATE_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0


def setup_logging(force_file: bool):
    """pythonw has no stdout/stderr — anything that prints (uvicorn, tqdm, tracebacks) would crash."""
    if sys.stdout is not None and not force_file:
        return
    os.makedirs(DATA, exist_ok=True)
    try:
        if os.path.exists(LOG_FILE) and os.path.getsize(LOG_FILE) > 5_000_000:
            os.replace(LOG_FILE, LOG_FILE + ".old")
    except OSError:
        pass
    f = open(LOG_FILE, "a", encoding="utf-8", buffering=1)
    f.write(f"\n===== Shortsmith started {time.strftime('%Y-%m-%d %H:%M:%S')} =====\n")
    sys.stdout = sys.stderr = f


def message_box(text: str, error: bool = True):
    print(text)
    if sys.platform == "win32":
        try:
            import ctypes
            ctypes.windll.user32.MessageBoxW(0, text, "Shortsmith", 0x10 if error else 0x40)
            return
        except Exception:
            pass


def probe_port(port: int) -> str:
    """'ours' if Shortsmith already answers there, 'busy' if something else does, else 'free'."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/ping", timeout=1.5) as r:
            return "ours" if json.loads(r.read()).get("app") == "shortsmith" else "busy"
    except urllib.error.HTTPError:
        return "busy"
    except Exception:
        import socket
        with socket.socket() as s:
            s.settimeout(0.5)
            return "busy" if s.connect_ex(("127.0.0.1", port)) == 0 else "free"


def find_browser() -> str | None:
    if sys.platform != "win32":
        return None
    for c in [
        r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe",
        r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe",
        r"%ProgramFiles%\Google\Chrome\Application\chrome.exe",
        r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe",
        r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe",
    ]:
        p = os.path.expandvars(c)
        if os.path.isfile(p):
            return p
    return None


def open_window(url: str) -> subprocess.Popen | None:
    """Open a chromeless app window with its own browser profile, so the window is its own process
    (we can tell when it's closed) and shows up in the taskbar as Shortsmith."""
    if os.environ.get("SHORTSMITH_NO_BROWSER"):
        return None
    exe = find_browser()
    if exe:
        profile = os.path.join(DATA, "app-window")
        args = [exe, f"--app={url}", f"--user-data-dir={profile}", "--window-size=1600,950",
                "--no-first-run", "--no-default-browser-check", "--disable-features=msImplicitSignin,msEdgeSidebarV2,msHubApps"]
        return subprocess.Popen(args, creationflags=CREATE_NO_WINDOW)
    webbrowser.open(url)
    return None


def run_dev(port: int):
    import uvicorn
    print(f"Shortsmith API (dev) on http://127.0.0.1:{port}")
    uvicorn.run("app.main:app", host="127.0.0.1", port=port, log_level="info", reload=True, app_dir=HERE)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=int(os.environ.get("SHORTSMITH_PORT", 8765)))
    ap.add_argument("--console", action="store_true", help="log to the console instead of data/shortsmith.log")
    ap.add_argument("--dev", action="store_true", help="API only, auto-reload, no window, no auto-exit")
    ap.add_argument("--no-browser", action="store_true", help="don't open a window and don't auto-exit")
    ap.add_argument("--after-update", action="store_true", help=argparse.SUPPRESS)
    a = ap.parse_args()

    if a.dev:
        return run_dev(a.port)
    setup_logging(force_file=not a.console)

    # one instance: reuse a running Shortsmith, skip ports taken by other programs
    port = None
    for p in range(a.port, a.port + 10):
        state = probe_port(p)
        if state == "ours":
            if not a.no_browser:
                open_window(f"http://127.0.0.1:{p}")
            print(f"Shortsmith is already running on port {p} - opened a new window.")
            return
        if state == "free":
            port = p
            break
    if port is None:
        message_box(f"Shortsmith couldn't find a free port between {a.port} and {a.port + 9}.")
        return 1

    try:
        import uvicorn
        from app import main as appmain
    except Exception as e:  # missing packages → setup wasn't run
        import traceback
        traceback.print_exc()
        fix = ("Reinstall Shortsmith from https://github.com/MalaMonster/Shortsmith/releases"
               if getattr(sys, "frozen", False) else "Run setup.bat in the Shortsmith folder, then try again.")
        message_box(f"Shortsmith couldn't start:\n\n{e}\n\n{fix}\n\nLog: {LOG_FILE}")
        return 1

    cfg = uvicorn.Config(appmain.app, host="127.0.0.1", port=port, log_level="warning", log_config=None)
    server = uvicorn.Server(cfg)
    th = threading.Thread(target=server.run, daemon=True, name="uvicorn")
    th.start()
    t0 = time.time()
    while not server.started:
        if not th.is_alive() or time.time() - t0 > 30:
            message_box(f"Shortsmith's server failed to start. See the log for details:\n{LOG_FILE}")
            return 1
        time.sleep(0.05)

    url = f"http://127.0.0.1:{port}"
    print(f"Shortsmith is running at {url}")
    if a.no_browser:
        th.join()
        return

    life = appmain.LIFE
    proc = None
    reconnected = False
    if a.after_update:
        # The editor window that was open before the update keeps polling and reloads itself as soon as
        # the new version answers — reuse it instead of opening a second window.
        t_start = time.time()
        life["last_ping"] = 0
        while time.time() - t_start < 8:
            if life["last_ping"] > t_start:
                reconnected = True
                break
            time.sleep(0.2)
    if not reconnected:
        proc = open_window(url)
    life["last_ping"] = time.time()  # grace period while the window loads
    # Stay alive while the window is open; quit once it's closed and no export/transcription is running.
    while th.is_alive():
        time.sleep(1)
        now = time.time()
        if life.get("exit"):  # an update installer is taking over
            print("Exiting so the update can be installed.")
            break
        if appmain.jobs.any_active():
            continue
        window_gone = proc is not None and proc.poll() is not None
        quiet = now - life["last_ping"]
        said_bye = life["bye"] is not None and life["bye"] > life["last_ping"]
        if (said_bye and now - life["bye"] > 12) or (window_gone and quiet > 12) or quiet > 150:
            print("Editor window closed - shutting down.")
            break
    server.should_exit = True
    th.join(timeout=10)


if __name__ == "__main__":
    sys.exit(main() or 0)
