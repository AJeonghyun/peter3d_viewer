#!/usr/bin/env python3
"""Build the seven-frame atlas used by the three retreat display scenes."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SOURCE_MASTER = PROJECT_ROOT / "runtime-assets" / "peter-sober-master-safe.png"
POSE_ASSET_DIR = PROJECT_ROOT / "frontend" / "public" / "assets" / "retreat" / "poses"
SEATED_FRONT_FRAME = POSE_ASSET_DIR / "peter-seated-front.png"
BACK_FRAME = POSE_ASSET_DIR / "peter-standing-back.png"
OUTPUT_DIR = PROJECT_ROOT / "frontend" / "public" / "assets" / "retreat"
OUTPUT_MASTER = OUTPUT_DIR / "peter-retreat-master.png"
OUTPUT_MANIFEST = OUTPUT_DIR / "peter-retreat-master.json"

CELL_SIZE = 360
SAFE_MARGIN = 22
BASELINE_Y = CELL_SIZE - SAFE_MARGIN

POSES = (
    ("idle-a", 0, "animation"),
    ("idle-b", 9, "animation"),
    ("wave", 18, "animation"),
    ("listen-rear", 21, "static"),
    ("listen-side", 23, "static"),
)


def normalize_frame(source: Image.Image) -> Image.Image:
    rgba = source.convert("RGBA")
    bounds = rgba.getchannel("A").getbbox()
    if bounds is None:
        raise ValueError("빈 포즈 프레임은 라이브 마스터에 넣을 수 없습니다")
    trimmed = rgba.crop(bounds)
    available = CELL_SIZE - SAFE_MARGIN * 2
    scale = min(available / trimmed.width, available / trimmed.height)
    resized = trimmed.resize(
        (max(1, round(trimmed.width * scale)), max(1, round(trimmed.height * scale))),
        Image.Resampling.LANCZOS,
    )
    output = Image.new("RGBA", (CELL_SIZE, CELL_SIZE), (0, 0, 0, 0))
    x = round((CELL_SIZE - resized.width) / 2)
    y = BASELINE_Y - resized.height
    output.alpha_composite(resized, (x, y))
    return output


def main() -> None:
    source = Image.open(SOURCE_MASTER).convert("RGBA")
    if source.size != (CELL_SIZE * 5, CELL_SIZE * 5):
        raise ValueError(f"예상하지 못한 생성용 마스터 크기: {source.size}")

    frames: list[tuple[str, Image.Image, str]] = []
    for pose_id, source_index, kind in POSES:
        column = source_index % 5
        row = source_index // 5
        frame = source.crop((
            column * CELL_SIZE,
            row * CELL_SIZE,
            (column + 1) * CELL_SIZE,
            (row + 1) * CELL_SIZE,
        ))
        frames.append((pose_id, normalize_frame(frame), kind))
    frames.insert(3, (
        "listen-front",
        normalize_frame(Image.open(SEATED_FRONT_FRAME)),
        "static",
    ))
    frames.append(("back", normalize_frame(Image.open(BACK_FRAME)), "static"))

    atlas = Image.new("RGBA", (CELL_SIZE * len(frames), CELL_SIZE), (0, 0, 0, 0))
    manifest_frames = []
    for index, (pose_id, frame, kind) in enumerate(frames):
        atlas.alpha_composite(frame, (index * CELL_SIZE, 0))
        manifest_frames.append({"id": pose_id, "index": index, "kind": kind})

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    atlas.save(OUTPUT_MASTER)
    OUTPUT_MANIFEST.write_text(json.dumps({
        "id": "retreat-live-master-v1",
        "layout": "7x1",
        "columns": len(frames),
        "rows": 1,
        "frame_count": len(frames),
        "frame_width": CELL_SIZE,
        "frame_height": CELL_SIZE,
        "frames": manifest_frames,
        "animations": {"idle": [0, 1], "wave": [2]},
    }, ensure_ascii=False, indent=2) + "\n")
    print(f"Wrote {len(frames)}-frame retreat atlas to {OUTPUT_MASTER}")


if __name__ == "__main__":
    main()
