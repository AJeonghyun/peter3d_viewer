#!/usr/bin/env python3
"""Re-pack a turntable *grid* sprite sheet into a single horizontal strip.

The retreat app animates the trophy with a pure-CSS `steps()` sprite that walks
one horizontal strip left to right. A 3D turntable export, however, is usually a
GRID (N columns x M rows). This tool:

1. Loads the grid sheet (uses its alpha if present, otherwise removes a light,
   low-saturation checkerboard/white background).
2. Auto-detects the column/row bands by content projection.
3. Keeps only the COMPLETE rows (a cropped partial bottom row is dropped).
4. Reads the cells row-major (row0 col0..colN, row1 ...) which is the natural
   continuous-rotation order.
5. Trims each frame and bottom-centre aligns it on a uniform canvas so the base
   stays fixed while the figure spins in place.
6. Writes one horizontal strip PNG and prints the frame count / size so the CSS
   (`steps(N)` and `width: N*100%`) can be matched.

Usage:
    .venv/bin/python scripts/turntable_sheet_to_strip.py \
        --input runtime-assets/peter-trophy-turntable.png \
        --output frontend/public/assets/trophy/trophy-strip.png
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image

BG_LUM = 190.0   # background is lighter than this ...
BG_SAT = 0.15    # ... and less saturated than this
MIN_BAND = 24    # ignore projection runs shorter than this (px)
ROW_KEEP_RATIO = 0.6  # a row must be at least this tall vs the tallest to count


def content_mask(rgb: np.ndarray) -> np.ndarray:
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    lum = r * 0.299 + g * 0.587 + b * 0.114
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    sat = (mx - mn) / np.maximum(mx, 1)
    background = (lum > BG_LUM) & (sat < BG_SAT)
    return ~background


def load_mask_and_rgb(path: Path) -> tuple[np.ndarray, np.ndarray]:
    img = Image.open(path)
    if img.mode == 'RGBA':
        arr = np.asarray(img)
        alpha = arr[..., 3]
        # Use real alpha only when the sheet actually carries transparency.
        if (alpha < 16).mean() > 0.05:
            return alpha > 16, arr[..., :3].astype(int)
        img = img.convert('RGB')
    rgb = np.asarray(img.convert('RGB')).astype(int)
    return content_mask(rgb), rgb


def runs(occupied: np.ndarray, min_len: int) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    start: int | None = None
    for i, value in enumerate(occupied):
        if value and start is None:
            start = i
        elif not value and start is not None:
            if i - start >= min_len:
                out.append((start, i - 1))
            start = None
    if start is not None and len(occupied) - start >= min_len:
        out.append((start, len(occupied) - 1))
    return out


def detect_grid(mask: np.ndarray) -> tuple[list[tuple[int, int]], list[tuple[int, int]]]:
    col_occ = mask.mean(axis=0) > 0.02
    row_occ = mask.mean(axis=1) > 0.02
    cols = runs(col_occ, MIN_BAND)
    rows = runs(row_occ, MIN_BAND)
    return cols, rows


def keep_complete_rows(rows: list[tuple[int, int]]) -> list[tuple[int, int]]:
    if not rows:
        return rows
    heights = [end - start + 1 for start, end in rows]
    tallest = max(heights)
    return [band for band, height in zip(rows, heights) if height >= ROW_KEEP_RATIO * tallest]


def extract_frame(mask: np.ndarray, rgb: np.ndarray,
                  col: tuple[int, int], row: tuple[int, int]) -> Image.Image:
    x0, x1 = col
    y0, y1 = row
    cell_mask = mask[y0:y1 + 1, x0:x1 + 1]
    ys, xs = np.where(cell_mask)
    if len(xs) == 0:
        return Image.new('RGBA', (1, 1), (0, 0, 0, 0))
    cx0, cx1 = xs.min(), xs.max()
    cy0, cy1 = ys.min(), ys.max()
    sub_rgb = rgb[y0 + cy0:y0 + cy1 + 1, x0 + cx0:x0 + cx1 + 1]
    sub_alpha = cell_mask[cy0:cy1 + 1, cx0:cx1 + 1]
    rgba = np.dstack([sub_rgb, np.where(sub_alpha, 255, 0)]).astype(np.uint8)
    return Image.fromarray(rgba, 'RGBA')


def build_strip(frames: list[Image.Image], pad: int = 8) -> Image.Image:
    max_w = max(f.width for f in frames) + pad * 2
    max_h = max(f.height for f in frames) + pad
    strip = Image.new('RGBA', (max_w * len(frames), max_h), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        ox = index * max_w + (max_w - frame.width) // 2
        oy = max_h - frame.height  # bottom aligned -> base stays put
        strip.paste(frame, (ox, oy), frame)
    return strip, max_w, max_h


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--input', required=True, type=Path)
    ap.add_argument('--output', required=True, type=Path)
    args = ap.parse_args()

    mask, rgb = load_mask_and_rgb(args.input)
    cols, rows = detect_grid(mask)
    full_rows = keep_complete_rows(rows)
    print(f"detected {len(cols)} columns x {len(rows)} rows "
          f"({len(full_rows)} complete) -> {len(cols) * len(full_rows)} frames")

    frames = [
        extract_frame(mask, rgb, col, row)
        for row in full_rows
        for col in cols
    ]
    strip, fw, fh = build_strip(frames)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    strip.save(args.output)
    print(f"strip -> {args.output} ({strip.size[0]}x{strip.size[1]})")
    print(f"FRAMES = {len(frames)}  frameWidth = {fw}  frameHeight = {fh}  "
          f"aspect = {round(fw / fh, 5)}")
    print(f"CSS: width: {len(frames) * 100}%;  animation steps({len(frames)});  "
          f"aspect-ratio: {fw} / {fh};")


if __name__ == '__main__':
    main()
