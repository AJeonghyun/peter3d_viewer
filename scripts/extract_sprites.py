#!/usr/bin/env python3
"""Extract non-uniform Peter sprite-sheet frames into normalized transparent PNGs.

The supplied sprite sheet is not a real transparent PNG. It is an RGB image with
the checkerboard transparency preview baked into the pixels, so background
removal is intentionally opt-in through sprite_regions.json.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageFilter


@dataclass(frozen=True)
class BBox:
    left: int
    top: int
    right: int
    bottom: int

    @property
    def width(self) -> int:
        return self.right - self.left

    @property
    def height(self) -> int:
        return self.bottom - self.top


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract Peter animation frames from a configured sprite sheet.")
    parser.add_argument("--input", type=Path, help="Source sprite sheet path. Defaults to config.source.")
    parser.add_argument("--config", type=Path, default=Path("scripts/sprite_regions.json"))
    parser.add_argument("--output", type=Path, help="Output frame directory. Defaults to config.output.")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite existing extracted PNG files.")
    parser.add_argument("--force-checkerboard-removal", action="store_true", help="Override config and remove embedded checkerboard pixels.")
    return parser.parse_args()


def load_config(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as file:
            return json.load(file)
    except FileNotFoundError as exc:
        raise SystemExit(f"Config file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid JSON in config file {path}: {exc}") from exc


def is_checker_pixel(pixel: tuple[int, int, int, int], background: dict[str, Any]) -> bool:
    red, green, blue, alpha = pixel
    if alpha <= 8:
        return True
    white_threshold = int(background.get("whiteThreshold", 218))
    gray_delta_tolerance = int(background.get("grayDeltaTolerance", 24))
    maximum = max(red, green, blue)
    minimum = min(red, green, blue)
    return maximum >= white_threshold and (maximum - minimum) <= gray_delta_tolerance


def detect_checkerboard(image: Image.Image) -> bool:
    rgba = image.convert("RGBA")
    width, height = rgba.size
    samples: list[tuple[int, int, int]] = []
    for y in range(0, min(height, 160), 16):
        for x in range(0, min(width, 160), 16):
            red, green, blue, _alpha = rgba.getpixel((x, y))
            maximum = max(red, green, blue)
            minimum = min(red, green, blue)
            if maximum > 230 and maximum - minimum < 18:
                samples.append((red, green, blue))
    return len(samples) > 20 and len({sample[0] for sample in samples}) >= 2


def remove_embedded_checkerboard(region: Image.Image, background: dict[str, Any], frame_name: str) -> Image.Image:
    """Remove only border-connected checkerboard pixels.

    This avoids deleting white clothing details inside the character.
    """
    source = region.convert("RGBA")
    rgba = source.copy()
    width, height = rgba.size
    pixels = rgba.load()
    visited = [[False] * height for _ in range(width)]
    queue: deque[tuple[int, int]] = deque()

    def enqueue_if_background(x: int, y: int) -> None:
        if visited[x][y]:
            return
        visited[x][y] = True
        if is_checker_pixel(pixels[x, y], background):
            queue.append((x, y))

    for x in range(width):
        enqueue_if_background(x, 0)
        enqueue_if_background(x, height - 1)
    for y in range(height):
        enqueue_if_background(0, y)
        enqueue_if_background(width - 1, y)

    removed = 0
    while queue:
        x, y = queue.popleft()
        red, green, blue, _alpha = pixels[x, y]
        pixels[x, y] = (red, green, blue, 0)
        removed += 1
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < width and 0 <= ny < height and not visited[nx][ny]:
                visited[nx][ny] = True
                if is_checker_pixel(pixels[nx, ny], background):
                    queue.append((nx, ny))

    if removed == 0:
        print(f"[warn] {frame_name}: checkerboard removal was enabled, but no border background pixels were removed.")
    rgba = preserve_light_garment(source, rgba)
    return rgba


def preserve_light_garment(source: Image.Image, cutout: Image.Image) -> Image.Image:
    """Restore the white shirt around its blue cloud print.

    The artwork has no dark contour around the white shirt, so an edge flood fill
    alone treats the shirt as part of the baked checkerboard. The cloud pattern is
    a reliable garment-only seed: closing and expanding those seeds reconstructs
    the connected shirt area without bridging large gaps between raised arms.
    """
    blue_seeds = Image.new("L", source.size, 0)
    seed_pixels = blue_seeds.load()
    source_pixels = source.load()
    width, height = source.size
    seed_count = 0
    for x in range(width):
        for y in range(height):
            red, green, blue, _alpha = source_pixels[x, y]
            if (
                blue >= 165
                and green >= 135
                and blue - red >= 18
                and blue - green >= 4
            ):
                seed_pixels[x, y] = 255
                seed_count += 1

    if seed_count < 20:
        return cutout

    garment_mask = blue_seeds.filter(ImageFilter.MaxFilter(29))
    garment_mask = garment_mask.filter(ImageFilter.MinFilter(15))
    garment_mask = garment_mask.filter(ImageFilter.MaxFilter(9))

    restored = cutout.copy()
    restored_pixels = restored.load()
    garment_pixels = garment_mask.load()
    for x in range(width):
        for y in range(height):
            if garment_pixels[x, y] > 0:
                restored_pixels[x, y] = source_pixels[x, y]
    return restored


def alpha_bbox(image: Image.Image) -> BBox | None:
    alpha = image.getchannel("A")
    bbox = alpha.getbbox()
    if bbox is None:
        return None
    left, top, right, bottom = bbox
    return BBox(left, top, right, bottom)


def extract_frame(
    source: Image.Image,
    name: str,
    frame: dict[str, Any],
    canvas: dict[str, Any],
    background: dict[str, Any],
    remove_checkerboard: bool,
) -> tuple[Image.Image, dict[str, Any]]:
    required = ("x", "y", "width", "height")
    missing = [key for key in required if key not in frame]
    if missing:
        raise ValueError(f"{name}: missing required coordinate keys: {', '.join(missing)}")

    x = int(frame["x"])
    y = int(frame["y"])
    width = int(frame["width"])
    height = int(frame["height"])
    if width <= 0 or height <= 0:
        raise ValueError(f"{name}: width and height must be positive.")
    if x < 0 or y < 0 or x + width > source.width or y + height > source.height:
        raise ValueError(f"{name}: region ({x}, {y}, {width}, {height}) exceeds source size {source.size}.")

    region = source.crop((x, y, x + width, y + height)).convert("RGBA")
    if remove_checkerboard:
        region = remove_embedded_checkerboard(region, background, name)

    bbox = alpha_bbox(region)
    if bbox is None:
        raise ValueError(f"{name}: no visible pixels after background removal.")

    trimmed = region.crop((bbox.left, bbox.top, bbox.right, bbox.bottom))
    target_width = int(canvas["width"])
    target_height = int(canvas["height"])
    baseline_y = int(canvas["baselineY"])
    max_content_width = int(canvas.get("maxContentWidth", target_width))
    target_content_height = int(canvas.get("targetContentHeight", baseline_y))

    normalize_height = bool(frame.get("normalizeHeight", True))
    frame_scale = float(frame.get("scale", 1.0))
    scale = frame_scale
    if normalize_height:
        scale *= target_content_height / max(trimmed.height, 1)
    scale = min(scale, max_content_width / max(trimmed.width, 1), baseline_y / max(trimmed.height, 1))
    scale = max(scale, 0.05)

    resized_width = max(1, round(trimmed.width * scale))
    resized_height = max(1, round(trimmed.height * scale))
    resized = trimmed.resize((resized_width, resized_height), Image.Resampling.LANCZOS)

    anchor_x = float(frame.get("anchorX", 0.5))
    anchor_y = float(frame.get("anchorY", 1.0))
    paste_x = round((target_width * anchor_x) - (resized_width * anchor_x))
    paste_y = round(baseline_y - (resized_height * anchor_y))
    paste_x = max(0, min(target_width - resized_width, paste_x))
    paste_y = max(0, min(target_height - resized_height, paste_y))

    canvas_image = Image.new("RGBA", (target_width, target_height), (0, 0, 0, 0))
    canvas_image.alpha_composite(resized, (paste_x, paste_y))
    metrics = {
        "sourceRegion": [x, y, width, height],
        "trimmedBBox": [bbox.left, bbox.top, bbox.width, bbox.height],
        "outputSize": [target_width, target_height],
        "resizedContent": [resized_width, resized_height],
        "baselineY": baseline_y,
        "paste": [paste_x, paste_y],
        "scale": round(scale, 4),
    }
    return canvas_image, metrics


def build_animation_sheet(
    name: str,
    frame_names: list[str],
    extracted_frames: dict[str, Image.Image],
    output_dir: Path,
) -> dict[str, Any]:
    if not frame_names:
        raise ValueError(f"{name}: animation must include at least one frame.")

    missing = [frame_name for frame_name in frame_names if frame_name not in extracted_frames]
    if missing:
        raise ValueError(f"{name}: missing extracted frames: {', '.join(missing)}")

    first_frame = extracted_frames[frame_names[0]]
    frame_width, frame_height = first_frame.size
    sheet = Image.new(
        "RGBA",
        (frame_width * len(frame_names), frame_height),
        (0, 0, 0, 0),
    )
    for index, frame_name in enumerate(frame_names):
        frame = extracted_frames[frame_name]
        if frame.size != first_frame.size:
            raise ValueError(
                f"{name}: {frame_name} has size {frame.size}, expected {first_frame.size}."
            )
        sheet.alpha_composite(frame, (index * frame_width, 0))

    sheet_path = output_dir / f"{name}-sheet.png"
    sheet.save(sheet_path)
    print(f"[ok] {name} animation sheet -> {sheet_path} frames={len(frame_names)}")
    return {
        "file": sheet_path.name,
        "frameWidth": frame_width,
        "frameHeight": frame_height,
        "frameCount": len(frame_names),
        "frames": frame_names,
    }


def main() -> int:
    args = parse_args()
    config = load_config(args.config)
    source_path = args.input or Path(config.get("source", ""))
    output_dir = args.output or Path(config.get("output", ""))
    if not source_path:
        raise SystemExit("No input path provided. Use --input or config.source.")
    if not output_dir:
        raise SystemExit("No output path provided. Use --output or config.output.")

    try:
        source = Image.open(source_path).convert("RGBA")
    except FileNotFoundError as exc:
        raise SystemExit(f"Source image not found: {source_path}") from exc

    background = config.get("background", {})
    has_alpha = Image.open(source_path).mode in {"LA", "RGBA", "PA"} or "A" in Image.open(source_path).getbands()
    checkerboard_detected = detect_checkerboard(source)
    configured_removal = bool(background.get("removeCheckerboard", False) or args.force_checkerboard_removal)

    print(f"Source: {source_path}")
    print(f"Resolution: {source.width}x{source.height}")
    print(f"Alpha channel: {'yes' if has_alpha else 'no'}")
    print(f"Embedded checkerboard detected: {'yes' if checkerboard_detected else 'no'}")
    if checkerboard_detected and not configured_removal:
        print("[warn] The checkerboard appears to be part of the image. It will not be removed unless background.removeCheckerboard is true.")
    if checkerboard_detected and configured_removal:
        print("[warn] Removing only border-connected checkerboard pixels because removal is explicitly configured.")

    canvas = config.get("canvas", {})
    frames = config.get("frames", {})
    if not frames:
        raise SystemExit("No frames configured in sprite_regions.json.")
    output_dir.mkdir(parents=True, exist_ok=True)

    manifest: dict[str, Any] = {
        "source": str(source_path),
        "canvas": canvas,
        "frames": {},
        "animations": {},
    }

    errors: list[str] = []
    extracted_frames: dict[str, Image.Image] = {}
    for name, frame in frames.items():
        output_path = output_dir / f"{name}.png"
        if output_path.exists() and not args.overwrite:
            errors.append(f"{name}: output already exists ({output_path}); pass --overwrite to replace it.")
            continue
        try:
            extracted, metrics = extract_frame(source, name, frame, canvas, background, configured_removal)
            extracted.save(output_path)
            extracted_frames[name] = extracted
            manifest["frames"][name] = {**metrics, "file": output_path.name}
            print(f"[ok] {name} -> {output_path} content={metrics['resizedContent']} paste={metrics['paste']} scale={metrics['scale']}")
        except Exception as exc:  # noqa: BLE001 - frame-specific failure reporting is intentional for this CLI.
            errors.append(f"{name}: {exc}")

    for name, frame_names in config.get("animations", {}).items():
        try:
            manifest["animations"][name] = build_animation_sheet(
                name,
                list(frame_names),
                extracted_frames,
                output_dir,
            )
        except Exception as exc:  # noqa: BLE001 - animation-specific failure reporting is intentional.
            errors.append(f"{name} animation: {exc}")

    manifest_path = output_dir / "manifest.json"
    if not manifest_path.exists() or args.overwrite:
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if errors:
        print("\nExtraction failed for one or more frames:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        return 1

    print(f"Manifest: {manifest_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
