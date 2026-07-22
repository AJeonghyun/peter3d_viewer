"""Shared scene layouts and image/GIF objects for editor and display clients."""

from __future__ import annotations

import io
import json
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError

from peter3d_storage import blob_configured, delete_blob_if_managed, put_public_blob

from backend import config
from backend.db import connect_db, loads_json, now_iso, row_dict
from backend.schemas import RetreatSceneLayoutPayload

router = APIRouter()

VALID_SCENES = frozenset({"stand", "back", "campfire", "seating"})
SCENE_MEDIA_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


def validate_scene(scene: str) -> str:
    if scene not in VALID_SCENES:
        raise HTTPException(status_code=404, detail="장면을 찾을 수 없습니다")
    return scene


def public_scene_media(row: Any) -> dict:
    item = row_dict(row)
    return {
        "id": item["id"],
        "name": item["name"],
        "mime_type": item["mime_type"],
        "asset_url": item["asset_url"],
        "created_at": item["created_at"],
        "updated_at": item["updated_at"],
    }


def scene_snapshot(db: Any, scene: str) -> dict:
    scene_row = db.execute(
        "SELECT layout_json, updated_at FROM retreat_scenes WHERE scene = ?",
        (scene,),
    ).fetchone()
    media_rows = db.execute(
        """
        SELECT * FROM retreat_scene_media
        WHERE scene = ? ORDER BY created_at, id
        """,
        (scene,),
    ).fetchall()
    layout = loads_json(scene_row["layout_json"]) if scene_row is not None else {}
    if not isinstance(layout, dict):
        layout = {}
    revisions = [row["updated_at"] for row in media_rows]
    if scene_row is not None:
        revisions.append(scene_row["updated_at"])
    return {
        "scene": scene,
        "layout": layout,
        "media": [public_scene_media(row) for row in media_rows],
        "updated_at": max(revisions) if revisions else None,
    }


async def validated_scene_media_upload(media: UploadFile) -> tuple[bytes, str, str]:
    content_type = (media.content_type or "").lower()
    extension = SCENE_MEDIA_TYPES.get(content_type)
    if extension is None:
        raise HTTPException(status_code=415, detail="PNG, JPG, WEBP, GIF 파일만 추가할 수 있습니다")
    contents = await media.read(config.MAX_SCENE_MEDIA_BYTES + 1)
    if len(contents) > config.MAX_SCENE_MEDIA_BYTES:
        raise HTTPException(status_code=413, detail="파일은 30MB 이하여야 합니다")
    if not contents:
        raise HTTPException(status_code=422, detail="빈 파일은 추가할 수 없습니다")
    try:
        with Image.open(io.BytesIO(contents)) as image:
            detected = (image.format or "").upper()
            image.verify()
    except (UnidentifiedImageError, OSError, SyntaxError) as exc:
        raise HTTPException(status_code=422, detail="파일 내용이 올바른 이미지 형식이 아닙니다") from exc
    expected_formats = {
        "image/png": "PNG",
        "image/jpeg": "JPEG",
        "image/webp": "WEBP",
        "image/gif": "GIF",
    }
    if detected != expected_formats[content_type]:
        raise HTTPException(status_code=422, detail="파일 확장자와 이미지 형식이 일치하지 않습니다")
    return contents, content_type, extension


def validated_layout(payload: RetreatSceneLayoutPayload) -> dict:
    if len(payload.layout) > config.MAX_SCENE_OBJECTS:
        raise HTTPException(status_code=422, detail="장면 요소가 너무 많습니다")
    normalized: dict[str, dict] = {}
    for key, position in payload.layout.items():
        valid_group = key.startswith("group-") and key.removeprefix("group-").isdigit()
        valid_media = key.startswith("media-") and len(key.removeprefix("media-")) == 32
        if key not in {"jesus", "fire", "trophy"} and not valid_group and not valid_media:
            raise HTTPException(status_code=422, detail=f"알 수 없는 장면 요소입니다: {key}")
        if valid_group and not 1 <= int(key.removeprefix("group-")) <= config.TEAM_COUNT:
            raise HTTPException(status_code=422, detail=f"알 수 없는 조입니다: {key}")
        normalized[key] = position.model_dump(exclude_none=True)
    return normalized


