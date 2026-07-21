"""Row-to-public-payload serializers and shared lookup helpers."""

import json
from typing import Any, List

from fastapi import HTTPException

from backend import config
from backend.db import loads_json, row_dict


def public_team(row: Any) -> dict:
    team = row_dict(row)
    json_fields = {
        "showcase_sprite_quality_json": "showcase_sprite_quality",
        "showcase_capture_quality_json": "showcase_capture_quality",
        "showcase_garment_parts_json": "showcase_garment_parts",
    }
    for source, target in json_fields.items():
        encoded = team.pop(source, None)
        try:
            decoded = json.loads(encoded) if encoded else None
        except (json.JSONDecodeError, TypeError):
            decoded = None
        team[target] = decoded
    parts = team.get("showcase_garment_parts")
    if isinstance(parts, dict) and isinstance(parts.get("urls"), dict):
        urls = parts["urls"]
        crops = parts.get("crops") if isinstance(parts.get("crops"), dict) else {}
        team["showcase_garment_parts"] = {
            part: {
                "key": part,
                "status": "ready" if urls.get(part) else "empty",
                "preview_url": urls.get(part),
                "crop": crops.get(part),
            }
            for part in config.GARMENT_PARTS
        }
    team["showcase_sprite_contract"] = public_sprite_contract(
        team.get("showcase_sprite_contract")
    )
    return team


def public_sprite_contract(value: Any) -> Any:
    if isinstance(value, dict) or value is None:
        return value
    if value in {
        config.LEGACY_GARMENT_TRANSFER_CONTRACT,
        config.PREVIOUS_GARMENT_TRANSFER_CONTRACT,
        config.PRE_CAMPFIRE_GARMENT_TRANSFER_CONTRACT,
        config.V5_GARMENT_TRANSFER_CONTRACT,
        config.GARMENT_TRANSFER_CONTRACT,
    }:
        if value == config.GARMENT_TRANSFER_CONTRACT:
            version = 6
            display_scale = 1.0
            rows = config.GARMENT_ATLAS_ROWS
            columns = config.GARMENT_ATLAS_COLUMNS
            frame_count = config.GARMENT_FRAME_COUNT
            layout = f"{columns}x{rows}"
        elif value == config.V5_GARMENT_TRANSFER_CONTRACT:
            version = 5
            display_scale = 1.0
            rows = 5
            columns = 5
            frame_count = 25
            layout = "5x5"
        elif value == config.PRE_CAMPFIRE_GARMENT_TRANSFER_CONTRACT:
            version = 4
            display_scale = 1.0
            rows = 5
            columns = 5
            frame_count = 25
            layout = "5x5"
        elif value == config.PREVIOUS_GARMENT_TRANSFER_CONTRACT:
            version = 3
            display_scale = config.GARMENT_DISPLAY_SCALE
            rows = 5
            columns = 5
            frame_count = 25
            layout = "5x5"
        else:
            version = 2
            display_scale = config.GARMENT_DISPLAY_SCALE
            rows = 5
            columns = 5
            frame_count = 25
            layout = "5x5"
        return {
            "id": str(value),
            "version": version,
            "layout": layout,
            "rows": rows,
            "columns": columns,
            "frame_count": frame_count,
            "frame_width": config.GARMENT_ATLAS_CELL_SIZE,
            "frame_height": config.GARMENT_ATLAS_CELL_SIZE,
            "safe_frame": "square",
            "display_scale": display_scale,
        }
    return {"id": str(value), "layout": "4x3", "rows": 3, "columns": 4, "frame_count": 12}


def public_sprite_version(row: Any) -> dict:
    version = row_dict(row)
    version["contract"] = public_sprite_contract(version.get("contract"))
    version["quality"] = loads_json(version.pop("quality_json", None))
    version["parts"] = loads_json(version.pop("parts_json", None))
    version["qa"] = loads_json(version.pop("qa_json", None))
    return version


def public_model_asset(row: Any) -> dict:
    asset = row_dict(row)
    team_ids = asset.get("team_ids") or ""
    return {
        "id": asset["id"],
        "name": asset["name"],
        "source_image_url": asset.get("source_image_url"),
        "glb_url": asset["glb_url"],
        "pipeline_profile": asset.get("pipeline_profile") or "unknown",
        "glb_bytes": asset.get("glb_bytes"),
        "glb_triangles": asset.get("glb_triangles"),
        "glb_animations": asset.get("glb_animations"),
        "team_ids": [int(value) for value in str(team_ids).split(",") if value],
        "created_at": asset["created_at"],
        "updated_at": asset["updated_at"],
    }


def get_team_or_404(db: Any, team_id: int):
    if team_id < 1 or team_id > config.TEAM_COUNT:
        raise HTTPException(status_code=404, detail="조를 찾을 수 없습니다")
    row = db.execute("SELECT * FROM teams WHERE id = ?", (team_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="조를 찾을 수 없습니다")
    return row


def get_sprite_version_or_404(db: Any, team_id: int, version_id: str):
    row = db.execute(
        "SELECT * FROM sprite_versions WHERE team_id = ? AND id = ?",
        (team_id, version_id),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="스프라이트 버전을 찾을 수 없습니다")
    return row


def validate_group_order(group_order: List[int]) -> List[int]:
    if len(group_order) != config.TEAM_COUNT:
        raise HTTPException(
            status_code=422,
            detail=f"group_order는 정확히 {config.TEAM_COUNT}개여야 합니다",
        )
    expected = set(range(1, config.TEAM_COUNT + 1))
    actual = set(group_order)
    if actual != expected or len(actual) != len(group_order):
        raise HTTPException(
            status_code=422,
            detail=f"group_order는 1부터 {config.TEAM_COUNT}까지 중복 없이 포함해야 합니다",
        )
    return group_order


def derive_title(team: dict) -> str:
    stats = {key: int(team[key]) for key in config.STAT_KEYS}
    if min(stats.values()) >= 80:
        return "깨어난 베드로"
    if min(stats.values()) >= 50:
        return "사람을 낚는 어부"
    best = max(stats, key=stats.get)
    thresholds = {
        "courage": "물 위에 발을 내딛는 자",
        "wisdom": "현명한 선택을 하는 자",
        "faith": "진실을 지키는 자",
        "love": "열정으로 나아가는 자",
    }
    return thresholds[best] if stats[best] >= 30 else "첫걸음을 준비하는 자"
