#!/usr/bin/env python3
"""Rasterise assets/og-image.svg into og-image.png (1200x630) for social previews.

    python scripts/build_og_image.py
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "og-image.png"

W, H = 1200, 630
BG_TOP = (15, 20, 25)
BG_BOTTOM = (26, 34, 45)
GRID = (148, 163, 184)
GRID_ALPHA = 26  # 0.10 opacity, matching the SVG
ACCENT = (56, 189, 248)
AMBER = (251, 191, 36)
HEADING = (232, 237, 244)
MUTED = (148, 163, 184)

# Same vertices as the SVG, so the PNG and the design source cannot drift apart
LINE_ACCENT = [(80, 470), (210, 430), (340, 455), (470, 330), (600, 360),
               (730, 240), (860, 275), (990, 170), (1120, 140)]
LINE_AMBER = [(80, 510), (210, 495), (340, 500), (470, 455), (600, 470),
              (730, 415), (860, 430), (990, 385), (1120, 360)]

# Windows ships Segoe UI; the others are fallbacks so the script also runs elsewhere
SANS_BOLD = ("segoeuib.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf", "Arial Bold.ttf")
SANS = ("segoeui.ttf", "arial.ttf", "DejaVuSans.ttf", "Arial.ttf")
MONO = ("consola.ttf", "cour.ttf", "DejaVuSansMono.ttf", "Menlo.ttc")


def font(candidates: tuple[str, ...], size: int) -> ImageFont.FreeTypeFont:
    for name in candidates:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    print(f"warning: none of {candidates} found, falling back to the bitmap default",
          file=sys.stderr)
    return ImageFont.load_default()


def gradient() -> Image.Image:
    """Diagonal two-stop gradient, built by blending a vertical and horizontal ramp."""
    base = Image.new("RGB", (W, H))
    pixels = base.load()
    for y in range(H):
        for x in range(0, W, 4):
            # position along the diagonal, 0 at top-left and 1 at bottom-right
            t = ((x / W) + (y / H)) / 2
            colour = tuple(
                round(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3)
            )
            for dx in range(4):
                if x + dx < W:
                    pixels[x + dx, y] = colour
    return base


def dashed_line(draw: ImageDraw.ImageDraw, points, colour, width, on=12, off=8) -> None:
    """Walk the polyline drawing alternating segments, matching stroke-dasharray."""
    carry = 0.0
    drawing = True
    for (x1, y1), (x2, y2) in zip(points, points[1:]):
        seg = ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5
        pos = 0.0
        while pos < seg:
            span = (on if drawing else off) - carry
            end = min(pos + span, seg)
            if drawing:
                draw.line(
                    [(x1 + (x2 - x1) * pos / seg, y1 + (y2 - y1) * pos / seg),
                     (x1 + (x2 - x1) * end / seg, y1 + (y2 - y1) * end / seg)],
                    fill=colour, width=width,
                )
            if end - pos >= span:
                drawing = not drawing
                carry = 0.0
            else:
                carry += end - pos
            pos = end


def build() -> Image.Image:
    img = gradient().convert("RGBA")
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    for y in (157, 315, 472):
        draw.line([(0, y), (W, y)], fill=GRID + (GRID_ALPHA,), width=1)

    draw.line(LINE_ACCENT, fill=ACCENT + (255,), width=5, joint="curve")
    for x, y in LINE_ACCENT:
        draw.ellipse([x - 2, y - 2, x + 2, y + 2], fill=ACCENT + (255,))
    dashed_line(draw, LINE_AMBER, AMBER + (255,), 4)

    draw.text((80, 150), "Krzysztof Blachut", font=font(SANS_BOLD, 66),
              fill=HEADING + (255,), anchor="ls")
    draw.text((80, 205), "Analityk danych \u00b7 Data Analyst", font=font(SANS, 32),
              fill=ACCENT + (255,), anchor="ls")
    draw.text((80, 258), "Python \u00b7 Pandas \u00b7 SQL \u00b7 ETL \u00b7 REST API",
              font=font(MONO, 23), fill=MUTED + (255,), anchor="ls")

    return Image.alpha_composite(img, overlay).convert("RGB")


def main() -> int:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    build().save(OUT, "PNG", optimize=True)
    size_kb = OUT.stat().st_size / 1024
    print(f"wrote {OUT.relative_to(ROOT).as_posix()} — {W}x{H}, {size_kb:.0f} KB")
    # WhatsApp drops previews above roughly 300 KB, so flag it rather than fail silently
    if size_kb > 300:
        print("warning: above the ~300 KB WhatsApp threshold — consider JPEG instead",
              file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
