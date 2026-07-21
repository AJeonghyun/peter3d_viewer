#!/usr/bin/env python3
"""Combine the legacy 25-frame atlas with the seven retreat editor poses."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
LEGACY_MASTER = ROOT / "runtime-assets" / "peter-sober-master-safe.png"
RETREAT_MASTER = (
    ROOT / "frontend" / "public" / "assets" / "retreat" / "peter-retreat-master.png"
)
OUTPUT_MASTER = ROOT / "runtime-assets" / "peter-retreat-master-expanded-v6.png"
OUTPUT_MANIFEST = ROOT / "runtime-assets" / "peter-retreat-master-expanded-v6.json"

CELL_SIZE = 360
COLUMNS = 8
ROWS = 4
LEGACY_FRAME_COUNT = 25
RETREAT_POSE_IDS = (
    "idle-a",
    "idle-b",
    "wave",
    "listen-front",
    "listen-rear",
    "listen-side",
    "back",
)


def cell(image: Image.Image, index: int, columns: int) -> Image.Image:
    column = index % columns
    row = index // columns
    return image.crop((
        column * CELL_SIZE,
        row * CELL_SIZE,
        (column + 1) * CELL_SIZE,
        (row + 1) * CELL_SIZE,
    ))


def main() -> None:
    legacy = Image.open(LEGACY_MASTER).convert("RGBA")
    retreat = Image.open(RETREAT_MASTER).convert("RGBA")
    if legacy.size != (CELL_SIZE * 5, CELL_SIZE * 5):
        raise ValueError(f"예상하지 못한 25컷 마스터 크기: {legacy.size}")
    if retreat.size != (CELL_SIZE * 7, CELL_SIZE):
        raise ValueError(f"예상하지 못한 7포즈 마스터 크기: {retreat.size}")

    output = Image.new(
        "RGBA",
        (CELL_SIZE * COLUMNS, CELL_SIZE * ROWS),
        (0, 0, 0, 0),
    )
    frames: list[dict[str, object]] = []
    for index in range(LEGACY_FRAME_COUNT):
        frame = cell(legacy, index, 5)
        output.alpha_composite(
            frame,
            ((index % COLUMNS) * CELL_SIZE, (index // COLUMNS) * CELL_SIZE),
        )
        frames.append({"index": index, "id": f"legacy-{index + 1}"})

    for retreat_index, pose_id in enumerate(RETREAT_POSE_IDS):
        index = LEGACY_FRAME_COUNT + retreat_index
        frame = cell(retreat, retreat_index, 7)
        output.alpha_composite(
            frame,
            ((index % COLUMNS) * CELL_SIZE, (index // COLUMNS) * CELL_SIZE),
        )
        frames.append({"index": index, "id": pose_id})

    OUTPUT_MASTER.parent.mkdir(parents=True, exist_ok=True)
    output.save(OUTPUT_MASTER)
    OUTPUT_MANIFEST.write_text(json.dumps({
        "id": "fixed-peter-master-edit-v6",
        "layout": "8x4",
        "columns": COLUMNS,
        "rows": ROWS,
        "frame_count": len(frames),
        "frame_width": CELL_SIZE,
        "frame_height": CELL_SIZE,
        "frames": frames,
        "animations": {
            "idle": [25, 26],
            "walk": list(range(1, 9)),
            "run": list(range(10, 18)),
            "wave": [27],
            "jump": [20],
            "pray": [22],
            "point": [24],
        },
        "editor_poses": {
            pose_id: 25 + index for index, pose_id in enumerate(RETREAT_POSE_IDS)
        },
    }, ensure_ascii=False, indent=2) + "\n")
    print(f"Wrote {len(frames)}-frame expanded master to {OUTPUT_MASTER}")


if __name__ == "__main__":
    main()
