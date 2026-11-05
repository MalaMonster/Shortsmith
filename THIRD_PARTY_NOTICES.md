# Third-party software

Shortsmith's own code is MIT-licensed (see LICENSE). The installer and the app also include or download:

| Component | License | Notes |
|---|---|---|
| [FFmpeg](https://ffmpeg.org) | GPL v3 | Static build by [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds), shipped unmodified as separate programs in `ffmpeg\` (with its LICENSE.txt). Source: https://ffmpeg.org/download.html and the build scripts at https://github.com/BtbN/FFmpeg-Builds |
| Python | PSF License | Bundled runtime (PyInstaller) |
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper), [CTranslate2](https://github.com/OpenNMT/CTranslate2) | MIT | Speech recognition |
| Whisper models ([OpenAI](https://github.com/openai/whisper), converted by [mobiuslabsgmbh](https://huggingface.co/mobiuslabsgmbh) / [Systran](https://huggingface.co/Systran)) | MIT | Downloaded on first use from Hugging Face |
| [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) | Apache 2.0 | Speaker diarization |
| pyannote segmentation 3.0 model | MIT | Downloaded on first use |
| 3D-Speaker ERes2Net embedding model | Apache 2.0 | Downloaded on first use |
| [ONNX Runtime](https://github.com/microsoft/onnxruntime) | MIT | |
| [PyAV](https://github.com/PyAV-Org/PyAV) | BSD-3-Clause | |
| FastAPI, Starlette, Uvicorn, httpx, NumPy, tokenizers, huggingface_hub | MIT / BSD / Apache 2.0 | |
| React, Zustand, Immer, Lucide icons, Vite | MIT / ISC | |
| Fonts: Montserrat, Poppins, Inter, Roboto, Anton, Bangers, Bebas Neue, Luckiest Guy, Archivo Black, Permanent Marker (via Fontsource) | SIL OFL 1.1 / Apache 2.0 | |
| NVIDIA cuBLAS (optional GPU pack) | NVIDIA Software License | Not bundled. Downloaded by the user from PyPI (`nvidia-cublas-cu12`) when they click *Download GPU pack* |
