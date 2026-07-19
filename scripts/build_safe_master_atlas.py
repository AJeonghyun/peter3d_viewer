#!/usr/bin/env python3
"""Recover 25 Peter poses that cross the source grid and normalize safe cells."""

from __future__ import annotations

import argparse
from array import array
from collections import deque
from dataclasses import dataclass
from pathlib import Path

from PIL import Image


GRID_SIZE = 5
CELL_SIZE = 360
SAFE_MARGIN = 22
BASELINE_Y = CELL_SIZE - SAFE_MARGIN
ALPHA_THRESHOLD = 8
PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MASTER = (
    PROJECT_ROOT
    / "frontend"
    / "public"
    / "assets"
    / "peter-sober"
    / "peter-sober-master.png"
)
DEFAULT_OUTPUT = (
    PROJECT_ROOT
    / "runtime-assets"
    / "peter-sober-master-safe.png"
)


@dataclass
class Component:
    count: int = 0
    sum_x: int = 0
    sum_y: int = 0
    left: int = 1 << 30
    top: int = 1 << 30
    right: int = 0
    bottom: int = 0

    def add(self, x: int, y: int) -> None:
        self.count += 1
        self.sum_x += x
        self.sum_y += y
        self.left = min(self.left, x)
        self.top = min(self.top, y)
        self.right = max(self.right, x + 1)
        self.bottom = max(self.bottom, y + 1)


def label_components(image: Image.Image) -> tuple[array, list[Component]]:
    width, height = image.size
    alpha = image.getchannel("A").tobytes()
    labels = array("I", [0]) * (width * height)
    components = [Component()]

    for start in range(width * height):
        if alpha[start] < ALPHA_THRESHOLD or labels[start]:
            continue
        component_id = len(components)
        component = Component()
        queue = deque([start])
        labels[start] = component_id
        while queue:
            index = queue.popleft()
            x = index % width
            y = index // width
            component.add(x, y)
            for next_x, next_y in (
                (x - 1, y - 1), (x, y - 1), (x + 1, y - 1),
                (x - 1, y), (x + 1, y),
                (x - 1, y + 1), (x, y + 1), (x + 1, y + 1),
            ):
                if next_x < 0 or next_x >= width or next_y < 0 or next_y >= height:
                    continue
                neighbor = next_y * width + next_x
                if alpha[neighbor] >= ALPHA_THRESHOLD and not labels[neighbor]:
                    labels[neighbor] = component_id
                    queue.append(neighbor)
        components.append(component)
    return labels, components


def component_cells(
    components: list[Component],
    width: int,
    height: int,
) -> list[list[int]]:
    cells: list[list[int]] = [[] for _ in range(GRID_SIZE * GRID_SIZE)]
    for component_id, component in enumerate(components[1:], start=1):
        if component.count < 3:
            continue
        center_x = component.sum_x / component.count
        center_y = component.sum_y / component.count
        column = min(GRID_SIZE - 1, max(0, int(center_x * GRID_SIZE / width)))
        row = min(GRID_SIZE - 1, max(0, int(center_y * GRID_SIZE / height)))
        cells[row * GRID_SIZE + column].append(component_id)
    return cells


def extract_cell(
    source: Image.Image,
    labels: array,
    components: list[Component],
    component_ids: list[int],
) -> Image.Image:
    if not component_ids:
        raise ValueError("마스터에서 비어 있는 프레임을 발견했습니다")
    left = min(components[index].left for index in component_ids)
    top = min(components[index].top for index in component_ids)
    right = max(components[index].right for index in component_ids)
    bottom = max(components[index].bottom for index in component_ids)
    allowed = set(component_ids)
    crop = Image.new("RGBA", (right - left, bottom - top), (0, 0, 0, 0))
    source_pixels = source.load()
    crop_pixels = crop.load()
    width = source.width
    for y in range(top, bottom):
        for x in range(left, right):
            if labels[y * width + x] in allowed:
                crop_pixels[x - left, y - top] = source_pixels[x, y]
    return crop


def normalize_cell(frame: Image.Image) -> Image.Image:
    bbox = frame.getchannel("A").getbbox()
    if bbox is None:
        raise ValueError("마스터 프레임이 비어 있습니다")
    trimmed = frame.crop(bbox)
    available = CELL_SIZE - SAFE_MARGIN * 2
    scale = min(
        available / max(1, trimmed.width),
        available / max(1, trimmed.height),
        1.0,
    )
    resized = trimmed.resize(
        (
            max(1, round(trimmed.width * scale)),
            max(1, round(trimmed.height * scale)),
        ),
        Image.Resampling.LANCZOS,
    )
    output = Image.new("RGBA", (CELL_SIZE, CELL_SIZE), (0, 0, 0, 0))
    x = round((CELL_SIZE - resized.width) / 2)
    y = BASELINE_Y - resized.height
    output.alpha_composite(resized, (x, y))
    return output


def build_safe_atlas(master: Image.Image) -> Image.Image:
    source = master.convert("RGBA")
    labels, components = label_components(source)
    cells = component_cells(components, source.width, source.height)
    if len(cells) != GRID_SIZE * GRID_SIZE or any(not cell for cell in cells):
        raise ValueError("25개 마스터 포즈를 모두 분리하지 못했습니다")
    atlas = Image.new(
        "RGBA",
        (GRID_SIZE * CELL_SIZE, GRID_SIZE * CELL_SIZE),
        (0, 0, 0, 0),
    )
    for index, component_ids in enumerate(cells):
        frame = extract_cell(source, labels, components, component_ids)
        normalized = normalize_cell(frame)
        atlas.alpha_composite(
            normalized,
            ((index % GRID_SIZE) * CELL_SIZE, (index // GRID_SIZE) * CELL_SIZE),
        )
    return atlas


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--master", type=Path, default=DEFAULT_MASTER)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    safe = build_safe_atlas(Image.open(args.master))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    safe.save(args.output)
    print(f"Wrote safe 25-frame atlas to {args.output}")


if __name__ == "__main__":
    main()
