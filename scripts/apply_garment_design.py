#!/usr/bin/env python3
"""Apply a two-part student garment design to the fixed Peter master sheet.

The master owns Peter's identity, pose, proportions, and animation. The student
image only supplies pixels for the upper and lower garment regions. This makes
the output deterministic: every team shares the same Peter and only the outfit
changes.

The input design card is expected to contain one upper-garment drawing in its
top half and one lower-garment drawing in its bottom half on light paper.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageChops


GRID_SIZE = 5
FRAME_SIZE = (300, 360)
BASELINE_Y = 332
CONTENT_HEIGHT = 292
CONTENT_WIDTH = 276

FRAME_CELLS: dict[str, tuple[int, int]] = {
    "idle-front": (0, 0),
    "walk-01": (1, 0),
    "walk-02": (2, 0),
    "walk-03": (3, 0),
    "walk-04": (4, 0),
    "walk-05": (0, 1),
    "walk-06": (1, 1),
    "walk-07": (2, 1),
    "walk-08": (3, 1),
    "idle-front-alt": (4, 1),
    "run-01": (0, 2),
    "run-02": (1, 2),
    "run-03": (2, 2),
    "run-04": (3, 2),
    "run-05": (4, 2),
    "run-06": (0, 3),
    "run-07": (1, 3),
    "run-08": (2, 3),
    "wave-01": (3, 3),
    "sit-01": (4, 3),
    "jump-01": (0, 4),
    "kneel-01": (1, 4),
    "pray-01": (2, 4),
    "pray-kneel-01": (3, 4),
    "point-01": (4, 4),
}

ANIMATIONS: dict[str, list[str]] = {
    "idle": ["idle-front"],
    "walk": [f"walk-{index:02d}" for index in range(1, 9)],
    "run": [f"run-{index:02d}" for index in range(1, 9)],
    "wave": ["wave-01"],
    "jump": ["jump-01"],
    "pray": ["pray-01"],
    "kneel": ["kneel-01"],
    "point": ["point-01"],
}


@dataclass(frozen=True)
class CellBounds:
    left: int
    top: int
    right: int
    bottom: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Transfer a student's upper/lower garment drawing onto Peter.",
    )
    parser.add_argument("--master", type=Path, required=True)
    parser.add_argument("--design", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def grid_bounds(width: int, height: int, column: int, row: int) -> CellBounds:
    return CellBounds(
        left=round(width * column / GRID_SIZE),
        top=round(height * row / GRID_SIZE),
        right=round(width * (column + 1) / GRID_SIZE),
        bottom=round(height * (row + 1) / GRID_SIZE),
    )


def colored_pixel(pixel: tuple[int, int, int, int]) -> bool:
    red, green, blue, alpha = pixel
    if alpha < 32:
        return False
    maximum = max(red, green, blue)
    minimum = min(red, green, blue)
    return maximum - minimum > 24 and minimum < 238


def extract_design_texture(design: Image.Image, top_half: bool) -> Image.Image:
    """Find the colored drawing in one half and return a safe interior texture."""
    rgba = design.convert("RGBA")
    y0 = 0 if top_half else rgba.height // 2
    y1 = rgba.height // 2 if top_half else rgba.height
    half = rgba.crop((0, y0, rgba.width, y1))

    mask = Image.new("L", half.size, 0)
    mask_pixels = mask.load()
    source_pixels = half.load()
    for y in range(half.height):
        for x in range(half.width):
            if colored_pixel(source_pixels[x, y]):
                mask_pixels[x, y] = 255

    bbox = mask.getbbox()
    if bbox is None:
        raise ValueError("학생 그림에서 상·하의 색상 영역을 찾지 못했습니다")

    left, top, right, bottom = bbox
    width = right - left
    height = bottom - top
    # Pull the crop inside the hand-drawn silhouette so white worksheet corners
    # do not leak into side-profile or narrow running frames.
    inset_x = max(2, round(width * (0.19 if top_half else 0.14)))
    inset_top = max(2, round(height * (0.19 if top_half else 0.12)))
    inset_bottom = max(2, round(height * (0.12 if top_half else 0.1)))
    safe = (
        left + inset_x,
        top + inset_top,
        right - inset_x,
        bottom - inset_bottom,
    )
    if safe[2] <= safe[0] or safe[3] <= safe[1]:
        safe = bbox
    return half.crop(safe).convert("RGB")


def is_garment(pixel: tuple[int, int, int, int]) -> float:
    red, green, blue, alpha = pixel
    if alpha < 16:
        return 0.0
    minimum = min(red, green, blue)
    spread = max(red, green, blue) - minimum
    brightness = max(0.0, min(1.0, (minimum - 205) / 38))
    neutrality = max(0.0, min(1.0, 1 - spread / 34))
    return brightness * neutrality * (alpha / 255)


def is_belt(pixel: tuple[int, int, int, int]) -> bool:
    red, green, blue, alpha = pixel
    return (
        alpha > 80
        and 110 <= red <= 190
        and 75 <= green <= 150
        and 55 <= blue <= 130
        and red > green > blue
        and red - blue >= 28
    )


def alpha_bbox(image: Image.Image) -> tuple[int, int, int, int]:
    bbox = image.getchannel("A").getbbox()
    if bbox is None:
        raise ValueError("마스터 시트의 프레임이 비어 있습니다")
    return bbox


def belt_y_for_cell(cell: Image.Image) -> int:
    pixels = cell.load()
    left, top, right, bottom = alpha_bbox(cell)
    height = bottom - top
    search_top = top + round(height * 0.43)
    search_bottom = top + round(height * 0.76)
    row_counts: list[tuple[int, int]] = []
    for y in range(search_top, min(search_bottom, cell.height)):
        count = sum(is_belt(pixels[x, y]) for x in range(left, right))
        row_counts.append((count, y))
    best_count, best_y = max(row_counts, default=(0, top + round(height * 0.58)))
    if best_count < max(3, round((right - left) * 0.045)):
        return top + round(height * 0.58)
    return best_y


def garment_bbox(cell: Image.Image, *, upper: bool, belt_y: int) -> tuple[int, int, int, int]:
    pixels = cell.load()
    xs: list[int] = []
    ys: list[int] = []
    for y in range(cell.height):
        if upper and y >= belt_y:
            continue
        if not upper and y <= belt_y:
            continue
        for x in range(cell.width):
            if is_garment(pixels[x, y]) > 0.05:
                xs.append(x)
                ys.append(y)
    if not xs:
        return (0, 0, cell.width, cell.height)
    return min(xs), min(ys), max(xs) + 1, max(ys) + 1


def texture_for_bbox(
    texture: Image.Image,
    bbox: tuple[int, int, int, int],
) -> Image.Image:
    width = max(1, bbox[2] - bbox[0])
    height = max(1, bbox[3] - bbox[1])
    return texture.resize((width, height), Image.Resampling.LANCZOS)


def apply_texture_to_cell(
    cell: Image.Image,
    upper_texture: Image.Image,
    lower_texture: Image.Image,
) -> Image.Image:
    result = cell.convert("RGBA").copy()
    source = cell.convert("RGBA")
    source_pixels = source.load()
    result_pixels = result.load()
    belt_y = belt_y_for_cell(source)

    upper_bbox = garment_bbox(source, upper=True, belt_y=belt_y)
    lower_bbox = garment_bbox(source, upper=False, belt_y=belt_y)
    upper_scaled = texture_for_bbox(upper_texture, upper_bbox)
    lower_scaled = texture_for_bbox(lower_texture, lower_bbox)
    upper_pixels = upper_scaled.load()
    lower_pixels = lower_scaled.load()

    for y in range(source.height):
        upper = y < belt_y
        bbox = upper_bbox if upper else lower_bbox
        texture_pixels = upper_pixels if upper else lower_pixels
        if y < bbox[1] or y >= bbox[3]:
            continue
        for x in range(source.width):
            strength = is_garment(source_pixels[x, y])
            if strength <= 0:
                continue
            if x < bbox[0] or x >= bbox[2]:
                continue
            texture_pixel = texture_pixels[x - bbox[0], y - bbox[1]]
            base = source_pixels[x, y]
            base_luma = (base[0] * 0.2126 + base[1] * 0.7152 + base[2] * 0.0722)
            shade = max(0.72, min(1.06, base_luma / 244))
            themed = tuple(round(channel * shade) for channel in texture_pixel)
            alpha = strength
            result_pixels[x, y] = (
                round(base[0] * (1 - alpha) + themed[0] * alpha),
                round(base[1] * (1 - alpha) + themed[1] * alpha),
                round(base[2] * (1 - alpha) + themed[2] * alpha),
                base[3],
            )
    return result


def normalize_frame(frame: Image.Image) -> Image.Image:
    bbox = alpha_bbox(frame)
    trimmed = frame.crop(bbox)
    scale = min(
        CONTENT_HEIGHT / max(1, trimmed.height),
        CONTENT_WIDTH / max(1, trimmed.width),
        BASELINE_Y / max(1, trimmed.height),
    )
    size = (
        max(1, round(trimmed.width * scale)),
        max(1, round(trimmed.height * scale)),
    )
    resized = trimmed.resize(size, Image.Resampling.LANCZOS)
    output = Image.new("RGBA", FRAME_SIZE, (0, 0, 0, 0))
    x = round((FRAME_SIZE[0] - resized.width) / 2)
    y = BASELINE_Y - resized.height
    output.alpha_composite(resized, (x, y))
    return output


def build_sheet(frames: list[Image.Image]) -> Image.Image:
    sheet = Image.new(
        "RGBA",
        (FRAME_SIZE[0] * len(frames), FRAME_SIZE[1]),
        (0, 0, 0, 0),
    )
    for index, frame in enumerate(frames):
        sheet.alpha_composite(frame, (FRAME_SIZE[0] * index, 0))
    return sheet


def main() -> None:
    args = parse_args()
    output = args.output
    frames_dir = output / "frames"
    output.mkdir(parents=True, exist_ok=True)
    frames_dir.mkdir(parents=True, exist_ok=True)

    master = Image.open(args.master).convert("RGBA")
    design = Image.open(args.design).convert("RGBA")
    upper_texture = extract_design_texture(design, top_half=True)
    lower_texture = extract_design_texture(design, top_half=False)
    upper_texture.save(output / "upper-texture.png")
    lower_texture.save(output / "lower-texture.png")

    themed_master = Image.new("RGBA", master.size, (0, 0, 0, 0))
    normalized_frames: dict[str, Image.Image] = {}
    frame_metrics: dict[str, dict[str, object]] = {}
    for name, (column, row) in FRAME_CELLS.items():
        bounds = grid_bounds(master.width, master.height, column, row)
        cell = master.crop((bounds.left, bounds.top, bounds.right, bounds.bottom))
        themed_cell = apply_texture_to_cell(cell, upper_texture, lower_texture)
        # Replace the cell pixel-for-pixel. Alpha compositing onto a transparent
        # canvas would premultiply antialiased hair/skin edges and subtly change
        # Peter outside the garment mask.
        themed_master.paste(themed_cell, (bounds.left, bounds.top))
        normalized = normalize_frame(themed_cell)
        normalized_frames[name] = normalized
        frame_metrics[name] = {
            "cell": [column, row],
            "sourceBounds": [bounds.left, bounds.top, bounds.right, bounds.bottom],
            "alphaBBox": list(alpha_bbox(normalized)),
        }

    themed_master.save(output / "themed-master.png")
    animations: dict[str, dict[str, object]] = {}
    for animation_name, frame_names in ANIMATIONS.items():
        frames = [normalized_frames[name] for name in frame_names]
        build_sheet(frames).save(frames_dir / f"{animation_name}-sheet.png")
        animations[animation_name] = {
            "frames": frame_names,
            "frameCount": len(frame_names),
            "sheet": f"{animation_name}-sheet.png",
        }

    manifest = {
        "contract": "fixed-peter-garment-transfer-v1",
        "master": args.master.name,
        "design": args.design.name,
        "grid": [GRID_SIZE, GRID_SIZE],
        "frameSize": list(FRAME_SIZE),
        "baselineY": BASELINE_Y,
        "animations": animations,
        "frames": frame_metrics,
    }
    (frames_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    # Catch accidental no-op generation early.
    if ImageChops.difference(
        master.convert("RGB"),
        themed_master.convert("RGB"),
    ).getbbox() is None:
        raise RuntimeError("의상 디자인이 마스터에 적용되지 않았습니다")
    print(f"Wrote themed master and {len(normalized_frames)} frames to {output}")


if __name__ == "__main__":
    main()
