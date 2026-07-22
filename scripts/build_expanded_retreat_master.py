#!/usr/bin/env python3
"""Build the v7 Peter and Jesus editor atlases from generated pose sources."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
CELL_SIZE = 360
COLUMNS = 8
ROWS = 4
SAFE_MARGIN = 20
TARGET_HEIGHT = 318
JUMP_HEIGHT = 300

PETER_SOURCE = ROOT / "runtime-assets" / "peter-v7-generated-transparent.png"
JESUS_SOURCE = ROOT / "runtime-assets" / "jesus-v1-generated-transparent.png"
PETER_OUTPUT = ROOT / "runtime-assets" / "peter-retreat-master-expanded-v7.png"
PETER_MANIFEST = ROOT / "runtime-assets" / "peter-retreat-master-expanded-v7.json"
JESUS_OUTPUT = (
    ROOT / "frontend" / "public" / "assets" / "retreat" / "jesus-retreat-master-v1.png"
)
JESUS_MANIFEST = JESUS_OUTPUT.with_suffix(".json")

FRAME_IDS = (
    "idle-a",
    "idle-b",
    *(f"wave-{index}" for index in range(1, 12)),
    *(f"joy-jump-{index}" for index in range(1, 12)),
    "pray-a",
    "pray-b",
    "point",
    "listen-front",
    "listen-side",
    "listen-rear",
    "listen-back",
    "back",
)


@dataclass(frozen=True)
class Actor:
    image: Image.Image
    bbox: tuple[int, int, int, int]


def significant_components(image: Image.Image) -> list[tuple[int, int, int, int]]:
    """Return connected opaque actors while ignoring detached motion marks."""
    alpha = image.getchannel("A")
    width, height = image.size
    pixels = alpha.load()
    seen = bytearray(width * height)
    components: list[tuple[int, tuple[int, int, int, int]]] = []
    for y in range(height):
        for x in range(width):
            offset = y * width + x
            if seen[offset] or pixels[x, y] <= 80:
                continue
            stack = [(x, y)]
            seen[offset] = 1
            left = right = x
            top = bottom = y
            count = 0
            while stack:
                current_x, current_y = stack.pop()
                count += 1
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
                    if seen[next_offset] or pixels[next_x, next_y] <= 80:
                        continue
                    seen[next_offset] = 1
                    stack.append((next_x, next_y))
            if count > 1_000:
                components.append((count, (left, top, right + 1, bottom + 1)))
    return [bbox for _, bbox in components]


def isolate_actor(source: Image.Image, bbox: tuple[int, int, int, int]) -> Actor:
    pad = 5
    left = max(0, bbox[0] - pad)
    top = max(0, bbox[1] - pad)
    right = min(source.width, bbox[2] + pad)
    bottom = min(source.height, bbox[3] + pad)
    crop = source.crop((left, top, right, bottom)).convert("RGBA")
    alpha = crop.getchannel("A")
    core = alpha.point(lambda value: 255 if value > 32 else 0)
    keep = core.filter(ImageFilter.MaxFilter(5))
    crop.putalpha(Image.composite(alpha, Image.new("L", crop.size, 0), keep))
    cleaned_bbox = crop.getchannel("A").getbbox()
    if cleaned_bbox is None:
        raise ValueError(f"empty generated actor at {bbox}")
    return Actor(crop.crop(cleaned_bbox), bbox)


def source_poses(path: Path, *, peter: bool) -> tuple[list[Actor], list[Actor], list[Actor]]:
    source = Image.open(path).convert("RGBA")
    components = significant_components(source)
    rows: list[list[tuple[int, int, int, int]]] = [[], [], [], []]
    for bbox in components:
        center_y = (bbox[1] + bbox[3]) / 2
        row = 0 if center_y < 300 else 1 if center_y < 555 else 2 if center_y < 795 else 3
        rows[row].append(bbox)
    for row in rows:
        row.sort(key=lambda bbox: bbox[0])
    expected = (6, 6 if peter else 3, 7, 8)
    if tuple(map(len, rows)) != expected:
        raise ValueError(f"unexpected generated pose rows in {path.name}: {tuple(map(len, rows))}")

    idle = [isolate_actor(source, bbox) for bbox in rows[0][:2]]
    wave_source = rows[0][2:6] + rows[1][:3]
    jump_source = rows[2]
    static_source = rows[3]
    wave = [isolate_actor(source, bbox) for bbox in wave_source]
    jump = [isolate_actor(source, bbox) for bbox in jump_source]
    static = [isolate_actor(source, bbox) for bbox in static_source]
    return idle + static, wave, jump


def fit_actor(actor: Actor, *, target_height: int, lift: int = 0) -> Image.Image:
    image = actor.image
    scale = min(
        target_height / max(1, image.height),
        (CELL_SIZE - SAFE_MARGIN * 2) / max(1, image.width),
    )
    resized = image.resize(
        (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
        Image.Resampling.LANCZOS,
    )
    resized = clean_chroma_edges(resized)
    frame = Image.new("RGBA", (CELL_SIZE, CELL_SIZE), (0, 0, 0, 0))
    x = round((CELL_SIZE - resized.width) / 2)
    y = CELL_SIZE - SAFE_MARGIN - resized.height - lift
    if y < SAFE_MARGIN:
        y = SAFE_MARGIN
    frame.alpha_composite(resized, (x, y))
    return frame


def clean_chroma_edges(image: Image.Image) -> Image.Image:
    """Contract faint generated green into a neutral antialiased contour."""
    cleaned = image.convert("RGBA")
    alpha = cleaned.getchannel("A")
    inner_alpha = alpha.filter(ImageFilter.MinFilter(5))
    pixels = cleaned.load()
    inner_pixels = inner_alpha.load()
    for y in range(cleaned.height):
        for x in range(cleaned.width):
            red, green, blue, opacity = pixels[x, y]
            if red <= 24 and green >= 235 and blue <= 24:
                pixels[x, y] = (0, 0, 0, 0)
                continue
            if opacity < 44:
                pixels[x, y] = (0, 0, 0, 0)
                continue
            if inner_pixels[x, y] < 250 and green > max(red, blue) + 6:
                green = min(green, max(red, blue) + 4)
            pixels[x, y] = (red, green, blue, opacity)
    return cleaned


def build_frames(path: Path, *, peter: bool) -> list[Image.Image]:
    static, wave_source, jump_source = source_poses(path, peter=peter)
    idle = static[:2]
    final_static = static[2:]
    wave_order = (0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2)
    jump_order = (0, 0, 1, 2, 3, 3, 4, 5, 5, 6, 6)
    jump_lifts = (0, 5, 18, 30, 40, 40, 28, 12, 8, 0, 0)
    frames = [fit_actor(actor, target_height=TARGET_HEIGHT) for actor in idle]
    frames.extend(
        fit_actor(wave_source[index], target_height=TARGET_HEIGHT)
        for index in wave_order
    )
    frames.extend(
        fit_actor(jump_source[index], target_height=JUMP_HEIGHT, lift=lift)
        for index, lift in zip(jump_order, jump_lifts)
    )
    frames.extend(fit_actor(actor, target_height=TARGET_HEIGHT) for actor in final_static)
    if len(frames) != 32:
        raise ValueError(f"expected 32 frames, got {len(frames)}")
    return frames


def write_atlas(
    frames: list[Image.Image],
    output: Path,
    manifest_path: Path,
    *,
    contract_id: str,
    version: int,
) -> None:
    atlas = Image.new("RGBA", (CELL_SIZE * COLUMNS, CELL_SIZE * ROWS), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        atlas.alpha_composite(frame, ((index % COLUMNS) * CELL_SIZE, (index // COLUMNS) * CELL_SIZE))
    output.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(output, optimize=True)
    manifest = {
        "id": contract_id,
        "version": version,
        "layout": "8x4",
        "columns": COLUMNS,
        "rows": ROWS,
        "frame_count": len(frames),
        "frame_width": CELL_SIZE,
        "frame_height": CELL_SIZE,
        "frames": [{"index": index, "id": frame_id} for index, frame_id in enumerate(FRAME_IDS)],
        "animations": {
            "idle": [0, 1],
            "wave": list(range(2, 13)),
            "jump": list(range(13, 24)),
            "pray": [24, 25],
        },
        "editor_poses": {
            "point": 26,
            "listen-front": 27,
            "listen-side": 28,
            "listen-rear": 29,
            "listen-back": 30,
            "back": 31,
        },
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")


def main() -> None:
    write_atlas(
        build_frames(PETER_SOURCE, peter=True),
        PETER_OUTPUT,
        PETER_MANIFEST,
        contract_id="fixed-peter-master-edit-v7",
        version=7,
    )
    write_atlas(
        build_frames(JESUS_SOURCE, peter=False),
        JESUS_OUTPUT,
        JESUS_MANIFEST,
        contract_id="fixed-jesus-master-edit-v1",
        version=1,
    )
    print(f"Wrote Peter v7 to {PETER_OUTPUT}")
    print(f"Wrote Jesus poses to {JESUS_OUTPUT}")


if __name__ == "__main__":
    main()
