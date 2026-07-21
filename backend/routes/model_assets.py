"""Manually uploaded GLB model library shared by the legacy 3D world."""

import uuid
from typing import Dict, List

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from peter3d_storage import (
    blob_configured,
    delete_blob_if_managed,
    using_postgres,
)

from backend import config
from backend.db import connect_db, now_iso, row_dict
from backend.glb import persist_uploaded_glb, validated_glb_upload
from backend.schemas import ModelAssetApply
from backend.serializers import public_model_asset

router = APIRouter()


@router.get("/api/model-assets")
async def list_model_assets():
    with connect_db() as db:
        assets = [row_dict(row) for row in db.execute(
            "SELECT * FROM model_assets ORDER BY created_at DESC"
        ).fetchall()]
        assignments = db.execute(
            """
            SELECT model_asset_id, id AS team_id FROM teams
            WHERE model_asset_id IS NOT NULL ORDER BY id
            """
        ).fetchall()
    team_ids_by_asset: Dict[str, List[int]] = {}
    for row in assignments:
        team_ids_by_asset.setdefault(row["model_asset_id"], []).append(int(row["team_id"]))
    for asset in assets:
        asset["team_ids"] = ",".join(str(value) for value in team_ids_by_asset.get(asset["id"], []))
    return [public_model_asset(asset) for asset in assets]


@router.post("/api/model-assets/upload", status_code=201)
async def upload_model_asset(
    glb: UploadFile = File(...),
    name: str = Form(...),
):
    if config.SERVERLESS_RUNTIME and not (using_postgres() and blob_configured()):
        raise HTTPException(
            status_code=503,
            detail="Neon Postgres와 Vercel Blob 연결이 필요합니다.",
        )
    asset_name = name.strip()
    if not asset_name or len(asset_name) > 60:
        raise HTTPException(status_code=422, detail="모델 이름은 1~60자로 입력해주세요")
    contents, metrics = await validated_glb_upload(glb)
    asset_id = uuid.uuid4().hex[:12]
    glb_url = await persist_uploaded_glb(asset_id, contents)
    timestamp = now_iso()
    try:
        with connect_db() as db:
            db.execute(
                """
                INSERT INTO model_assets (
                    id, name, source_image_url, glb_url, pipeline_profile,
                    glb_bytes, glb_triangles, glb_animations, created_at, updated_at
                ) VALUES (?, ?, NULL, ?, 'uploaded_glb', ?, ?, ?, ?, ?)
                """,
                (
                    asset_id,
                    asset_name,
                    glb_url,
                    metrics["bytes"],
                    metrics["triangles"],
                    metrics["animations"],
                    timestamp,
                    timestamp,
                ),
            )
            asset = row_dict(db.execute(
                "SELECT * FROM model_assets WHERE id = ?",
                (asset_id,),
            ).fetchone())
    except Exception:
        await delete_blob_if_managed(glb_url)
        if glb_url.startswith("/static/"):
            (config.ROOT / glb_url.removeprefix("/")).unlink(missing_ok=True)
        raise
    asset["team_ids"] = ""
    return public_model_asset(asset)


@router.post("/api/model-assets/{asset_id}/apply")
async def apply_model_asset(asset_id: str, payload: ModelAssetApply):
    team_ids = sorted(set(payload.team_ids))
    if any(team_id < 1 or team_id > config.TEAM_COUNT for team_id in team_ids):
        raise HTTPException(
            status_code=422,
            detail=f"조 번호는 1~{config.TEAM_COUNT} 사이여야 합니다",
        )
    timestamp = now_iso()
    with connect_db() as db:
        asset = db.execute("SELECT * FROM model_assets WHERE id = ?", (asset_id,)).fetchone()
        if not asset:
            raise HTTPException(status_code=404, detail="모델 보관함에서 GLB를 찾을 수 없습니다")
        existing = db.execute(
            f"SELECT id FROM teams WHERE id IN ({','.join('?' for _ in team_ids)})",
            team_ids,
        ).fetchall()
        if len(existing) != len(team_ids):
            raise HTTPException(status_code=404, detail="선택한 조 중 존재하지 않는 조가 있습니다")
        for team_id in team_ids:
            db.execute(
                """
                UPDATE teams SET model_url = ?, model_asset_id = ?,
                    conversion_status = 'done', updated_at = ? WHERE id = ?
                """,
                (asset["glb_url"], asset_id, timestamp, team_id),
            )
        rows = db.execute(
            f"SELECT * FROM teams WHERE id IN ({','.join('?' for _ in team_ids)}) ORDER BY id",
            team_ids,
        ).fetchall()
    return {
        "asset_id": asset_id,
        "applied_count": len(team_ids),
        "teams": [row_dict(row) for row in rows],
    }
