"""Phone-photo capture correction and deterministic garment composition."""

import io
from typing import Any

from fastapi import HTTPException
from PIL import Image, ImageOps

from backend import config
from backend.sprite_pixels import garment_atlas_frame_box, load_garment_master_atlas, median


def default_capture_quality() -> dict:
    return {
        "status": "unavailable",
        "can_process": True,
        "summary": "OpenAI Responses QA unavailable; using full-image page corners.",
        "page_corners": {
            "top_left": [0.0, 0.0],
            "top_right": [1.0, 0.0],
            "bottom_right": [1.0, 1.0],
            "bottom_left": [0.0, 1.0],
        },
        "checks": {
            "blur": "unknown",
            "glare": "unknown",
            "shadow": "unknown",
            "crop": "unknown",
            "perspective": "unknown",
        },
        "issues": [],
        "model": config.OPENAI_SPRITE_QA_MODEL,
    }


def _normalized_corner(value: Any, fallback: list[float]) -> list[float]:
    if (
        isinstance(value, list)
        and len(value) == 2
        and all(isinstance(item, (int, float)) for item in value)
    ):
        return [max(0.0, min(1.0, float(value[0]))), max(0.0, min(1.0, float(value[1])))]
    return fallback


def normalize_capture_quality(payload: dict) -> dict:
    fallback = default_capture_quality()
    corners = payload.get("page_corners") if isinstance(payload.get("page_corners"), dict) else {}
    normalized_corners = {
        "top_left": _normalized_corner(corners.get("top_left"), [0.0, 0.0]),
        "top_right": _normalized_corner(corners.get("top_right"), [1.0, 0.0]),
        "bottom_right": _normalized_corner(corners.get("bottom_right"), [1.0, 1.0]),
        "bottom_left": _normalized_corner(corners.get("bottom_left"), [0.0, 1.0]),
    }
    checks = payload.get("checks") if isinstance(payload.get("checks"), dict) else {}
    return {
        "status": payload.get("status") if payload.get("status") in {"passed", "warning", "failed"} else "warning",
        "can_process": bool(payload.get("can_process", False)),
        "summary": str(payload.get("summary") or fallback["summary"])[:500],
        "page_corners": normalized_corners,
        "checks": {
            "blur": str(checks.get("blur", "unknown"))[:80],
            "glare": str(checks.get("glare", "unknown"))[:80],
            "shadow": str(checks.get("shadow", "unknown"))[:80],
            "crop": str(checks.get("crop", "unknown"))[:80],
            "perspective": str(checks.get("perspective", "unknown"))[:80],
        },
        "issues": [str(issue)[:160] for issue in payload.get("issues", [])[:12]]
        if isinstance(payload.get("issues"), list) else [],
        "model": config.OPENAI_SPRITE_QA_MODEL,
    }


def correct_capture_image(reference: bytes, quality: dict) -> Image.Image:
    source = Image.open(io.BytesIO(reference)).convert("RGB")
    source.load()
    corners = quality.get("page_corners") or default_capture_quality()["page_corners"]
    width, height = source.size
    quad: list[float] = []
    # Pillow QUAD expects NW, SW, SE, NE. Keeping this order explicit prevents
    # a valid phone photo from being rotated or folded during rectification.
    for key in ("top_left", "bottom_left", "bottom_right", "top_right"):
        x, y = corners[key]
        quad.extend([x * width, y * height])
    corrected = source.transform(
        config.GARMENT_TEMPLATE_SIZE,
        Image.Transform.QUAD,
        quad,
        Image.Resampling.BICUBIC,
    )
    return neutral_paper_white_balance(corrected)


def neutral_paper_white_balance(image: Image.Image) -> Image.Image:
    rgb = image.convert("RGB")
    width, height = rgb.size
    border = max(8, round(min(width, height) * 0.025))
    samples = []
    pixels = rgb.load()
    for x in range(0, width, 8):
        for y in (*range(0, border, 4), *range(height - border, height, 4)):
            samples.append(pixels[x, y])
    for y in range(border, height - border, 8):
        for x in (*range(0, border, 4), *range(width - border, width, 4)):
            samples.append(pixels[x, y])
    if not samples:
        return rgb
    channels = [max(1, median([sample[index] for sample in samples])) for index in range(3)]
    target = max(channels)
    balanced = Image.new("RGB", rgb.size)
    out = balanced.load()
    for y in range(height):
        for x in range(width):
            pixel = pixels[x, y]
            out[x, y] = tuple(max(0, min(255, round(pixel[index] * target / channels[index]))) for index in range(3))
    return ImageOps.autocontrast(balanced, cutoff=0.5)


def extract_garment_parts(corrected: Image.Image) -> dict[str, Image.Image]:
    parts: dict[str, Image.Image] = {}
    width, height = corrected.size
    for part, crop in config.GARMENT_PART_CROPS.items():
        left, top, right, bottom = crop
        box = (
            round(left * width),
            round(top * height),
            round(right * width),
            round(bottom * height),
        )
        parts[part] = corrected.crop(box).convert("RGB")
    return parts


