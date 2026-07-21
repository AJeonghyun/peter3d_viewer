"""OpenAI image-generation calls for sprite sheets and capture quality review."""

import base64
import json
import os
from typing import Callable, Optional

import httpx
from fastapi import HTTPException

from backend import config
from backend.capture import default_capture_quality, normalize_capture_quality
from backend.media import image_to_png_bytes
from backend.sprite_pixels import (
    frame_reference_for_ai,
    master_frame_reference_for_ai,
    master_reference_for_ai,
    normalize_master_locked_atlas,
    normalize_master_locked_frame,
    validate_showcase_sprite_png,
)


def openai_error_detail(response: httpx.Response) -> str:
    try:
        message = response.json().get("error", {}).get("message")
    except (json.JSONDecodeError, AttributeError, TypeError):
        message = None
    if response.status_code == 429:
        return "OpenAI 이미지 생성 한도에 도달했습니다. 잠시 후 다시 시도해주세요."
    if response.status_code in (401, 403):
        return "OpenAI API 인증을 확인해주세요."
    if isinstance(message, str) and message.strip():
        return f"OpenAI 이미지 생성 실패: {message.strip()[:240]}"
    return f"OpenAI 이미지 생성 실패 ({response.status_code})"


def response_output_text(payload: dict) -> str:
    for item in payload.get("output") or []:
        if item.get("type") != "message":
            continue
        for content in item.get("content") or []:
            if content.get("type") == "output_text" and isinstance(content.get("text"), str):
                return content["text"]
    raise ValueError("Responses API 응답에서 텍스트를 찾지 못했습니다")


async def request_showcase_sprite(
    reference: bytes,
    content_type: str,
    filename: str,
    *,
    correction: str = "",
) -> bytes:
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key.startswith("sk-"):
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY가 설정되지 않았습니다")

    files = [("image[]", (filename, reference, content_type))]
    if config.SHOWCASE_MASTER_PATH.is_file():
        files.append((
            "image[]",
            ("fixed-peter-master.png", config.SHOWCASE_MASTER_PATH.read_bytes(), "image/png"),
        ))
    prompt = config.SHOWCASE_SPRITE_PROMPT
    if correction:
        prompt += (
            "\n\nCORRECTION REQUIRED AFTER THE PREVIOUS QA REVIEW:\n"
            + correction[:1800]
            + "\nFix these issues while preserving every requirement above."
        )
    data = {
        "model": config.OPENAI_IMAGE_MODEL,
        "prompt": prompt,
        "size": config.SHOWCASE_SPRITE_SIZE,
        "quality": config.OPENAI_IMAGE_QUALITY,
        "output_format": "png",
        "background": "opaque",
        "n": "1",
    }
    if config.OPENAI_IMAGE_MODEL == "gpt-image-1":
        data["input_fidelity"] = config.OPENAI_IMAGE_INPUT_FIDELITY
    try:
        timeout = httpx.Timeout(150.0, connect=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                config.OPENAI_IMAGE_API_URL,
                headers={"Authorization": f"Bearer {api_key}"},
                data=data,
                files=files,
            )
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=504,
            detail="AI 캐릭터 생성 시간이 초과되었습니다. 다시 시도해주세요.",
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail="OpenAI 이미지 생성 서버에 연결하지 못했습니다.",
        ) from exc

    if response.status_code >= 400:
        raise HTTPException(
            status_code=response.status_code if response.status_code < 500 else 502,
            detail=openai_error_detail(response),
        )
    try:
        encoded = response.json()["data"][0]["b64_json"]
        sprite = base64.b64decode(encoded, validate=True)
    except (KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=502, detail="AI 스프라이트 응답을 읽지 못했습니다") from exc
    if len(sprite) > config.MAX_SPRITE_BYTES:
        raise HTTPException(status_code=502, detail="AI 스프라이트 파일이 너무 큽니다")
    try:
        validate_showcase_sprite_png(sprite)
    except ValueError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"AI 스프라이트 규격이 올바르지 않습니다: {exc}",
        ) from exc
    return sprite


