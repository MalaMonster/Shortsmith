"""Draws the Shortsmith icon (a 9:16 'phone' split into facecam + gameplay) as PNG + ICO. Needs numpy."""
import struct, zlib
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]


def rrect_mask(h, w, x0, y0, x1, y1, r):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32) + 0.5
    cx = np.clip(xx, x0 + r, x1 - r); cy = np.clip(yy, y0 + r, y1 - r)
    return ((xx - cx) ** 2 + (yy - cy) ** 2 <= r * r) & (xx >= x0) & (xx <= x1) & (yy >= y0) & (yy <= y1)


def draw(size):
    S = 4 * size  # supersample for anti-aliasing
    k = S / 256
    img = np.zeros((S, S, 4), np.float32)
    def fill(mask, rgb):
        img[mask] = [*[c / 255 for c in rgb], 1.0]
    fill(rrect_mask(S, S, 8 * k, 8 * k, 248 * k, 248 * k, 52 * k), (23, 26, 34))       # tile
    x0, x1, y0, y1 = 78 * k, 178 * k, 34 * k, 222 * k                                  # 9:16-ish phone
    phone = rrect_mask(S, S, x0, y0, x1, y1, 20 * k)
    yy = np.mgrid[0:S, 0:S][0] + 0.5
    split = y0 + (y1 - y0) * 0.40
    gap = 7 * k
    fill(phone & (yy < split), (255, 77, 141))                                        # facecam
    fill(phone & (yy > split + gap), (34, 211, 238))                                  # gameplay
    # subtitle bar across the divider
    fill(rrect_mask(S, S, 92 * k, split - 9 * k, 164 * k, split + gap + 9 * k, 7 * k), (255, 255, 255))
    a = img.reshape(size, 4, size, 4, 4).mean(axis=(1, 3))
    rgb = np.where(a[..., 3:4] > 0, a[..., :3] / np.maximum(a[..., 3:4], 1e-6), 0)
    return (np.concatenate([rgb, a[..., 3:4]], -1) * 255).round().astype(np.uint8)


def png(arr):
    h, w, _ = arr.shape
    raw = b"".join(b"\x00" + arr[y].tobytes() for y in range(h))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


sizes = [16, 24, 32, 48, 64, 128, 256]
pngs = {s: png(draw(s)) for s in sizes + [192, 512]}
(ROOT / "frontend/public/icon-192.png").write_bytes(pngs[192])
(ROOT / "frontend/public/icon-512.png").write_bytes(pngs[512])
(ROOT / "frontend/public/favicon.png").write_bytes(pngs[64])
off = 6 + 16 * len(sizes)
head, body = struct.pack("<HHH", 0, 1, len(sizes)), b""
for s in sizes:
    d = pngs[s]
    head += struct.pack("<BBBBHHII", s % 256, s % 256, 0, 0, 1, 32, len(d), off + len(body))
    body += d
(ROOT / "assets/shortsmith.ico").write_bytes(head + body)
print("icons written")
