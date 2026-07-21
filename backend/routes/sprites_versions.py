"""Sprite version history, restore, and approval endpoints."""

import json
from typing import Optional

from fastapi import APIRouter, HTTPException

from backend import config
from backend.db import connect_db, loads_json, now_iso, row_dict
from backend.schemas import SpriteApprovalPayload
from backend.serializers import (
    get_sprite_version_or_404,
    get_team_or_404,
    public_sprite_version,
    public_team,
)

router = APIRouter()


@router.get("/api/teams/{team_id}/sprite-versions")
async def list_sprite_versions(team_id: int):
    with connect_db() as db:
        get_team_or_404(db, team_id)
        rows = db.execute(
            """
            SELECT * FROM sprite_versions
            WHERE team_id = ?
            ORDER BY created_at DESC, id DESC
            """,
            (team_id,),
        ).fetchall()
        return {
            "team_id": team_id,
            "active_version_id": row_dict(get_team_or_404(db, team_id)).get("showcase_sprite_active_version_id"),
            "candidate_version_id": row_dict(get_team_or_404(db, team_id)).get("showcase_sprite_version_id"),
            "versions": [public_sprite_version(row) for row in rows],
        }


@router.post("/api/teams/{team_id}/sprite-versions/{version_id}/restore")
async def restore_sprite_version(team_id: int, version_id: str):
    timestamp = now_iso()
    with connect_db() as db:
        version = row_dict(get_sprite_version_or_404(db, team_id, version_id))
        if not version.get("atlas_url"):
            raise HTTPException(status_code=409, detail="복원할 스프라이트 아틀라스가 없습니다")
        db.execute(
            """
            UPDATE sprite_versions
            SET status = 'ready', approved_at = COALESCE(approved_at, ?), updated_at = ?
            WHERE id = ? AND team_id = ?
            """,
            (timestamp, timestamp, version_id, team_id),
        )
        db.execute(
            """
            UPDATE teams
            SET showcase_sprite_active_url = ?,
                showcase_sprite_active_version_id = ?,
                showcase_sprite_version_id = ?,
                showcase_sprite_url = ?,
                showcase_sprite_status = 'ready',
                showcase_sprite_contract = ?,
                showcase_sprite_quality_status = ?,
                showcase_sprite_quality_json = ?,
                showcase_sprite_error = NULL,
                showcase_sprite_updated_at = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (
                version["atlas_url"],
                version_id,
                version_id,
                version["atlas_url"],
                version.get("contract") or config.GARMENT_TRANSFER_CONTRACT,
                (loads_json(version.get("qa_json")) or {}).get("status", "unchecked"),
                version.get("qa_json"),
                timestamp,
                timestamp,
                team_id,
            ),
        )
        return {
            "team": public_team(get_team_or_404(db, team_id)),
            "version": public_sprite_version(get_sprite_version_or_404(db, team_id, version_id)),
            "status": "ready",
        }


@router.post("/api/teams/{team_id}/showcase-sprite/approve")
async def approve_showcase_sprite(
    team_id: int,
    payload: Optional[SpriteApprovalPayload] = None,
):
    force = payload.force if payload else False
    with connect_db() as db:
        team = row_dict(get_team_or_404(db, team_id))
        candidate_version = None
        if team.get("showcase_sprite_version_id"):
            candidate_version = row_dict(get_sprite_version_or_404(
                db,
                team_id,
                team["showcase_sprite_version_id"],
            ))
    if not team["showcase_sprite_url"]:
        raise HTTPException(status_code=409, detail="검수할 AI 스프라이트가 없습니다")
    if team["showcase_sprite_status"] not in ("review", "ready"):
        raise HTTPException(status_code=409, detail="생성이 완료된 AI 스프라이트만 승인할 수 있습니다")
    if team["showcase_sprite_status"] == "ready":
        return public_team(team)
    quality = {}
    if candidate_version and candidate_version.get("qa_json"):
        try:
            quality = json.loads(candidate_version["qa_json"])
        except (json.JSONDecodeError, TypeError):
            quality = {}
    elif team.get("showcase_sprite_quality_json"):
        try:
            quality = json.loads(team["showcase_sprite_quality_json"])
        except (json.JSONDecodeError, TypeError):
            quality = {}
    if not force and not quality.get("can_approve", False):
        raise HTTPException(
            status_code=409,
            detail="자동 검수에서 잘림 또는 외형 문제가 발견되었습니다. 다시 생성하거나 문제를 확인한 뒤 강제 적용하세요.",
        )
    timestamp = now_iso()
    with connect_db() as db:
        if candidate_version:
            db.execute(
                """
                UPDATE sprite_versions
                SET status = 'ready', approved_at = ?, updated_at = ?
                WHERE id = ? AND team_id = ?
                """,
                (
                    timestamp,
                    timestamp,
                    candidate_version["id"],
                    team_id,
                ),
            )
        db.execute(
            """
            UPDATE teams
            SET showcase_sprite_active_url = showcase_sprite_url,
                showcase_sprite_active_version_id = COALESCE(showcase_sprite_version_id, showcase_sprite_active_version_id),
                showcase_sprite_status = 'ready',
                showcase_sprite_error = NULL,
                showcase_sprite_updated_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (timestamp, timestamp, team_id),
        )
        return public_team(get_team_or_404(db, team_id))