def _raise_for_image_edit_error(response: httpx.Response) -> None:
    detail = openai_error_detail(response)
    if response.status_code == 429 and any(
        marker in detail.lower()
        for marker in ("insufficient_quota", "billing", "hard limit", "quota exceeded")
    ):
        raise HTTPException(status_code=402, detail=detail)
    if response.status_code >= 500:
        raise HTTPException(
            status_code=503,
            detail=f"OpenAI 이미지 생성 서버의 일시 오류입니다: {detail}",
        )
    raise HTTPException(status_code=response.status_code, detail=detail)


async def request_master_locked_garment_atlas(
    student_reference: bytes,
    *,
    filename: str = "student-peter.png",
    correction: str = "",
    on_progress: Optional[Callable[[str], None]] = None,
) -> bytes:
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key.startswith("sk-"):
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY가 설정되지 않았습니다")
    prompt = config.GARMENT_MASTER_EDIT_PROMPT
    if correction:
        prompt += (
            "\n\nTHE PREVIOUS CANDIDATE FAILED QA. Regenerate from the fixed master and fix "
            "these exact issues without changing any other master property:\n"
            + correction
        )
    files = [
        (
            "image[]",
            ("fixed-peter-master-5x5.png", master_reference_for_ai(), "image/png"),
        ),
        ("image[]", (filename, student_reference, "image/png")),
    ]
    data = {
        "model": config.OPENAI_IMAGE_MODEL,
        "prompt": prompt,
        "size": config.GARMENT_AI_IMAGE_SIZE,
        "quality": config.OPENAI_IMAGE_QUALITY,
        "output_format": "png",
        "background": "opaque",
        "n": "1",
    }
    if config.OPENAI_IMAGE_MODEL == "gpt-image-1":
        data["input_fidelity"] = config.OPENAI_IMAGE_INPUT_FIDELITY
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(config.GARMENT_IMAGE_TIMEOUT_SECONDS, connect=10.0),
        ) as client:
            response = await client.post(
                config.OPENAI_IMAGE_API_URL,
                headers={"Authorization": f"Bearer {api_key}"},
                data=data,
                files=files,
            )
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=504,
            detail="AI 25컷 생성 시간이 초과되었습니다. 다시 시도해주세요.",
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail="OpenAI 이미지 생성 서버에 연결하지 못했습니다.",
        ) from exc
    if response.status_code >= 400:
        _raise_for_image_edit_error(response)
    try:
        if on_progress:
            on_progress("composing")
        encoded = response.json()["data"][0]["b64_json"]
        generated = base64.b64decode(encoded, validate=True)
        atlas = normalize_master_locked_atlas(generated)
        atlas_bytes = image_to_png_bytes(atlas)
    except (
        KeyError,
        IndexError,
        TypeError,
        ValueError,
        json.JSONDecodeError,
        base64.binascii.Error,
    ) as exc:
        raise HTTPException(status_code=502, detail=f"AI 25컷 응답을 처리하지 못했습니다: {exc}") from exc
    if len(atlas_bytes) > config.MAX_SPRITE_BYTES:
        raise HTTPException(status_code=502, detail="AI 25컷 파일이 너무 큽니다")
    return atlas_bytes


