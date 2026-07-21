"""Team CRUD, growth events, and the showcase character photo upload."""

import uuid

from fastapi import APIRouter, File, HTTPException, UploadFile

from peter3d_storage import blob_configured, delete_blob_if_managed, put_public_blob

from backend import config
from backend.compose_state import ensure_compose_not_active
from backend.db import connect_db, now_iso, row_dict
from backend.media import validated_image_upload
from backend.schemas import GrowthCreate, TeamUpdate
from backend.serializers import derive_title, get_team_or_404, public_team

router = APIRouter()


@router.get("/api/teams")
async def list_teams():
    with connect_db() as db:
        rows = db.execute(
            "SELECT * FROM teams WHERE id <= ? ORDER BY id",
            (config.TEAM_COUNT,),
        ).fetchall()
        return [public_team(row) for row in rows]


@router.get("/api/teams/{team_id}")
async def get_team(team_id: int):
    with connect_db() as db:
        return public_team(get_team_or_404(db, team_id))


@router.patch("/api/teams/{team_id}")
async def update_team(team_id: int, payload: TeamUpdate):
    values = payload.dict(exclude_unset=True)
    if not values:
        return await get_team(team_id)
    with connect_db() as db:
        get_team_or_404(db, team_id)
        assignments = [f"{key} = ?" for key in values]
        db.execute(
            f"UPDATE teams SET {', '.join(assignments)}, updated_at = ? WHERE id = ?",
            [*values.values(), now_iso(), team_id],
        )
        return public_team(get_team_or_404(db, team_id))


@router.get("/api/teams/{team_id}/history")
async def team_history(team_id: int):
    with connect_db() as db:
        get_team_or_404(db, team_id)
        rows = db.execute(
            "SELECT * FROM growth_events WHERE team_id = ? ORDER BY id DESC LIMIT 30",
            (team_id,),
        ).fetchall()
        return [row_dict(row) for row in rows]


@router.post("/api/teams/{team_id}/growth")
async def add_growth(team_id: int, payload: GrowthCreate):
    invalid = set(payload.stats) - set(config.STAT_KEYS)
    if invalid:
        raise HTTPException(status_code=422, detail=f"알 수 없는 성품: {', '.join(sorted(invalid))}")
    if any(delta < -100 or delta > 100 for delta in payload.stats.values()):
        raise HTTPException(status_code=422, detail="성품 변화량은 -100에서 100 사이여야 합니다")

    with connect_db() as db:
        team = row_dict(get_team_or_404(db, team_id))
        talents = team["talents"] + payload.talent_delta
        if talents < 0:
            raise HTTPException(status_code=409, detail="보유 달란트가 부족합니다")
        updated = dict(team)
        for key in config.STAT_KEYS:
            updated[key] = max(0, min(100, team[key] + payload.stats.get(key, 0)))
        updated["talents"] = talents
        updated["title"] = derive_title(updated)
        db.execute(
            """
            UPDATE teams SET courage = ?, wisdom = ?, faith = ?, love = ?,
                talents = ?, title = ?, updated_at = ? WHERE id = ?
            """,
            (
                updated["courage"], updated["wisdom"], updated["faith"], updated["love"],
                talents, updated["title"], now_iso(), team_id,
            ),
        )
        db.execute(
            """
            INSERT INTO growth_events (
                team_id, source, note, talent_delta, courage_delta, wisdom_delta,
                faith_delta, love_delta, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                team_id, payload.source, payload.note, payload.talent_delta,
                payload.stats.get("courage", 0), payload.stats.get("wisdom", 0),
                payload.stats.get("faith", 0), payload.stats.get("love", 0), now_iso(),
            ),
        )
        return row_dict(get_team_or_404(db, team_id))


@router.post("/api/teams/{team_id}/image")
async def upload_team_image(team_id: int, image: UploadFile = File(...)):
    if config.SERVERLESS_RUNTIME and not blob_configured():
        raise HTTPException(
            status_code=503,
            detail="배포 환경에서 캐릭터 사진을 저장하려면 Vercel Blob 연결이 필요합니다",
        )
    with connect_db() as db:
        previous_team = row_dict(get_team_or_404(db, team_id))
    ensure_compose_not_active(previous_team)
    contents, content_type, extension = await validated_image_upload(image)

    image_id = uuid.uuid4().hex[:12]
    filename = f"team-{team_id}-showcase-{image_id}{extension}"
    image_path = config.UPLOADS_DIR / filename
    if blob_configured():
        image_url = await put_public_blob(
            f"teams/{team_id}/images/showcase-{image_id}{extension}",
            contents,
            content_type=content_type,
        )
        if not config.SERVERLESS_RUNTIME:
            image_path.write_bytes(contents)
    else:
        image_path.write_bytes(contents)
        image_url = f"/uploads/{filename}"

    with connect_db() as db:
        db.execute(
            """
            UPDATE teams
            SET showcase_image_url = ?, showcase_sprite_url = NULL,
                showcase_sprite_status = 'empty', showcase_sprite_error = NULL,
                showcase_sprite_model = NULL,
                showcase_sprite_quality_status = 'unchecked',
                showcase_sprite_quality_json = NULL,
                showcase_sprite_qa_model = NULL,
                showcase_sprite_updated_at = NULL,
                updated_at = ?
            WHERE id = ?
            """,
            (image_url, now_iso(), team_id),
        )
        updated = public_team(get_team_or_404(db, team_id))
    if previous_team["showcase_image_url"] != image_url:
        await delete_blob_if_managed(previous_team["showcase_image_url"])
    if (
        previous_team["showcase_sprite_url"]
        and previous_team["showcase_sprite_url"] != previous_team["showcase_sprite_active_url"]
    ):
        await delete_blob_if_managed(previous_team["showcase_sprite_url"])
    return updated
