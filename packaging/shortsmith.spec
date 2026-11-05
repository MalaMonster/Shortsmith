# PyInstaller spec — builds build/pyi/Shortsmith/Shortsmith.exe (windowed, one-folder).
# Run via packaging/build.ps1.
import os
from PyInstaller.utils.hooks import collect_all, collect_submodules

ROOT = os.path.abspath(os.path.join(SPECPATH, ".."))

datas = [(os.path.join(ROOT, "frontend", "dist"), os.path.join("frontend", "dist"))]
binaries = []
hiddenimports = collect_submodules("uvicorn") + collect_submodules("app") + ["multipart", "python_multipart"]
for pkg in ("faster_whisper", "ctranslate2", "sherpa_onnx", "onnxruntime", "tokenizers", "av"):
    d, b, h = collect_all(pkg)
    datas += d
    binaries += b
    hiddenimports += h

a = Analysis(
    [os.path.join(ROOT, "backend", "run.py")],
    pathex=[os.path.join(ROOT, "backend")],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=["nvidia", "torch", "matplotlib", "pandas", "scipy", "IPython", "pytest"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name="Shortsmith",
    icon=os.path.join(ROOT, "assets", "shortsmith.ico"),
    version=os.path.join(ROOT, "build", "version_info.txt"),
    console=False,
    upx=False,
)
coll = COLLECT(exe, a.binaries, a.datas, name="Shortsmith", upx=False)
