"""OpenAI Responses-based QA reviews combined with deterministic pixel checks."""

import base64
import json
import os
from typing import Any, Optional

import httpx

from backend import config
from backend.ai_generation import openai_error_detail, response_output_text
from backend.db import loads_json
from backend.sprite_pixels import (
    analyze_garment_atlas_pixels,
    analyze_showcase_sprite_pixels,
)


async def request_showcase_sprite_ai_review(sprite: bytes, deterministic: dict) -> dict:
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key.startswith("sk-"):
        return {
            "status": "unavailable",
            "summary": "AI 시각 검수를 실행할 API 키가 없습니다.",
            "issues": [],
            "frames": [],
            "model": config.OPENAI_SPRITE_QA_MODEL,
        }
    schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "status": {"type": "string", "enum": ["passed", "warning", "failed"]},
            "summary": {"type": "string"},
            "issues": {"type": "array", "items": {"type": "string"}},
            "frames": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "frame": {"type": "integer", "minimum": 1, "maximum": 12},
                        "severity": {
                            "type": "string",
                            "enum": ["warning", "failed"],
                        },
                        "issue": {"type": "string"},
                    },
                    "required": ["frame", "severity", "issue"],
                },
            },
        },
        "required": ["status", "summary", "issues", "frames"],
    }
    prompt = (
        config.SHOWCASE_SPRITE_QA_PROMPT
        + "\n\n픽셀 검사 결과:\n"
        + json.dumps(
            {
                "status": deterministic.get("status"),
                "summary": deterministic.get("summary"),
                "frames": [
                    {
                        "frame": frame.get("frame"),
                        "margins": frame.get("margins"),
                        "issues": frame.get("issues"),
                    }
                    for frame in deterministic.get("frames", [])
                ],
            },
            ensure_ascii=False,
        )
    )
    content = [
        {"type": "input_text", "text": prompt},
        {
            "type": "input_image",
            "image_url": f"data:image/png;base64,{base64.b64encode(sprite).decode('ascii')}",
            "detail": "high",
        },
    ]
    if config.SHOWCASE_MASTER_PATH.is_file():
        content.append({
            "type": "input_image",
            "image_url": (
                "data:image/png;base64,"
                + base64.b64encode(config.SHOWCASE_MASTER_PATH.read_bytes()).decode("ascii")
            ),
            "detail": "high",
        })
    body = {
        "model": config.OPENAI_SPRITE_QA_MODEL,
        "store": False,
        "input": [{
            "role": "user",
            "content": content,
        }],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "sprite_clipping_review",
                "strict": True,
                "schema": schema,
            },
        },
        "max_output_tokens": 1200,
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
            return {
                "status": "unavailable",
                "summary": openai_error_detail(response),
                "issues": [],
                "frames": [],
                "model": config.OPENAI_SPRITE_QA_MODEL,
            }
        review = json.loads(response_output_text(response.json()))
        review["model"] = config.OPENAI_SPRITE_QA_MODEL
        return review
    except (httpx.HTTPError, json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        return {
            "status": "unavailable",
            "summary": f"AI 시각 검수를 완료하지 못했습니다: {str(exc)[:160]}",
            "issues": [],
            "frames": [],
            "model": config.OPENAI_SPRITE_QA_MODEL,
        }


async def inspect_showcase_sprite_quality(sprite: bytes) -> dict:
    deterministic = analyze_showcase_sprite_pixels(sprite)
    ai_review = await request_showcase_sprite_ai_review(sprite, deterministic)
    statuses = {deterministic.get("status"), ai_review.get("status")}
    if "failed" in statuses:
        status = "failed"
    elif "warning" in statuses or "unavailable" in statuses:
        status = "warning"
    else:
        status = "passed"
    can_approve = deterministic.get("status") != "failed" and ai_review.get("status") != "failed"
    return {
        "status": status,
        "can_approve": can_approve,
        "summary": (
            "잘림 위험이 감지되어 재생성이 필요합니다."
            if not can_approve
            else "자동 검수를 통과했습니다."
            if status == "passed"
            else "자동 검수 일부를 완료하지 못해 관리자 확인이 필요합니다."
        ),
        "deterministic": deterministic,
        "ai": ai_review,
    }


async def request_garment_atlas_ai_review(
    atlas: bytes,
    deterministic: dict,
    student_reference: Optional[bytes] = None,
) -> dict:
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key.startswith("sk-"):
        return {
            "status": "unavailable",
            "summary": "AI animation review unavailable.",
            "issues": [],
            "frames": [],
            "model": config.OPENAI_SPRITE_QA_MODEL,
        }
    schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "status": {"type": "string", "enum": ["passed", "warning", "failed"]},
            "summary": {"type": "string"},
            "issues": {"type": "array", "items": {"type": "string"}},
            "frames": {
                "type": "array",
                "maxItems": config.GARMENT_FRAME_COUNT,
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "frame": {
                            "type": "integer",
                            "minimum": 1,
                            "maximum": config.GARMENT_FRAME_COUNT,
                        },
                        "severity": {"type": "string", "enum": ["warning", "failed"]},
                        "issue": {"type": "string"},
                    },
                    "required": ["frame", "severity", "issue"],
                },
            },
        },
        "required": ["status", "summary", "issues", "frames"],
    }
    review_content = [
        {
            "type": "input_text",
            "text": (
                "The images are: (1) candidate 32-frame atlas, (2) immutable fixed master, "
                "(3, when supplied) corrected student full-body design. Review all 32 cells. "
                "The atlas is an 8-column by 4-row grid. Frames 1-25 keep the old master "
                "order; frames 26-32 are idle-a, idle-b, wave, listen-front, listen-rear, "
                "listen-side, and back. "
                "Fail any frame where the pose, direction, face, hair, beard, skin, hands, "
                "body proportions, character size, baseline, or visual style drifts from the "
                "corresponding master cell. Fail clipping or missing/extra body parts. "
                "Also fail garment semantics: upper and lower designs must stay clearly "
                "separate, no garment texture may spill onto skin/hair/beard/hands/legs, and "
                "left/right footwear must remain distinct and on the correct foot. The student "
                "image controls clothing only. Return the summary and issues in Korean.\n\n"
                + json.dumps({"deterministic": deterministic}, ensure_ascii=False)[:6000]
            ),
        },
        {
            "type": "input_image",
            "image_url": f"data:image/png;base64,{base64.b64encode(atlas).decode('ascii')}",
            "detail": "high",
        },
        {
            "type": "input_image",
            "image_url": (
                "data:image/png;base64,"
                + base64.b64encode(config.SHOWCASE_MASTER_PATH.read_bytes()).decode("ascii")
            ),
            "detail": "high",
        },
    ]
    if student_reference:
        review_content.append({
            "type": "input_image",
            "image_url": f"data:image/png;base64,{base64.b64encode(student_reference).decode('ascii')}",
            "detail": "high",
        })
    body = {
        "model": config.OPENAI_SPRITE_QA_MODEL,
        "store": False,
        "input": [{
            "role": "user",
            "content": review_content,
        }],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "peter_garment_animation_review",
                "strict": True,
                "schema": schema,
            },
        },
        "max_output_tokens": 1200,
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
            return {
                "status": "unavailable",
                "summary": openai_error_detail(response),
                "issues": [],
                "frames": [],
                "model": config.OPENAI_SPRITE_QA_MODEL,
            }
        review = json.loads(response_output_text(response.json()))
        review["model"] = config.OPENAI_SPRITE_QA_MODEL
        return review
    except (httpx.HTTPError, json.JSONDecodeError, TypeError, ValueError) as exc:
        return {
            "status": "unavailable",
            "summary": f"AI animation review failed: {str(exc)[:160]}",
            "issues": [],
            "frames": [],
            "model": config.OPENAI_SPRITE_QA_MODEL,
        }