@router.get("/api/retreat-scenes/{scene}")
async def get_retreat_scene(scene: str):
    validate_scene(scene)
    with connect_db() as db:
        return scene_snapshot(db, scene)


@router.put("/api/retreat-scenes/{scene}/layout")
async def save_retreat_scene_layout(scene: str, payload: RetreatSceneLayoutPayload):
    validate_scene(scene)
    layout = validated_layout(payload)
    timestamp = now_iso()
    with connect_db() as db:
        db.execute(
            """
            INSERT INTO retreat_scenes (scene, layout_json, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (scene) DO UPDATE SET
                layout_json = excluded.layout_json,
                updated_at = excluded.updated_at
            """,
            (scene, json.dumps(layout, separators=(",", ":")), timestamp, timestamp),
        )
        return scene_snapshot(db, scene)


@router.post("/api/retreat-scenes/{scene}/media", status_code=201)
async def upload_retreat_scene_media(
    scene: str,
    media: UploadFile = File(...),
):
    validate_scene(scene)
    if config.SERVERLESS_RUNTIME and not blob_configured():
        raise HTTPException(status_code=503, detail="공유 이미지 저장을 위한 Vercel Blob 연결이 필요합니다")
    contents, content_type, extension = await validated_scene_media_upload(media)
    media_id = uuid.uuid4().hex
    if blob_configured():
        asset_url = await put_public_blob(
            f"retreat-scenes/{scene}/{media_id}{extension}",
            contents,
            content_type=content_type,
            multipart=len(contents) > 4 * 1024 * 1024,
        )
    else:
        filename = f"retreat-{scene}-{media_id}{extension}"
        (config.UPLOADS_DIR / filename).write_bytes(contents)
        asset_url = f"/uploads/{filename}"
    try:
        timestamp = now_iso()
        display_name = Path(media.filename or f"image{extension}").name[:180]
        with connect_db() as db:
            db.execute(
                """
                INSERT INTO retreat_scene_media (
                    id, scene, name, mime_type, asset_url, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (media_id, scene, display_name, content_type, asset_url, timestamp, timestamp),
            )
            row = db.execute(
                "SELECT * FROM retreat_scene_media WHERE id = ?",
                (media_id,),
            ).fetchone()
            return public_scene_media(row)
    except Exception:
        await delete_blob_if_managed(asset_url)
        if asset_url.startswith("/uploads/"):
            (config.UPLOADS_DIR / Path(asset_url).name).unlink(missing_ok=True)
        raise


@router.delete("/api/retreat-scenes/{scene}/media/{media_id}")
async def delete_retreat_scene_media(scene: str, media_id: str):
    validate_scene(scene)
    with connect_db() as db:
        row = db.execute(
            "SELECT * FROM retreat_scene_media WHERE id = ? AND scene = ?",
            (media_id, scene),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="장면 이미지/GIF를 찾을 수 없습니다")
        item = public_scene_media(row)
        scene_row = db.execute(
            "SELECT layout_json FROM retreat_scenes WHERE scene = ?",
            (scene,),
        ).fetchone()
        layout = loads_json(scene_row["layout_json"]) if scene_row is not None else {}
        if not isinstance(layout, dict):
            layout = {}
        layout.pop(f"media-{media_id}", None)
        timestamp = now_iso()
        db.execute("DELETE FROM retreat_scene_media WHERE id = ?", (media_id,))
        if scene_row is not None:
            db.execute(
                """
                UPDATE retreat_scenes
                SET layout_json = ?, updated_at = ?
                WHERE scene = ?
                """,
                (json.dumps(layout, separators=(",", ":")), timestamp, scene),
            )
    await delete_blob_if_managed(item["asset_url"])
    if item["asset_url"].startswith("/uploads/"):
        local_path = config.UPLOADS_DIR / Path(item["asset_url"]).name
        local_path.unlink(missing_ok=True)
    return {"deleted": media_id, "scene": scene}
