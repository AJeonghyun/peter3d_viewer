"""Seating preset management for the projector seating chart."""

import json
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException

from peter3d_storage import (
    DEFAULT_SEATING_PRESET_ID,
    DEFAULT_SEATING_PRESET_NAME,
    DEFAULT_SEATING_PRESET_TIME_LABEL,
    DEFAULT_SEATING_PRESET_TITLE,
)

from backend import config
from backend.db import connect_db, now_iso, row_dict
from backend.schemas import ActiveSeatingPresetPayload, SeatingPresetPayload
from backend.serializers import validate_group_order

router = APIRouter()


def public_seating_preset(row: Any) -> dict:
    preset = row_dict(row)
    try:
        group_order = json.loads(preset["group_order"])
    except (TypeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail="자리표 프리셋 데이터가 손상되었습니다") from exc
    if not isinstance(group_order, list) or not all(isinstance(value, int) for value in group_order):
        raise HTTPException(status_code=500, detail="자리표 프리셋 데이터가 손상되었습니다")
    preset["group_order"] = group_order
    return preset


def ensure_default_seating_preset(db: Any) -> None:
    exists = db.execute("SELECT 1 FROM seating_presets LIMIT 1").fetchone()
    if exists is None:
        timestamp = now_iso()
        db.execute(
            """
            INSERT INTO seating_presets (
                id, name, title, time_label, group_order, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                DEFAULT_SEATING_PRESET_ID,
                DEFAULT_SEATING_PRESET_NAME,
                DEFAULT_SEATING_PRESET_TITLE,
                DEFAULT_SEATING_PRESET_TIME_LABEL,
                json.dumps(list(range(1, config.TEAM_COUNT + 1)), separators=(",", ":")),
                timestamp,
                timestamp,
            ),
        )
    active = db.execute(
        """
        SELECT value FROM app_settings
        WHERE key = 'active_seating_preset_id'
          AND value IN (SELECT id FROM seating_presets)
        """
    ).fetchone()
    if active is not None:
        return
    timestamp = now_iso()
    fallback = db.execute(
        """
        SELECT id FROM seating_presets
        ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, updated_at DESC, id
        LIMIT 1
        """,
        (DEFAULT_SEATING_PRESET_ID,),
    ).fetchone()
    db.execute(
        """
        INSERT INTO app_settings (key, value, updated_at)
        VALUES ('active_seating_preset_id', ?, ?)
        ON CONFLICT (key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at
        """,
        (fallback["id"], timestamp),
    )


def get_active_seating_preset_id(db: Any) -> str:
    ensure_default_seating_preset(db)
    return db.execute(
        "SELECT value FROM app_settings WHERE key = 'active_seating_preset_id'"
    ).fetchone()["value"]


def get_seating_preset_or_404(db: Any, preset_id: str):
    row = db.execute("SELECT * FROM seating_presets WHERE id = ?", (preset_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="자리표 프리셋을 찾을 수 없습니다")
    return row


@router.get("/api/seating-presets")
async def list_seating_presets():
    with connect_db() as db:
        ensure_default_seating_preset(db)
        rows = db.execute(
            "SELECT * FROM seating_presets ORDER BY updated_at DESC, name, id"
        ).fetchall()
        return {
            "presets": [public_seating_preset(row) for row in rows],
            "active_preset_id": get_active_seating_preset_id(db),
        }


@router.post("/api/seating-presets", status_code=201)
async def create_seating_preset(payload: SeatingPresetPayload):
    group_order = validate_group_order(payload.group_order)
    timestamp = now_iso()
    preset_id = uuid.uuid4().hex
    with connect_db() as db:
        db.execute(
            """
            INSERT INTO seating_presets (
                id, name, title, time_label, group_order, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                preset_id,
                payload.name,
                payload.title,
                payload.time_label,
                json.dumps(group_order, separators=(",", ":")),
                timestamp,
                timestamp,
            ),
        )
        return public_seating_preset(get_seating_preset_or_404(db, preset_id))


@router.put("/api/seating-presets/active")
async def set_active_seating_preset(payload: ActiveSeatingPresetPayload):
    timestamp = now_iso()
    with connect_db() as db:
        preset = get_seating_preset_or_404(db, payload.preset_id)
        db.execute(
            """
            INSERT INTO app_settings (key, value, updated_at)
            VALUES ('active_seating_preset_id', ?, ?)
            ON CONFLICT (key) DO UPDATE SET
                value = excluded.value,
                updated_at = excluded.updated_at
            """,
            (payload.preset_id, timestamp),
        )
        return {
            "active_preset_id": payload.preset_id,
            "preset": public_seating_preset(preset),
        }


@router.put("/api/seating-presets/{preset_id}")
async def update_seating_preset(preset_id: str, payload: SeatingPresetPayload):
    group_order = validate_group_order(payload.group_order)
    timestamp = now_iso()
    with connect_db() as db:
        get_seating_preset_or_404(db, preset_id)
        db.execute(
            """
            UPDATE seating_presets
            SET name = ?, title = ?, time_label = ?, group_order = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                payload.name,
                payload.title,
                payload.time_label,
                json.dumps(group_order, separators=(",", ":")),
                timestamp,
                preset_id,
            ),
        )
        return public_seating_preset(get_seating_preset_or_404(db, preset_id))


@router.delete("/api/seating-presets/{preset_id}")
async def delete_seating_preset(preset_id: str):
    timestamp = now_iso()
    with connect_db() as db:
        get_seating_preset_or_404(db, preset_id)
        db.execute("DELETE FROM seating_presets WHERE id = ?", (preset_id,))
        ensure_default_seating_preset(db)
        active_id = get_active_seating_preset_id(db)
        if active_id == preset_id:
            replacement = db.execute(
                """
                SELECT id FROM seating_presets
                ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, updated_at DESC, id
                LIMIT 1
                """,
                (DEFAULT_SEATING_PRESET_ID,),
            ).fetchone()
            db.execute(
                """
                UPDATE app_settings
                SET value = ?, updated_at = ?
                WHERE key = 'active_seating_preset_id'
                """,
                (replacement["id"], timestamp),
            )
            active_id = replacement["id"]
        return {"deleted": preset_id, "active_preset_id": active_id}
