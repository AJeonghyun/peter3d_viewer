#!/usr/bin/env python3
"""Re-pack turntable sprite sources into a browser-safe sprite sheet.

The retreat app animates the trophy with a pure-CSS `steps()` sprite. This tool:

1. Loads the grid sheet (uses its alpha if present, otherwise removes a light,
   low-saturation checkerboard/white background).
2. Auto-detects the column/row bands by content projection.
3. Keeps only the COMPLETE rows (a cropped partial bottom row is dropped).
4. Reads the cells row-major (row0 col0..colN, row1 ...) which is the natural
   continuous-rotation order.
5. Optionally interleaves one or more matching sheets of real in-between angle
   renders. Inputs are ordered by their position between each primary frame.
6. Either drops the primary sheet's near-360-degree endpoint or keeps its
   generated return-to-zero interval, then prepares an optional frame-zero
   sentinel for playback modes that need one.
7. Trims each frame and bottom-centre aligns it on a uniform canvas so the base
   stays fixed while the figure spins in place.
8. Writes a horizontal strip or bounded grid PNG and prints its frame count /
   size. The grid mode avoids browser texture limits on high-DPI displays.

Usage:
    .venv/bin/python scripts/turntable_sheet_to_strip.py \
        --input runtime-assets/peter-trophy-turntable.png \
        --intermediate-input runtime-assets/peter-trophy-turntable-quartersteps.png \
        --intermediate-input runtime-assets/peter-trophy-turntable-halfsteps.png \
        --intermediate-input runtime-assets/peter-trophy-turntable-three-quartersteps.png \
        --include-wrap-interval \
        --columns 18 \
        --omit-loop-sentinel \
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
    return Image.fromarray(rgba)


def build_sheet(
    frames: list[Image.Image],
    columns: int,
    pad: int = 8,
) -> tuple[Image.Image, int, int]:
    max_w = max(f.width for f in frames) + pad * 2
    max_h = max(f.height for f in frames) + pad
    columns = columns or len(frames)
    if columns < 1:
        raise ValueError("Sprite sheet columns must be at least one")
    rows = (len(frames) + columns - 1) // columns
    sheet = Image.new('RGBA', (max_w * columns, max_h * rows), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        column = index % columns
        row = index // columns
        ox = column * max_w + (max_w - frame.width) // 2
        oy = row * max_h + max_h - frame.height  # bottom aligned -> base stays put
        sheet.paste(frame, (ox, oy), frame)
    return sheet, max_w, max_h


def build_interleaved_loop(
    primary_frames: list[Image.Image],
    intermediate_frame_sets: list[list[Image.Image]],
    include_wrap_interval: bool,
) -> tuple[list[Image.Image], int]:
    """Interleave angle renders and prepare an optional exact frame-zero sentinel."""
    if len(primary_frames) < 3:
        raise ValueError("A seamless turntable requires at least three source frames")
    for frames in intermediate_frame_sets:
        if len(frames) != len(primary_frames):
            raise ValueError(
                "Every intermediate sheet must have the same cell count as the primary sheet"
            )

    cycle_frames = primary_frames if include_wrap_interval else primary_frames[:-1]
    unique_frames = [
        frame
        for index, primary_frame in enumerate(cycle_frames)
        for frame in (
            primary_frame,
            *(frames[index] for frames in intermediate_frame_sets),
        )
    ]
    return [*unique_frames, unique_frames[0].copy()], len(unique_frames)


def extract_sheet_frames(path: Path) -> list[Image.Image]:
    mask, rgb = load_mask_and_rgb(path)
    cols, rows = detect_grid(mask)
    full_rows = keep_complete_rows(rows)
    print(f"{path}: detected {len(cols)} columns x {len(rows)} rows "
          f"({len(full_rows)} complete) -> {len(cols) * len(full_rows)} frames")
    return [
        extract_frame(mask, rgb, col, row)
        for row in full_rows
        for col in cols
    ]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--input', required=True, type=Path)
    ap.add_argument(
        '--intermediate-input',
        action='append',
        default=[],
        type=Path,
        help='matching angle sheet to interleave after each primary frame; repeat in angle order',
    )
    ap.add_argument('--output', required=True, type=Path)
    ap.add_argument(
        '--columns',
        default=0,
        type=int,
        help='output grid columns; zero writes a horizontal strip',
    )
    ap.add_argument(
        '--omit-loop-sentinel',
        action='store_true',
        help='omit the exact frame-zero sentinel when the CSS loop does not hold it',
    )
    ap.add_argument(
        '--include-wrap-interval',
        action='store_true',
        help='include the primary endpoint and its generated in-betweens back to frame zero',
    )
    args = ap.parse_args()

    primary_frames = extract_sheet_frames(args.input)
    intermediate_frame_sets = [
        extract_sheet_frames(path)
        for path in args.intermediate_input
    ]
    frames, unique_frame_count = build_interleaved_loop(
        primary_frames,
        intermediate_frame_sets,
        args.include_wrap_interval,
    )
    output_frames = frames[:-1] if args.omit_loop_sentinel else frames
    sheet, fw, fh = build_sheet(output_frames, args.columns)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.output)
    sentinel_note = (
        f"{unique_frame_count} unique"
        if args.omit_loop_sentinel
        else f"{unique_frame_count} unique + 1 exact loop sentinel"
    )
    print(f"sheet -> {args.output} ({sheet.size[0]}x{sheet.size[1]}, {sentinel_note})")
    print(f"UNIQUE_FRAMES = {unique_frame_count}  SHEET_FRAMES = {len(output_frames)}  "
          f"frameWidth = {fw}  frameHeight = {fh}  aspect = {round(fw / fh, 5)}")


if __name__ == '__main__':
    main()