async def inspect_garment_atlas_quality(
    atlas: bytes,
    student_reference: Optional[bytes] = None,
) -> dict:
    deterministic = analyze_garment_atlas_pixels(atlas)
    ai = await request_garment_atlas_ai_review(atlas, deterministic, student_reference)
    statuses = {deterministic.get("status"), ai.get("status")}
    if "failed" in statuses:
        status = "failed"
    elif "warning" in statuses or "unavailable" in statuses:
        status = "warning"
    else:
        status = "passed"
    return {
        "status": status,
        "can_approve": deterministic.get("status") != "failed" and ai.get("status") != "failed",
        "summary": "Garment atlas QA passed." if status == "passed" else "Garment atlas needs review.",
        "deterministic": deterministic,
        "ai": ai,
    }


def garment_frame_retry_instruction(value: Any, frame: int) -> str:
    qa = loads_json(value) if isinstance(value, str) else value
    if not isinstance(qa, dict):
        return ""
    notes: list[str] = []
    deterministic = qa.get("deterministic")
    if isinstance(deterministic, dict):
        for candidate in deterministic.get("frames") or []:
            if (
                isinstance(candidate, dict)
                and candidate.get("frame") == frame
                and candidate.get("issues")
            ):
                notes.extend(str(issue) for issue in candidate["issues"])
    ai = qa.get("ai")
    if isinstance(ai, dict):
        for candidate in ai.get("frames") or []:
            if (
                isinstance(candidate, dict)
                and candidate.get("frame") == frame
                and candidate.get("issue")
            ):
                notes.append(str(candidate["issue"]))
    return " · ".join(dict.fromkeys(notes))[:900]


def garment_problem_frames(value: Any) -> list[int]:
    qa = loads_json(value) if isinstance(value, str) else value
    if not isinstance(qa, dict):
        return []
    frames: set[int] = set()
    frame_count = config.GARMENT_FRAME_COUNT
    deterministic = qa.get("deterministic")
    if isinstance(deterministic, dict):
        for candidate in deterministic.get("frames") or []:
            if not isinstance(candidate, dict):
                continue
            frame = candidate.get("frame")
            if (
                isinstance(frame, int)
                and 1 <= frame <= frame_count
                and (candidate.get("status") == "failed" or candidate.get("issues"))
            ):
                frames.add(frame)
    ai = qa.get("ai")
    if isinstance(ai, dict):
        for candidate in ai.get("frames") or []:
            if not isinstance(candidate, dict):
                continue
            frame = candidate.get("frame")
            if (
                isinstance(frame, int)
                and 1 <= frame <= frame_count
                and candidate.get("severity") in {"warning", "failed"}
            ):
                frames.add(frame)
    return sorted(frames)


def garment_retry_instruction(value: Any) -> str:
    qa = loads_json(value) if isinstance(value, str) else value
    if not isinstance(qa, dict):
        return ""
    notes: list[str] = []
    deterministic = qa.get("deterministic")
    if isinstance(deterministic, dict):
        for frame in deterministic.get("frames") or []:
            if isinstance(frame, dict) and frame.get("issues"):
                notes.append(f"{frame.get('frame')}컷: {', '.join(map(str, frame['issues']))}")
    ai = qa.get("ai")
    if isinstance(ai, dict):
        notes.extend(str(issue) for issue in (ai.get("issues") or []))
        for frame in ai.get("frames") or []:
            if isinstance(frame, dict) and frame.get("issue"):
                notes.append(f"{frame.get('frame')}컷: {frame['issue']}")
    return "\n".join(notes[:20])[:1800]
