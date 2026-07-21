#!/usr/bin/env python3
"""Prepare the campfire strip and the campfire-aware fixed Peter master."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


FRAME_COUNT = 8
MASTER_COLUMNS = 5
MASTER_CELL_SIZE = 360
MASTER_POSE_CELLS = (19, 21, 23)
SAFE_MARGIN = 18
FIRE_SAFE_MARGIN = 14


def fit_to_cell(source: Image.Image, cell_size: int, margin: int) -> Image.Image:
    rgba = source.convert("RGBA")
    bounds = rgba.getchannel("A").getbbox()
    if bounds is None:
        raise ValueError("투명하지 않은 피사체를 찾지 못했습니다")
    subject = rgba.crop(bounds)
    available = cell_size - margin * 2
    scale = min(available / subject.width, available / subject.height)
    subject = subject.resize(
        (
            max(1, round(subject.width * scale)),
            max(1, round(subject.height * scale)),
        ),
        Image.Resampling.LANCZOS,
    )
    output = Image.new("RGBA", (cell_size, cell_size), (0, 0, 0, 0))
    output.alpha_composite(
        subject,
        (
            round((cell_size - subject.width) / 2),
            cell_size - margin - subject.height,
        ),
    )
    return output


def build_master(master: Image.Image, poses: Image.Image) -> Image.Image:
    output = master.convert("RGBA")
    expected = MASTER_COLUMNS * MASTER_CELL_SIZE
    if output.size != (expected, expected):
        raise ValueError(f"마스터 크기는 {expected}x{expected}여야 합니다")

    pose_width = poses.width / len(MASTER_POSE_CELLS)
    for pose_index, frame_index in enumerate(MASTER_POSE_CELLS):
        left = round(pose_index * pose_width)
        right = round((pose_index + 1) * pose_width)
        pose = fit_to_cell(poses.crop((left, 0, right, poses.height)), MASTER_CELL_SIZE, SAFE_MARGIN)
        column = frame_index % MASTER_COLUMNS
        row = frame_index // MASTER_COLUMNS
        position = (column * MASTER_CELL_SIZE, row * MASTER_CELL_SIZE)
        output.paste((0, 0, 0, 0), (*position, position[0] + MASTER_CELL_SIZE, position[1] + MASTER_CELL_SIZE))
        output.alpha_composite(pose, position)
    return output


def remove_checker_background(source: Image.Image) -> Image.Image:
    rgba = source.convert("RGBA")
    pixels = rgba.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            red, green, blue, original_alpha = pixels[x, y]
            lightness = (red + green + blue) / 3
            chroma = max(red, green, blue) - min(red, green, blue)
            if lightness > 220 and chroma < 18:
                pixels[x, y] = (0, 0, 0, 0)
                continue
            color_signal = max(0.0, (chroma - 4) / 32)
            dark_signal = max(0.0, (246 - lightness) / 36)
            coverage = min(1.0, max(color_signal, dark_signal))
            alpha = round(original_alpha * coverage)
            pixels[x, y] = (red, green, blue, alpha) if alpha else (0, 0, 0, 0)
    return rgba


def largest_alpha_components(source: Image.Image, count: int) -> list[tuple[int, int, int, int]]:
    """Find the main sprites without assuming the generated strip uses equal cells."""
    alpha = source.getchannel("A")
    width, height = alpha.size
    pixels = alpha.load()
    visited = bytearray(width * height)
    components: list[tuple[int, tuple[int, int, int, int]]] = []

    for y in range(height):
        for x in range(width):
            offset = y * width + x
            if visited[offset] or pixels[x, y] < 24:
                continue
            visited[offset] = 1
            stack = [(x, y)]
            area = 0
            left = right = x
            top = bottom = y
            while stack:
                current_x, current_y = stack.pop()
                area += 1
                left = min(left, current_x)
                right = max(right, current_x)
                top = min(top, current_y)
                bottom = max(bottom, current_y)
                for next_x, next_y in (
                    (current_x - 1, current_y),
                    (current_x + 1, current_y),
                    (current_x, current_y - 1),
                    (current_x, current_y + 1),
                ):
                    if not (0 <= next_x < width and 0 <= next_y < height):
                        continue
                    next_offset = next_y * width + next_x
                    if visited[next_offset] or pixels[next_x, next_y] < 24:
                        continue
                    visited[next_offset] = 1
                    stack.append((next_x, next_y))
            components.append((area, (left, top, right + 1, bottom + 1)))

    if len(components) < count:
        raise ValueError(f"모닥불 주 피사체 {count}개를 찾지 못했습니다")
    return [
        bounds
        for _, bounds in sorted(components, reverse=True)[:count]
    ]


def build_fire_strip(source: Image.Image) -> Image.Image:
    transparent = remove_checker_background(source)
    main_bounds = sorted(
        largest_alpha_components(transparent, FRAME_COUNT),
        key=lambda bounds: (bounds[0] + bounds[2]) / 2,
    )
    centers = [(bounds[0] + bounds[2]) / 2 for bounds in main_bounds]
    separators = [0]
    separators.extend(round((centers[index] + centers[index + 1]) / 2) for index in range(FRAME_COUNT - 1))
    separators.append(transparent.width)

    frames: list[Image.Image] = []
    for index in range(FRAME_COUNT):
        left = separators[index]
        right = separators[index + 1]
        frame = transparent.crop((left, 0, right, transparent.height))
        frames.append(fit_to_cell(frame, 360, FIRE_SAFE_MARGIN))

    strip = Image.new("RGBA", (360 * FRAME_COUNT, 360), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        strip.alpha_composite(frame, (index * 360, 0))
    return strip


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--master", type=Path, required=True)
    parser.add_argument("--poses", type=Path, required=True)
    parser.add_argument("--fire-source", type=Path, required=True)
    parser.add_argument("--master-output", type=Path, required=True)
    parser.add_argument("--runtime-master-output", type=Path, required=True)
    parser.add_argument("--fire-output", type=Path, required=True)
    args = parser.parse_args()

    updated_master = build_master(Image.open(args.master), Image.open(args.poses))
    fire_strip = build_fire_strip(Image.open(args.fire_source))
    for path in (args.master_output, args.runtime_master_output, args.fire_output):
        path.parent.mkdir(parents=True, exist_ok=True)
    updated_master.save(args.master_output)
    updated_master.save(args.runtime_master_output)
    fire_strip.save(args.fire_output)
    print(f"Wrote {args.master_output}")
    print(f"Wrote {args.runtime_master_output}")
    print(f"Wrote {args.fire_output}")


if __name__ == "__main__":
    main()
