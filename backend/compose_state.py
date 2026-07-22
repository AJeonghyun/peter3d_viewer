"""Shared state helpers for the 32-frame compose workflow."""

import json
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException

from backend import config
from backend.db import connect_db, loads_json, now_iso, row_dict
from backend.serializers import (
    get_sprite_version_or_404,
    get_team_or_404,
    public_sprite_version,
    public_team,
)


def update_showcase_sprite_status(
    team_id: int,
    status: str,
    *,
    url: Optional[str] = None,
    error: Optional[str] = None,
    quality: Optional[dict] = None,
) -> dict:
    timestamp = now_iso()
    with connect_db() as db:
        get_team_or_404(db, team_id)
        if url is None:
            db.execute(
                """
                UPDATE teams
                SET showcase_sprite_status = ?, showcase_sprite_error = ?,
                    showcase_sprite_updated_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (status, error, timestamp, timestamp, team_id),
            )
        else:
            db.execute(
                """
                UPDATE teams
                SET showcase_sprite_url = ?, showcase_sprite_status = ?,
                    showcase_sprite_error = ?, showcase_sprite_model = ?,
                    showcase_sprite_quality_status = ?,
                    showcase_sprite_quality_json = ?,
                    showcase_sprite_qa_model = ?,
                    showcase_sprite_updated_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    url,
                    status,
                    error,
                    config.OPENAI_IMAGE_MODEL,
                    quality.get("status", "unchecked") if quality else "unchecked",
                    json.dumps(quality, ensure_ascii=False) if quality else None,
                    config.OPENAI_SPRITE_QA_MODEL if quality else None,
                    timestamp,
                    timestamp,
                    team_id,
                ),
            )
        return public_team(get_team_or_404(db, team_id))


def ensure_compose_not_active(team: dict) -> None:
    if team.get("showcase_sprite_status") in config.COMPOSE_ACTIVE_TEAM_STATUSES:
        raise HTTPException(
            status_code=409,
            detail="32컷 생성이 진행 중입니다. 완료된 뒤 새 사진을 등록해주세요.",
        )


def seconds_since(timestamp: Any) -> float:
    if not timestamp:
        return float("inf")
    try:
        parsed = datetime.fromisoformat(str(timestamp).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return max(0.0, (datetime.now(timezone.utc) - parsed).total_seconds())
    except (TypeError, ValueError):
        return float("inf")


def frame_patch_metadata(version: dict) -> Optional[dict]:
    parts = version.get("parts")
    if not isinstance(parts, dict):
        parts = loads_json(version.get("parts_json"))
    if not isinstance(parts, dict):
        return None
    patch = parts.get("frame_patch")
    return patch if isinstance(patch, dict) else None


def compose_next_action(version: dict) -> str:
    status = str(version.get("status") or "")
    age = seconds_since(version.get("updated_at"))
    patch = frame_patch_metadata(version)
    if status == "queued":
        return "patch" if patch else "generate"
    if status in {"generating", "composing"}:
        if age < config.COMPOSE_GENERATION_LEASE_SECONDS:
            return "wait"
        return "patch" if patch else "generate"
    if status == "generated":
        return "review"
    if status in {"reviewing", "saving"}:
        return "wait" if age < config.COMPOSE_REVIEW_LEASE_SECONDS else "review"
    if status in {"review", "ready", "approved"}:
        return "complete"
    if status == "failed":
        return "failed"
    return "generate"


def compose_response(
    db: Any,
    team_id: int,
    version_id: str,
    *,
    next_action: Optional[str] = None,
    retry_after_seconds: Optional[int] = None,
) -> dict:
    team = public_team(get_team_or_404(db, team_id))
    version = public_sprite_version(get_sprite_version_or_404(db, team_id, version_id))
    action = next_action or compose_next_action(version)
    payload = {
        "team": team,
        "version": version,
        "status": version.get("status") or team.get("showcase_sprite_status"),
        "next_action": action,
        "contract": config.GARMENT_TRANSFER_CONTRACT,
    }
    if retry_after_seconds is not None:
        payload["retry_after_seconds"] = retry_after_seconds
    if version.get("atlas_url"):
        payload["atlas_url"] = version["atlas_url"]
    if version.get("qa"):
        payload["qa"] = version["qa"]
    patch = frame_patch_metadata(version)
    if patch:
        frames = [
            frame for frame in patch.get("frames", [])
            if isinstance(frame, int)
        ]
        completed = [
            frame for frame in patch.get("completed_frames", [])
            if isinstance(frame, int)
        ]
        payload["frame_patch"] = {
            "frames": frames,
            "completed_frames": completed,
            "remaining_frames": [frame for frame in frames if frame not in completed],
            "source_version_id": patch.get("source_version_id"),
        }
    return payload


def retryable_compose_error(exc: HTTPException) -> bool:
    if exc.status_code in {408, 429, 504}:
        return True
    if exc.status_code == 502:
        return "연결하지 못했습니다" in str(exc.detail)
    if exc.status_code == 503:
        detail = str(exc.detail)
        return "설정되지 않았습니다" not in detail and "연결이 필요합니다" not in detail
    return False


def record_compose_retry(
    team_id: int,
    version_id: str,
    *,
    version_status: str,
    team_status: str,
    detail: str,
) -> dict:
    timestamp = now_iso()
    message = f"{detail[:220]} · 완료될 때까지 자동 재시도합니다."
    with connect_db() as db:
        db.execute(
            """
            UPDATE sprite_versions
            SET status = ?, error = ?, updated_at = ?
            WHERE id = ? AND team_id = ?
            """,
            (version_status, message, timestamp, version_id, team_id),
        )
        db.execute(
            """
            UPDATE teams
            SET showcase_sprite_status = ?, showcase_sprite_error = ?,
                showcase_sprite_updated_at = ?, updated_at = ?
            WHERE id = ? AND showcase_sprite_version_id = ?
            """,
            (team_status, message, timestamp, timestamp, team_id, version_id),
        )
        return compose_response(
            db,
            team_id,
            version_id,
            next_action="retry",
            retry_after_seconds=config.COMPOSE_RETRY_AFTER_SECONDS,
        )


def record_compose_failure(team_id: int, version_id: str, detail: str) -> None:
    timestamp = now_iso()
    with connect_db() as db:
        db.execute(
            """
            UPDATE teams
            SET showcase_sprite_status = 'failed', showcase_sprite_error = ?,
                showcase_sprite_updated_at = ?, updated_at = ?
            WHERE id = ? AND showcase_sprite_version_id = ?
            """,
            (detail[:300], timestamp, timestamp, team_id, version_id),
        )
        db.execute(
            """
            UPDATE sprite_versions
            SET status = 'failed', error = ?, updated_at = ?
            WHERE id = ? AND team_id = ?
            """,
            (detail[:300], timestamp, version_id, team_id),
        )


def current_compose_version(team_id: int) -> tuple[dict, dict]:
    with connect_db() as db:
        team = row_dict(get_team_or_404(db, team_id))
        version_id = team.get("showcase_sprite_version_id")
        if not version_id:
            raise HTTPException(status_code=409, detail="먼저 캡처를 처리해주세요")
        version = row_dict(get_sprite_version_or_404(db, team_id, version_id))
    if not version.get("corrected_url"):
        raise HTTPException(status_code=409, detail="보정된 학생 디자인 이미지가 없습니다")
    return team, version
