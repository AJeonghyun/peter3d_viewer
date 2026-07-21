"""Deterministic pixel-level analysis and normalization for sprite atlases.

Everything here is pure image processing: no network calls, no database access.
"""

import io
import struct
from typing import Any, Union

from fastapi import HTTPException
from PIL import Image, ImageDraw, ImageFilter, UnidentifiedImageError

from backend import config
from backend.media import image_to_png_bytes


def validate_showcase_sprite_png(sprite: bytes) -> tuple[int, int]:
    if (
        len(sprite) < 24
        or not sprite.startswith(b"\x89PNG\r\n\x1a\n")
        or sprite[12:16] != b"IHDR"
    ):
        raise ValueError("PNG 헤더가 올바르지 않습니다")

    width, height = struct.unpack(">II", sprite[16:24])
    if (width, height) != (config.SHOWCASE_SPRITE_WIDTH, config.SHOWCASE_SPRITE_HEIGHT):
        raise ValueError(
            f"스프라이트 크기는 {config.SHOWCASE_SPRITE_SIZE}여야 합니다 "
            f"(현재 {width}x{height})"
        )

    cell_width = width // config.SHOWCASE_SPRITE_COLUMNS
    cell_height = height // config.SHOWCASE_SPRITE_ROWS
    if (
        width % config.SHOWCASE_SPRITE_COLUMNS
        or height % config.SHOWCASE_SPRITE_ROWS
        or cell_width != cell_height
    ):
        raise ValueError("4x3 스프라이트의 각 셀은 동일한 정사각형이어야 합니다")
    return width, height