def is_master_garment_pixel(pixel: tuple[int, int, int, int]) -> float:
    red, green, blue, alpha = pixel
    if alpha < 16:
        return 0.0
    minimum = min(red, green, blue)
    spread = max(red, green, blue) - minimum
    brightness = max(0.0, min(1.0, (minimum - 205) / 38))
    neutrality = max(0.0, min(1.0, 1 - spread / 34))
    return brightness * neutrality * (alpha / 255)


def _texture_pixel(texture: Image.Image, x: int, y: int, bbox: tuple[int, int, int, int]) -> tuple[int, int, int]:
    tx = round((x - bbox[0]) * (texture.width - 1) / max(1, bbox[2] - bbox[0] - 1))
    ty = round((y - bbox[1]) * (texture.height - 1) / max(1, bbox[3] - bbox[1] - 1))
    return texture.getpixel((max(0, min(texture.width - 1, tx)), max(0, min(texture.height - 1, ty))))[:3]


def _garment_split_y(cell: Image.Image, bbox: tuple[int, int, int, int]) -> int:
    return bbox[1] + round((bbox[3] - bbox[1]) * 0.58)


def apply_garment_parts_to_cell(cell: Image.Image, parts: dict[str, Image.Image]) -> Image.Image:
    source = cell.convert("RGBA")
    result = source.copy()
    alpha_bbox = source.getchannel("A").getbbox()
    if alpha_bbox is None:
        return result
    split_y = _garment_split_y(source, alpha_bbox)
    shoe_top = alpha_bbox[1] + round((alpha_bbox[3] - alpha_bbox[1]) * 0.78)
    mid_x = alpha_bbox[0] + round((alpha_bbox[2] - alpha_bbox[0]) * 0.5)
    source_pixels = source.load()
    result_pixels = result.load()
    for y in range(source.height):
        for x in range(source.width):
            base = source_pixels[x, y]
            if base[3] < 16:
                continue
            strength = is_master_garment_pixel(base)
            part = None
            if y >= shoe_top and alpha_bbox[0] <= x <= alpha_bbox[2]:
                part = "left_shoe" if x < mid_x else "right_shoe"
                strength = max(strength, 0.88)
            elif strength > 0:
                part = "upper" if y < split_y else "lower"
            if part is None or strength <= 0:
                continue
            texture_pixel = _texture_pixel(parts[part], x, y, alpha_bbox)
            luma = base[0] * 0.2126 + base[1] * 0.7152 + base[2] * 0.0722
            shade = max(0.65, min(1.10, luma / 238))
            themed = tuple(max(0, min(255, round(channel * shade))) for channel in texture_pixel)
            alpha = max(0.0, min(1.0, strength))
            result_pixels[x, y] = (
                round(base[0] * (1 - alpha) + themed[0] * alpha),
                round(base[1] * (1 - alpha) + themed[1] * alpha),
                round(base[2] * (1 - alpha) + themed[2] * alpha),
                base[3],
            )
    return result


def normalize_garment_atlas_cell(cell: Image.Image, *, margin: int = 18) -> Image.Image:
    rgba = cell.convert("RGBA")
    bbox = rgba.getchannel("A").getbbox()
    if bbox is None:
        return Image.new(
            "RGBA", (config.GARMENT_ATLAS_CELL_SIZE, config.GARMENT_ATLAS_CELL_SIZE), (0, 0, 0, 0)
        )
    trimmed = rgba.crop(bbox)
    max_size = config.GARMENT_ATLAS_CELL_SIZE - margin * 2
    scale = min(max_size / max(1, trimmed.width), max_size / max(1, trimmed.height), 1.0)
    resized = trimmed.resize(
        (max(1, round(trimmed.width * scale)), max(1, round(trimmed.height * scale))),
        Image.Resampling.LANCZOS,
    )
    output = Image.new(
        "RGBA", (config.GARMENT_ATLAS_CELL_SIZE, config.GARMENT_ATLAS_CELL_SIZE), (0, 0, 0, 0)
    )
    x = round((config.GARMENT_ATLAS_CELL_SIZE - resized.width) / 2)
    y = round((config.GARMENT_ATLAS_CELL_SIZE - resized.height) / 2)
    output.alpha_composite(resized, (x, y))
    return output


def compose_garment_atlas(parts: dict[str, Image.Image]) -> Image.Image:
    try:
        master = load_garment_master_atlas()
    except HTTPException:
        raise
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=500, detail="고정 Peter 마스터 스프라이트를 찾지 못했습니다") from exc
    atlas = Image.new(
        "RGBA", (config.GARMENT_ATLAS_WIDTH, config.GARMENT_ATLAS_HEIGHT), (0, 0, 0, 0)
    )
    for frame in range(1, config.GARMENT_FRAME_COUNT + 1):
        left, top, right, bottom = garment_atlas_frame_box(frame)
        cell = master.crop((left, top, right, bottom))
        themed = apply_garment_parts_to_cell(cell, parts)
        themed = normalize_garment_atlas_cell(themed)
        atlas.alpha_composite(themed, (left, top))
    return atlas
