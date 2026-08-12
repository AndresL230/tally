#!/usr/bin/env python3
"""Generate Tally PWA icons: the slash wordmark (four ink bars + accent
slash) on the paper background, as raw-pixel PNGs via zlib (no PIL)."""
import struct, sys, zlib

PAPER = (0xF2, 0xEF, 0xE7)
INK = (0x21, 0x1F, 0x1C)
ACCENT = (0x0A, 0x8A, 0x9B)


def png(width, height, rgb_rows):
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + bytes(row) for row in rgb_rows)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def render(size, pad_frac):
    """Four vertical bars + a rotated slash, mockup geometry (76x48 box)."""
    img = [[PAPER for _ in range(size)] for _ in range(size)]
    # glyph box 43x48: bars at x = 0,13,26,39 (w 4, h 44), slash overshoots below
    pad = size * pad_frac
    glyph_w, glyph_h = 43.0, 48.0
    scale = (size - 2 * pad) / max(glyph_w, glyph_h)
    ox = (size - glyph_w * scale) / 2
    oy = (size - glyph_h * scale) / 2

    def fill(x0, y0, x1, y1, color):
        for y in range(max(0, int(y0)), min(size, int(y1) + 1)):
            for x in range(max(0, int(x0)), min(size, int(x1) + 1)):
                img[y][x] = color

    for bar_x in (0, 13, 26, 39):
        fill(ox + bar_x * scale, oy, ox + (bar_x + 4) * scale, oy + 44 * scale, INK)

    # slash: from (-4, 22) rotated -24deg, length 58, thickness 4 (mockup geometry)
    import math

    ang = math.radians(-24)
    thick = 4 * scale
    for t in range(int(58 * scale) + 1):
        cx = ox + (-4 + t / scale * math.cos(ang)) * scale
        cy = oy + (22 + t / scale * math.sin(ang)) * scale
        r = thick / 2
        for y in range(int(cy - r), int(cy + r) + 1):
            for x in range(int(cx - r), int(cx + r) + 1):
                if 0 <= x < size and 0 <= y < size:
                    img[y][x] = ACCENT

    rows = [[c for px in row for c in px] for row in img]
    return png(size, size, rows)


for size, pad, name in [(192, 0.18, "icon-192.png"), (512, 0.18, "icon-512.png"), (512, 0.22, "icon-512-maskable.png")]:
    with open(sys.argv[1] + "/" + name, "wb") as f:
        f.write(render(size, pad))
print("icons written")