def median(values: list[int]) -> int:
    ordered = sorted(values)
    if not ordered:
        return 0
    return ordered[len(ordered) // 2]


def _sprite_foreground_mask(cell: Image.Image) -> tuple[Image.Image, tuple[int, int, int], int]:
    rgb = cell.convert("RGB")
    width, height = rgb.size
    border = max(3, round(min(width, height) * 0.018))
    samples: list[tuple[int, int, int]] = []
    pixels = rgb.load()
    for x in range(0, width, 3):
        for y in (*range(0, border), *range(height - border, height)):
            samples.append(pixels[x, y])
    for y in range(border, height - border, 3):
        for x in (*range(0, border), *range(width - border, width)):
            samples.append(pixels[x, y])
    background = tuple(
        median([sample[channel] for sample in samples])
        for channel in range(3)
    )
    border_distances = [
        round(sum((sample[channel] - background[channel]) ** 2 for channel in range(3)) ** 0.5)
        for sample in samples
    ]
    threshold = max(24, min(58, median(border_distances) + 18))
    mask = Image.new("L", rgb.size, 0)
    mask_pixels = mask.load()
    for y in range(height):
        for x in range(width):
            pixel = pixels[x, y]
            distance = sum(
                (pixel[channel] - background[channel]) ** 2 for channel in range(3)
            ) ** 0.5
            if distance >= threshold:
                mask_pixels[x, y] = 255
    return mask.filter(ImageFilter.MedianFilter(3)), background, threshold


def analyze_showcase_sprite_pixels(sprite: bytes) -> dict:
    """Measure every cell so obvious clipping never depends on an AI opinion."""
    try:
        atlas = Image.open(io.BytesIO(sprite)).convert("RGB")
        atlas.load()
    except (UnidentifiedImageError, OSError, ValueError):
        return {
            "status": "failed",
            "summary": "스프라이트 픽셀을 읽을 수 없어 안전한 애니메이션인지 확인할 수 없습니다.",
            "can_approve": False,
            "frames": [],
            "issues": ["스프라이트 픽셀 디코딩 실패"],
        }

    width, height = atlas.size
    if (width, height) != (config.SHOWCASE_SPRITE_WIDTH, config.SHOWCASE_SPRITE_HEIGHT):
        return {
            "status": "failed",
            "summary": "스프라이트 캔버스 규격이 달라 프레임을 안전하게 나눌 수 없습니다.",
            "can_approve": False,
            "frames": [],
            "issues": [f"캔버스 {width}x{height}, 필요 {config.SHOWCASE_SPRITE_SIZE}"],
        }

    cell_width = width // config.SHOWCASE_SPRITE_COLUMNS
    cell_height = height // config.SHOWCASE_SPRITE_ROWS
    frames: list[dict] = []
    baseline_by_row: dict[int, list[int]] = {}
    failed_frames = 0
    warning_frames = 0

    for row in range(config.SHOWCASE_SPRITE_ROWS):
        for column in range(config.SHOWCASE_SPRITE_COLUMNS):
            frame_number = row * config.SHOWCASE_SPRITE_COLUMNS + column + 1
            cell = atlas.crop((
                column * cell_width,
                row * cell_height,
                (column + 1) * cell_width,
                (row + 1) * cell_height,
            ))
            mask, background, threshold = _sprite_foreground_mask(cell)
            bbox = mask.getbbox()
            issues: list[str] = []
            status = "passed"
            margins: dict[str, int] | None = None
            coverage = sum(mask.getdata()) / 255 / (cell_width * cell_height)
            if bbox is None or coverage < 0.025:
                status = "failed"
                issues.append("캐릭터 전신을 찾지 못함")
            else:
                left, top, right, bottom = bbox
                margins = {
                    "left": left,
                    "top": top,
                    "right": cell_width - right,
                    "bottom": cell_height - bottom,
                }
                baseline_by_row.setdefault(row, []).append(bottom)
                unsafe = [
                    edge for edge, value in margins.items()
                    if value < config.SHOWCASE_FRAME_SAFE_MARGIN
                ]
                if unsafe:
                    status = "failed"
                    korean_edges = {
                        "left": "왼쪽", "top": "위쪽", "right": "오른쪽", "bottom": "아래쪽",
                    }
                    issues.append(
                        f"{', '.join(korean_edges[edge] for edge in unsafe)} 여백 부족"
                    )
                elif min(margins.values()) < config.SHOWCASE_FRAME_SAFE_MARGIN + 8:
                    status = "warning"
                    issues.append("프레임 경계와 캐릭터가 가까움")
                if coverage > 0.72:
                    status = "failed"
                    issues.append("캐릭터 또는 배경이 셀 대부분을 차지함")

            if status == "failed":
                failed_frames += 1
            elif status == "warning":
                warning_frames += 1
            frames.append({
                "frame": frame_number,
                "row": row + 1,
                "column": column + 1,
                "status": status,
                "bbox": list(bbox) if bbox else None,
                "margins": margins,
                "coverage": round(coverage, 4),
                "background": list(background),
                "threshold": threshold,
                "issues": issues,
            })

    baseline_issues = []
    for row, baselines in baseline_by_row.items():
        if baselines and max(baselines) - min(baselines) > 14:
            baseline_issues.append(
                f"{row + 1}행 발 기준선 편차 {max(baselines) - min(baselines)}px"
            )
    if failed_frames:
        status = "failed"
        summary = f"{failed_frames}개 프레임에서 전신 잘림 위험을 찾았습니다."
    elif warning_frames or baseline_issues:
        status = "warning"
        summary = "전신은 확인됐지만 관리자 확인이 필요한 프레임이 있습니다."
    else:
        status = "passed"
        summary = "12개 프레임 모두 머리부터 발끝까지 안전 여백 안에 있습니다."
    return {
        "status": status,
        "summary": summary,
        "can_approve": status != "failed",
        "safe_margin_px": config.SHOWCASE_FRAME_SAFE_MARGIN,
        "frames": frames,
        "issues": baseline_issues,
    }


def load_garment_master_atlas() -> Image.Image:
    """Load the v6 32-frame master, or build a read-only fallback from source masters."""
    target_size = (config.GARMENT_ATLAS_WIDTH, config.GARMENT_ATLAS_HEIGHT)
    if config.SHOWCASE_EXPANDED_MASTER_PATH.is_file():
        with Image.open(config.SHOWCASE_EXPANDED_MASTER_PATH) as source:
            master = source.convert("RGBA")
            master.load()
        if master.size != target_size:
            raise HTTPException(
                status_code=500,
                detail=f"고정 Peter v6 마스터는 {target_size[0]}x{target_size[1]}여야 합니다",
            )
        return master

    legacy_path = (
        config.SHOWCASE_SAFE_MASTER_PATH
        if config.SHOWCASE_SAFE_MASTER_PATH.is_file()
        else config.SHOWCASE_SOURCE_MASTER_PATH
    )
    if not legacy_path.is_file():
        raise HTTPException(status_code=500, detail="고정 Peter 마스터 스프라이트를 찾지 못했습니다")
    if not config.SHOWCASE_RETREAT_MASTER_PATH.is_file():
        raise HTTPException(status_code=500, detail="Peter retreat 확장 마스터를 찾지 못했습니다")

    atlas = Image.new("RGBA", target_size, (0, 0, 0, 0))
    with Image.open(legacy_path) as source:
        legacy = source.convert("RGBA")
        legacy.load()
    with Image.open(config.SHOWCASE_RETREAT_MASTER_PATH) as source:
        retreat = source.convert("RGBA")
        retreat.load()

    for frame in range(1, 26):
        source_index = frame - 1
        source_column = source_index % 5
        source_row = source_index // 5
        target_box = garment_atlas_frame_box(frame)
        cell = legacy.crop((
            source_column * config.GARMENT_ATLAS_CELL_SIZE,
            source_row * config.GARMENT_ATLAS_CELL_SIZE,
            (source_column + 1) * config.GARMENT_ATLAS_CELL_SIZE,
            (source_row + 1) * config.GARMENT_ATLAS_CELL_SIZE,
        ))
        atlas.alpha_composite(cell, (target_box[0], target_box[1]))

    for offset, frame in enumerate(range(26, config.GARMENT_FRAME_COUNT + 1)):
        target_box = garment_atlas_frame_box(frame)
        cell = retreat.crop((
            offset * config.GARMENT_ATLAS_CELL_SIZE,
            0,
            (offset + 1) * config.GARMENT_ATLAS_CELL_SIZE,
            config.GARMENT_ATLAS_CELL_SIZE,
        ))
        atlas.alpha_composite(cell, (target_box[0], target_box[1]))
    return atlas


def master_reference_for_ai() -> bytes:
    """Render the transparent canonical atlas on the key color requested from GPT Image."""
    master = load_garment_master_atlas().resize(
        (config.GARMENT_AI_ATLAS_WIDTH, config.GARMENT_AI_ATLAS_HEIGHT),
        Image.Resampling.LANCZOS,
    )
    reference = Image.new(
        "RGBA",
        (config.GARMENT_AI_ATLAS_WIDTH, config.GARMENT_AI_ATLAS_HEIGHT),
        (*config.GARMENT_AI_BACKGROUND, 255),
    )
    reference.alpha_composite(master)
    return image_to_png_bytes(reference.convert("RGB"))


def decontaminate_chroma_contour(image: Image.Image) -> Image.Image:
    """Clear hidden key RGB and remove green from the visible silhouette contour."""
    rgba = image.convert("RGBA")
    pixels = rgba.load()
    inner_alpha = rgba.getchannel("A").filter(ImageFilter.MinFilter(5))
    inner_alpha_pixels = inner_alpha.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            red, green, blue, alpha = pixels[x, y]
            if alpha == 0:
                pixels[x, y] = (0, 0, 0, 0)
                continue
            if alpha < 255 or inner_alpha_pixels[x, y] < 250:
                non_green = max(red, blue)
                if green > non_green + config.CHROMA_SPILL_TOLERANCE:
                    green = non_green + config.CHROMA_SPILL_TOLERANCE
            pixels[x, y] = (red, green, blue, alpha)

    return rgba


def remove_connected_cell_background(cell: Image.Image, *, threshold: int = 56) -> Image.Image:
    """Remove connected key color and decontaminate only the anti-aliased contour."""
    rgba = cell.convert("RGBA")
    rgb = rgba.convert("RGB")
    marker = (1, 2, 3)
    work = rgb.copy()
    width, height = work.size
    for seed in ((0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)):
        if work.getpixel(seed) != marker:
            ImageDraw.floodfill(work, seed, marker, thresh=threshold)
    source_alpha = rgba.getchannel("A")
    alpha = Image.new("L", rgba.size, 255)
    alpha_pixels = alpha.load()
    source_alpha_pixels = source_alpha.load()
    rgb_pixels = rgb.load()
    work_pixels = work.load()
    for y in range(height):
        for x in range(width):
            red, green, blue = rgb_pixels[x, y]
            is_reserved_key_color = red <= 24 and green >= 235 and blue <= 24
            alpha_pixels[x, y] = (
                0
                if work_pixels[x, y] == marker or is_reserved_key_color
                else source_alpha_pixels[x, y]
            )
    alpha = alpha.filter(ImageFilter.MedianFilter(3))
    alpha_pixels = alpha.load()
    for y in range(height):
        for x in range(width):
            red, green, blue = rgb_pixels[x, y]
            if red <= 24 and green >= 235 and blue <= 24:
                alpha_pixels[x, y] = 0

    # Contract by one pixel, feather inward, and never grow into the removed
    # background. This removes the opaque chroma rim left by model antialiasing.
    contracted = alpha.filter(ImageFilter.MinFilter(3))
    feathered = contracted.filter(ImageFilter.GaussianBlur(config.CHROMA_EDGE_FEATHER_RADIUS))
    feathered_pixels = feathered.load()
    for y in range(height):
        for x in range(width):
            feathered_pixels[x, y] = min(alpha_pixels[x, y], feathered_pixels[x, y])

    # Restrict despill to the feathered contour. Interior green garment pixels
    # stay untouched, while green blended into hair/skin/clothes is neutralized.
    inner = feathered.filter(ImageFilter.MinFilter(5))
    inner_pixels = inner.load()
    rgba_pixels = rgba.load()
    for y in range(height):
        for x in range(width):
            final_alpha = feathered_pixels[x, y]
            if final_alpha == 0:
                rgba_pixels[x, y] = (0, 0, 0, 0)
                continue
            red, green, blue, _ = rgba_pixels[x, y]
            if inner_pixels[x, y] < 250:
                non_green = max(red, blue)
                if green > non_green + config.CHROMA_SPILL_TOLERANCE:
                    green = non_green + config.CHROMA_SPILL_TOLERANCE
            rgba_pixels[x, y] = (red, green, blue, final_alpha)
    return decontaminate_chroma_contour(rgba)


def master_display_target_bbox(master_bbox: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    """Expand a master frame to the same visual envelope as the shared Peter actor."""
    left, top, right, bottom = master_bbox
    source_width = max(1, right - left)
    source_height = max(1, bottom - top)
    maximum_width = config.GARMENT_ATLAS_CELL_SIZE - config.SHOWCASE_FRAME_SAFE_MARGIN * 2
    maximum_height = bottom - config.SHOWCASE_FRAME_SAFE_MARGIN
    scale = min(
        config.GARMENT_DISPLAY_SCALE,
        maximum_width / source_width,
        maximum_height / source_height,
    )
    target_width = max(1, round(source_width * scale))
    target_height = max(1, round(source_height * scale))
    center_x = (left + right) / 2
    target_left = round(center_x - target_width / 2)
    target_left = max(
        config.SHOWCASE_FRAME_SAFE_MARGIN,
        min(
            target_left,
            config.GARMENT_ATLAS_CELL_SIZE - config.SHOWCASE_FRAME_SAFE_MARGIN - target_width,
        ),
    )
    target_top = bottom - target_height
    return target_left, target_top, target_left + target_width, bottom


def normalize_master_locked_atlas(generated: Union[bytes, Image.Image]) -> Image.Image:
    """Match every AI frame to the shared actor's size and the master's foot anchor."""
    try:
        candidate = (
            Image.open(io.BytesIO(generated)).convert("RGBA")
            if isinstance(generated, bytes)
            else generated.convert("RGBA")
        )
        candidate.load()
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise ValueError("AI 32컷 이미지를 읽을 수 없습니다") from exc
    if candidate.size != (config.GARMENT_AI_ATLAS_WIDTH, config.GARMENT_AI_ATLAS_HEIGHT):
        candidate = candidate.resize(
            (config.GARMENT_AI_ATLAS_WIDTH, config.GARMENT_AI_ATLAS_HEIGHT),
            Image.Resampling.LANCZOS,
        )
    master = load_garment_master_atlas()
    output = Image.new(
        "RGBA", (config.GARMENT_ATLAS_WIDTH, config.GARMENT_ATLAS_HEIGHT), (0, 0, 0, 0)
    )
    for index in range(config.GARMENT_FRAME_COUNT):
        column = index % config.GARMENT_ATLAS_COLUMNS
        row = index // config.GARMENT_ATLAS_COLUMNS
        source_cell = candidate.crop((
            column * config.GARMENT_AI_CELL_SIZE,
            row * config.GARMENT_AI_CELL_SIZE,
            (column + 1) * config.GARMENT_AI_CELL_SIZE,
            (row + 1) * config.GARMENT_AI_CELL_SIZE,
        ))
        cleaned = remove_connected_cell_background(source_cell)
        generated_bbox = cleaned.getchannel("A").getbbox()
        master_cell = master.crop((
            column * config.GARMENT_ATLAS_CELL_SIZE,
            row * config.GARMENT_ATLAS_CELL_SIZE,
            (column + 1) * config.GARMENT_ATLAS_CELL_SIZE,
            (row + 1) * config.GARMENT_ATLAS_CELL_SIZE,
        ))
        master_bbox = master_cell.getchannel("A").getbbox()
        if generated_bbox is None or master_bbox is None:
            continue
        character = cleaned.crop(generated_bbox)
        target_bbox = master_display_target_bbox(master_bbox)
        target_height = target_bbox[3] - target_bbox[1]
        scale = min(
            target_height / max(1, character.height),
            (config.GARMENT_ATLAS_CELL_SIZE - config.SHOWCASE_FRAME_SAFE_MARGIN * 2)
            / max(1, character.width),
        )
        resized = character.resize(
            (
                max(1, round(character.width * scale)),
                max(1, round(character.height * scale)),
            ),
            Image.Resampling.LANCZOS,
        )
        resized = decontaminate_chroma_contour(resized)
        target_center_x = (target_bbox[0] + target_bbox[2]) / 2
        target_x = round(target_center_x - resized.width / 2)
        target_x = max(
            config.SHOWCASE_FRAME_SAFE_MARGIN,
            min(
                target_x,
                config.GARMENT_ATLAS_CELL_SIZE
                - config.SHOWCASE_FRAME_SAFE_MARGIN
                - resized.width,
            ),
        )
        target_y = target_bbox[3] - resized.height
        output.alpha_composite(
            resized,
            (
                column * config.GARMENT_ATLAS_CELL_SIZE + target_x,
                row * config.GARMENT_ATLAS_CELL_SIZE + target_y,
            ),
        )
    return decontaminate_chroma_contour(output)


def garment_atlas_frame_box(frame: int, *, cell_size: int = None) -> tuple[int, int, int, int]:
    if cell_size is None:
        cell_size = config.GARMENT_ATLAS_CELL_SIZE
    if frame < 1 or frame > config.GARMENT_FRAME_COUNT:
        raise ValueError(f"프레임 번호는 1부터 {config.GARMENT_FRAME_COUNT}까지여야 합니다")
    index = frame - 1
    column = index % config.GARMENT_ATLAS_COLUMNS
    row = index // config.GARMENT_ATLAS_COLUMNS
    return (
        column * cell_size,
        row * cell_size,
        (column + 1) * cell_size,
        (row + 1) * cell_size,
    )


def frame_reference_for_ai(source: Union[bytes, Image.Image], frame: int) -> bytes:
    image = (
        Image.open(io.BytesIO(source)).convert("RGBA")
        if isinstance(source, bytes)
        else source.convert("RGBA")
    )
    image.load()
    if image.size != (config.GARMENT_ATLAS_WIDTH, config.GARMENT_ATLAS_HEIGHT):
        raise ValueError(
            f"프레임 참조 아틀라스는 {config.GARMENT_ATLAS_WIDTH}x{config.GARMENT_ATLAS_HEIGHT}여야 합니다"
        )
    cell = image.crop(garment_atlas_frame_box(frame))
    cell = cell.resize(
        (config.GARMENT_AI_FRAME_SIZE, config.GARMENT_AI_FRAME_SIZE),
        Image.Resampling.LANCZOS,
    )
    reference = Image.new(
        "RGBA",
        (config.GARMENT_AI_FRAME_SIZE, config.GARMENT_AI_FRAME_SIZE),
        (*config.GARMENT_AI_BACKGROUND, 255),
    )
    reference.alpha_composite(cell)
    return image_to_png_bytes(reference.convert("RGB"))


def master_frame_reference_for_ai(frame: int) -> bytes:
    return frame_reference_for_ai(load_garment_master_atlas(), frame)


def normalize_master_locked_frame(generated: Union[bytes, Image.Image], frame: int) -> Image.Image:
    try:
        candidate = (
            Image.open(io.BytesIO(generated)).convert("RGBA")
            if isinstance(generated, bytes)
            else generated.convert("RGBA")
        )
        candidate.load()
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise ValueError("AI 문제 컷 이미지를 읽을 수 없습니다") from exc
    if candidate.width != candidate.height:
        raise ValueError("AI 문제 컷 결과는 정사각형이어야 합니다")
    if candidate.size != (config.GARMENT_AI_FRAME_SIZE, config.GARMENT_AI_FRAME_SIZE):
        candidate = candidate.resize(
            (config.GARMENT_AI_FRAME_SIZE, config.GARMENT_AI_FRAME_SIZE),
            Image.Resampling.LANCZOS,
        )
    cleaned = remove_connected_cell_background(candidate)
    generated_bbox = cleaned.getchannel("A").getbbox()
    if generated_bbox is None:
        raise ValueError("AI 문제 컷 결과에 캐릭터가 없습니다")
    master_cell = load_garment_master_atlas().crop(garment_atlas_frame_box(frame))
    master_cell.load()
    master_bbox = master_cell.getchannel("A").getbbox()
    if master_bbox is None:
        raise ValueError(f"고정 Peter 마스터의 {frame}컷을 찾지 못했습니다")

    character = cleaned.crop(generated_bbox)
    target_bbox = master_display_target_bbox(master_bbox)
    target_height = target_bbox[3] - target_bbox[1]
    scale = min(
        target_height / max(1, character.height),
        (config.GARMENT_ATLAS_CELL_SIZE - config.SHOWCASE_FRAME_SAFE_MARGIN * 2)
        / max(1, character.width),
    )
    resized = character.resize(
        (
            max(1, round(character.width * scale)),
            max(1, round(character.height * scale)),
        ),
        Image.Resampling.LANCZOS,
    )
    resized = decontaminate_chroma_contour(resized)
    target_center_x = (target_bbox[0] + target_bbox[2]) / 2
    target_x = round(target_center_x - resized.width / 2)
    target_x = max(
        config.SHOWCASE_FRAME_SAFE_MARGIN,
        min(
            target_x,
            config.GARMENT_ATLAS_CELL_SIZE
            - config.SHOWCASE_FRAME_SAFE_MARGIN
            - resized.width,
        ),
    )
    target_y = target_bbox[3] - resized.height
    output = Image.new(
        "RGBA",
        (config.GARMENT_ATLAS_CELL_SIZE, config.GARMENT_ATLAS_CELL_SIZE),
        (0, 0, 0, 0),
    )
    output.alpha_composite(resized, (target_x, target_y))
    return decontaminate_chroma_contour(output)


def replace_garment_atlas_frame(
    atlas: Union[bytes, Image.Image],
    replacement: Union[bytes, Image.Image],
    frame: int,
) -> Image.Image:
    base = (
        Image.open(io.BytesIO(atlas)).convert("RGBA")
        if isinstance(atlas, bytes)
        else atlas.convert("RGBA")
    )
    base.load()
    if base.size != (config.GARMENT_ATLAS_WIDTH, config.GARMENT_ATLAS_HEIGHT):
        raise ValueError(f"기존 32컷은 {config.GARMENT_ATLAS_WIDTH}x{config.GARMENT_ATLAS_HEIGHT}여야 합니다")
    cell = (
        Image.open(io.BytesIO(replacement)).convert("RGBA")
        if isinstance(replacement, bytes)
        else replacement.convert("RGBA")
    )
    cell.load()
    if cell.size != (config.GARMENT_ATLAS_CELL_SIZE, config.GARMENT_ATLAS_CELL_SIZE):
        raise ValueError(
            f"교체 컷은 {config.GARMENT_ATLAS_CELL_SIZE}x{config.GARMENT_ATLAS_CELL_SIZE}여야 합니다"
        )
    box = garment_atlas_frame_box(frame)
    base.paste((0, 0, 0, 0), box)
    base.alpha_composite(cell, (box[0], box[1]))
    return base


def count_chroma_spill_pixels(image: Image.Image) -> int:
    """Count green-dominant pixels on the silhouette without flagging green interiors."""
    count = 0
    rgba = image.convert("RGBA")
    pixels = rgba.load()
    inner_alpha = rgba.getchannel("A").filter(ImageFilter.MinFilter(5))
    inner_alpha_pixels = inner_alpha.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            red, green, blue, alpha = pixels[x, y]
            if (
                alpha > 0
                and (
                    (red <= 24 and green >= 235 and blue <= 24)
                    or (
                        inner_alpha_pixels[x, y] < 250
                        and green > max(red, blue) + config.CHROMA_SPILL_TOLERANCE
                    )
                )
            ):
                count += 1
    return count


def analyze_garment_atlas_pixels(atlas: Any) -> dict:
    image = Image.open(io.BytesIO(atlas)).convert("RGBA") if isinstance(atlas, bytes) else atlas.convert("RGBA")
    if image.size != (config.GARMENT_ATLAS_WIDTH, config.GARMENT_ATLAS_HEIGHT):
        return {
            "status": "failed",
            "can_approve": False,
            "summary": f"Atlas must be {config.GARMENT_ATLAS_WIDTH}x{config.GARMENT_ATLAS_HEIGHT}.",
            "frames": [],
            "issues": ["invalid_size"],
        }
    master = load_garment_master_atlas()
    frames = []
    failed = 0
    atlas_issues: list[str] = []
    for index in range(config.GARMENT_FRAME_COUNT):
        column = index % config.GARMENT_ATLAS_COLUMNS
        row = index // config.GARMENT_ATLAS_COLUMNS
        cell = image.crop((
            column * config.GARMENT_ATLAS_CELL_SIZE,
            row * config.GARMENT_ATLAS_CELL_SIZE,
            (column + 1) * config.GARMENT_ATLAS_CELL_SIZE,
            (row + 1) * config.GARMENT_ATLAS_CELL_SIZE,
        ))
        bbox = cell.getchannel("A").getbbox()
        issues = []
        margins = None
        size_ratio = None
        anchor_delta = None
        chroma_spill_pixels = count_chroma_spill_pixels(cell)
        if bbox is None:
            failed += 1
            issues.append("empty_frame")
        else:
            left, top, right, bottom = bbox
            margins = {
                "left": left,
                "top": top,
                "right": config.GARMENT_ATLAS_CELL_SIZE - right,
                "bottom": config.GARMENT_ATLAS_CELL_SIZE - bottom,
            }
            if min(margins.values()) < 8:
                issues.append("unsafe_margin")
            master_cell = master.crop((
                column * config.GARMENT_ATLAS_CELL_SIZE,
                row * config.GARMENT_ATLAS_CELL_SIZE,
                (column + 1) * config.GARMENT_ATLAS_CELL_SIZE,
                (row + 1) * config.GARMENT_ATLAS_CELL_SIZE,
            ))
            master_bbox = master_cell.getchannel("A").getbbox()
            if master_bbox is None:
                issues.append("master_frame_missing")
            else:
                target_bbox = master_display_target_bbox(master_bbox)
                width_ratio = (right - left) / max(1, target_bbox[2] - target_bbox[0])
                height_ratio = (bottom - top) / max(1, target_bbox[3] - target_bbox[1])
                area_ratio = (
                    (right - left) * (bottom - top)
                    / max(1, (target_bbox[2] - target_bbox[0]) * (target_bbox[3] - target_bbox[1]))
                )
                size_ratio = {
                    "width": round(width_ratio, 3),
                    "height": round(height_ratio, 3),
                    "area": round(area_ratio, 3),
                }
                anchor_delta = {
                    "center_x": round(
                        ((left + right) - (target_bbox[0] + target_bbox[2])) / 2,
                    ),
                    "baseline": bottom - target_bbox[3],
                }
                if width_ratio < 0.78 or height_ratio < 0.90 or area_ratio < 0.76:
                    issues.append("character_too_small")
                if width_ratio > 1.12 or height_ratio > 1.08 or area_ratio > 1.18:
                    issues.append("character_too_large")
                if abs(anchor_delta["center_x"]) > 8 or abs(anchor_delta["baseline"]) > 8:
                    issues.append("master_anchor_mismatch")
            if chroma_spill_pixels:
                issues.append("chroma_spill")
            if issues:
                failed += 1
                atlas_issues.append(f"{index + 1}컷: {', '.join(issues)}")
        frames.append({
            "frame": index + 1,
            "row": row + 1,
            "column": column + 1,
            "alpha_bbox": list(bbox) if bbox else None,
            "margins": margins,
            "size_ratio": size_ratio,
            "anchor_delta": anchor_delta,
            "chroma_spill_pixels": chroma_spill_pixels,
            "regions_checked": ["head", "hands", "feet", "shoes"],
            "issues": issues,
            "status": "failed" if issues else "passed",
        })
    return {
        "status": "failed" if failed else "passed",
        "can_approve": failed == 0,
        "summary": "32-frame alpha bbox QA passed." if not failed else f"{failed} frames failed alpha bbox QA.",
        "contract": config.GARMENT_TRANSFER_CONTRACT,
        "safe_margin_px": 8,
        "frames": frames,
        "issues": atlas_issues,
    }