async def request_master_locked_garment_frame(
    student_reference: bytes,
    current_atlas: bytes,
    frame: int,
    *,
    filename: str = "student-peter.png",
    correction: str = "",
    on_progress: Optional[Callable[[str], None]] = None,
) -> bytes:
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key.startswith("sk-"):
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY가 설정되지 않았습니다")
    try:
        fixed_frame = master_frame_reference_for_ai(frame)
        current_frame = frame_reference_for_ai(current_atlas, frame)
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    prompt = config.GARMENT_FRAME_EDIT_PROMPT + f"\n\nTARGET FRAME NUMBER: {frame} of 25."
    if correction:
        prompt += (
            "\nREPORTED QA DEFECTS TO FIX IN THIS FRAME:\n"
            + correction
        )
    files = [
        ("image[]", (f"fixed-peter-frame-{frame}.png", fixed_frame, "image/png")),
        ("image[]", (filename, student_reference, "image/png")),
        ("image[]", (f"current-frame-{frame}.png", current_frame, "image/png")),
    ]
    data = {
        "model": config.OPENAI_IMAGE_MODEL,
        "prompt": prompt,
        "size": config.GARMENT_AI_FRAME_IMAGE_SIZE,
        "quality": config.OPENAI_IMAGE_QUALITY,
        "output_format": "png",
        "background": "opaque",
        "n": "1",
    }
    if config.OPENAI_IMAGE_MODEL == "gpt-image-1":
        data["input_fidelity"] = config.OPENAI_IMAGE_INPUT_FIDELITY
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(config.GARMENT_IMAGE_TIMEOUT_SECONDS, connect=10.0),
        ) as client:
            response = await client.post(
                config.OPENAI_IMAGE_API_URL,
                headers={"Authorization": f"Bearer {api_key}"},
                data=data,
                files=files,
            )
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=504,
            detail=f"AI {frame}컷 재생성 시간이 초과되었습니다. 다시 시도합니다.",
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail="OpenAI 이미지 생성 서버에 연결하지 못했습니다.",
        ) from exc
    if response.status_code >= 400:
        _raise_for_image_edit_error(response)
    try:
        if on_progress:
            on_progress("composing")
        encoded = response.json()["data"][0]["b64_json"]
        generated = base64.b64decode(encoded, validate=True)
        replacement = normalize_master_locked_frame(generated, frame)
        replacement_bytes = image_to_png_bytes(replacement)
    except (
        KeyError,
        IndexError,
        TypeError,
        ValueError,
        json.JSONDecodeError,
        base64.binascii.Error,
    ) as exc:
        raise HTTPException(
            status_code=502,
            detail=f"AI {frame}컷 응답을 처리하지 못했습니다: {exc}",
        ) from exc
    if len(replacement_bytes) > config.MAX_SPRITE_BYTES:
        raise HTTPException(status_code=502, detail=f"AI {frame}컷 파일이 너무 큽니다")
    return replacement_bytes


async def request_capture_quality_review(reference: bytes, content_type: str) -> dict:
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key.startswith("sk-"):
        return default_capture_quality()
    schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "status": {"type": "string", "enum": ["passed", "warning", "failed"]},
            "can_process": {"type": "boolean"},
            "summary": {"type": "string"},
            "page_corners": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "top_left": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2},
                    "top_right": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2},
                    "bottom_right": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2},
                    "bottom_left": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2},
                },
                "required": ["top_left", "top_right", "bottom_right", "bottom_left"],
            },
            "checks": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "blur": {"type": "string"},
                    "glare": {"type": "string"},
                    "shadow": {"type": "string"},
                    "crop": {"type": "string"},
                    "perspective": {"type": "string"},
                },
                "required": ["blur", "glare", "shadow", "crop", "perspective"],
            },
            "issues": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["status", "can_process", "summary", "page_corners", "checks", "issues"],
    }
    body = {
        "model": config.OPENAI_SPRITE_QA_MODEL,
        "store": False,
        "input": [{
            "role": "user",
            "content": [
                {
                    "type": "input_text",
                    "text": (
                        "Review this phone photo of the printed Peter garment worksheet. "
                        "Return normalized page corners in reading order, each x/y between 0 and 1. "
                        "Assess blur, glare, shadow, crop, and perspective. Set can_process false only "
                        "when the four garment regions cannot be extracted from the corrected page."
                    ),
                },
                {
                    "type": "input_image",
                    "image_url": f"data:{content_type};base64,{base64.b64encode(reference).decode('ascii')}",
                    "detail": "high",
                },
            ],
        }],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "peter_capture_quality",
                "strict": True,
                "schema": schema,
            },
        },
        "max_output_tokens": 1000,
    }
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(config.OPENAI_QA_TIMEOUT_SECONDS, connect=10.0),
        ) as client:
            response = await client.post(
                config.OPENAI_RESPONSES_API_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
        if response.status_code >= 400:
            fallback = default_capture_quality()
            fallback["summary"] = openai_error_detail(response)
            return fallback
        return normalize_capture_quality(json.loads(response_output_text(response.json())))
    except (httpx.HTTPError, json.JSONDecodeError, TypeError, ValueError) as exc:
        fallback = default_capture_quality()
        fallback["summary"] = f"Capture QA failed: {str(exc)[:160]}"
        return fallback
