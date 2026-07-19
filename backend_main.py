"""Peter3D retreat kiosk backend.

Serves the Galilee world, stores 21 active teams in SQLite or Postgres, and persists
uploaded images and generated GLBs in Vercel Blob when configured.
"""

import asyncio
import base64
import io
import json
import os
import struct
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from PIL import Image, ImageFilter, UnidentifiedImageError
from tripo3d import TaskStatus, TripoClient
from tripo3d.models import RigType

from peter3d_storage import (
    DEFAULT_SEATING_PRESET_ID,
    DEFAULT_SEATING_PRESET_NAME,
    DEFAULT_SEATING_PRESET_TIME_LABEL,
    DEFAULT_SEATING_PRESET_TITLE,
    blob_configured,
    connect_database,
    delete_blob_if_managed,
    initialize_database,
    put_public_blob,
    using_postgres,
)

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
MODELS_DIR = Path(os.getenv("PETER3D_MODELS_DIR", ROOT / "static" / "models"))
UPLOADS_DIR = Path(os.getenv("PETER3D_UPLOADS_DIR", ROOT / "uploads"))
FRONTEND_DIST = ROOT / "frontend" / "dist"
DB_PATH = Path(os.getenv("PETER3D_DB_PATH", DATA_DIR / "peter3d.db"))
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_GLB_BYTES = max(1, int(os.getenv("PETER3D_MAX_GLB_MB", "10"))) * 1024 * 1024
MAX_GLB_TRIANGLES = max(1_000, int(os.getenv("PETER3D_MAX_GLB_TRIANGLES", "100000")))
MAX_SPRITE_BYTES = 25 * 1024 * 1024
TRIPO_FACE_LIMIT = max(1_000, min(int(os.getenv("TRIPO_FACE_LIMIT", "40000")), 100_000))
WORKER_COUNT = max(1, min(int(os.getenv("PETER3D_WORKERS", "3")), 5))
SERVERLESS_RUNTIME = os.getenv("PETER3D_SERVERLESS", "0") == "1"
TRIPO_RIG_VERSION = os.getenv("TRIPO_RIG_VERSION", "v1.0-20240301")
TRIPO_IDLE_ANIMATION = "preset:biped:standing_relax"
TRIPO_WALK_ANIMATION = "preset:biped:walk"
TRIPO_API_BASE_URL = os.getenv("TRIPO_API_BASE_URL", "https://api.tripo3d.ai/v2/openapi")
ENABLE_MULTIVIEW_FALLBACK = os.getenv("TRIPO_MULTIVIEW_FALLBACK", "1") == "1"
OPENAI_IMAGE_MODEL = os.getenv("OPENAI_IMAGE_MODEL", "gpt-image-2")
OPENAI_IMAGE_QUALITY = os.getenv("OPENAI_IMAGE_QUALITY", "high")
OPENAI_IMAGE_INPUT_FIDELITY = os.getenv("OPENAI_IMAGE_INPUT_FIDELITY", "high")
OPENAI_IMAGE_API_URL = "https://api.openai.com/v1/images/edits"
OPENAI_SPRITE_QA_MODEL = os.getenv("OPENAI_SPRITE_QA_MODEL", "gpt-5.4-mini")
OPENAI_RESPONSES_API_URL = "https://api.openai.com/v1/responses"
TEAM_COUNT = 21
SHOWCASE_SPRITE_COLUMNS = 4
SHOWCASE_SPRITE_ROWS = 3
SHOWCASE_SPRITE_WIDTH = 1536
SHOWCASE_SPRITE_HEIGHT = 1152
SHOWCASE_SPRITE_SIZE = f"{SHOWCASE_SPRITE_WIDTH}x{SHOWCASE_SPRITE_HEIGHT}"
SHOWCASE_MASTER_PATH = (
    ROOT / "frontend" / "public" / "assets" / "peter-sober" / "peter-sober-master.png"
)
SHOWCASE_FRAME_SAFE_MARGIN = 14
STAT_KEYS = ("courage", "wisdom", "faith", "love")

SHOWCASE_SPRITE_PROMPT = """
You receive two reference images in this exact order:
1. a phone photo of a student's drawing on the printed Peter worksheet
2. the fixed Peter master animation sheet used by every team

Create one production-ready 2D sprite sheet. The fixed master is the sole source
of truth for Peter's face, hair, beard, skin, body proportions, line style, and
character identity. The student photo is the sole source of truth only for the
upper garment, lower garment, belt decoration if the student changed it, and
left/right footwear. This is a garment transfer, never a character redesign.

PRESERVE IN EVERY FRAME:
- copy Peter's face, expression, head shape, hair, beard, skin tone, hands,
  body proportions, and illustration style from the fixed master without change
- transfer the student's exact upper/lower clothing colors, patterns, writing,
  marks, handmade texture, and footwear colors/patterns onto those master poses
- keep intentional left/right asymmetry in the student's clothes and footwear
- infer only the minimum continuation needed for side views; invent no new motif
- ignore paper color, room background, shadows, wrinkles, hands holding the
  paper, perspective distortion, glare, and anything outside Peter's clothing

LAYOUT:
- exactly 12 separate full-body frames in a strict 4-column by 3-row grid
- all 12 cells are identical squares with identical camera, character scale,
  padding, and bottom-center anchor
- the lowest shoe sole uses the same baseline in every cell
- exactly one complete character in each cell, with no cropping or overlap
- keep at least 24 pixels of empty background around every visible body part in
  every 384 by 384 cell, including raised hands, hair, beard, and shoe soles
- no visible body pixel may touch or nearly touch a cell edge

ANIMATION:
- row 1: four subtle front-facing idle frames forming a seamless loop; only
  breathing, a tiny body sway, and at most one blink may change
- row 2: four strict 90-degree side-profile walking-right frames forming a
  seamless loop, with alternating contact and passing poses; the forehead,
  nose, mouth, chin, torso, arms, legs, and shoe toes all face right; show one
  visible eye and preserve a recognizable side-profile version of the same face,
  hair, and facial hair
- row 3: four front-facing friendly wave frames: arm rising, hand tilted one
  way, hand tilted the other way, arm returning

For areas hidden by the side view, infer the minimum necessary continuation
from the student's garment while preserving the fixed master identity. Do not
add new motifs, text, accessories, or clothing features. Use one perfectly flat,
uniform very light warm-gray background across
the full sheet. No transparency, gradient, scenery, cast shadows, grid lines,
borders, labels, captions, watermarks, extra people, extra limbs, duplicated
features, or cropped body parts. The result must look like one consistently
authored animation sheet, never twelve independently redesigned characters.
""".strip()

SHOWCASE_SPRITE_QA_PROMPT = """
Inspect this 4-column by 3-row sprite sheet as a strict animation QA reviewer.
There must be exactly one complete Peter character in each of the 12 square
cells. The first image is the generated sheet and the second image is the fixed
Peter master when supplied. Check every frame independently.

Fail a frame if any hair, head, beard, face, raised hand, arm, garment, leg,
foot, shoe, or outline is cut off, hidden by the cell boundary, merged with a
neighboring cell, or so close to an edge that animation playback could clip it.
Also fail obvious missing body parts, extra limbs, duplicated features, or a
walking frame that is not a right-facing side profile. Fail if Peter's face,
hair, beard, body proportions, or illustration style visibly drift away from
the fixed master. Clothing and shoes are expected to differ because they come
from the student's drawing. Use warning only for minor visual inconsistency that
does not crop the full body. Do not fail merely because the background is opaque.

Return a concise Korean summary and frame-specific issues. Frame numbering is
left-to-right, top-to-bottom, 1 through 12.
""".strip()

PIPELINE_PROFILES = {
    "h3_smart": {
        "label": "H3.1 40K Detail",
        "description": "40,000면으로 그림 디테일을 보존하는 iPad용 프로필",
        "model_version": "v3.1-20260211",
        "max_face_limit": 40_000,
        "estimated_credits": 85,
    },
    "p1": {
        "label": "P1 Smart Mesh",
        "description": "더 정돈된 저폴리 토폴로지 비교용",
        "model_version": "P1-20260311",
        "max_face_limit": 20_000,
        "estimated_credits": 95,
    },
}
DEFAULT_PIPELINE_PROFILE = os.getenv("TRIPO_PIPELINE_PROFILE", "h3_smart")
if DEFAULT_PIPELINE_PROFILE not in PIPELINE_PROFILES:
    DEFAULT_PIPELINE_PROFILE = "h3_smart"

for directory in (DB_PATH.parent, MODELS_DIR, UPLOADS_DIR):
    directory.mkdir(parents=True, exist_ok=True)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def connect_db():
    return connect_database(DB_PATH)


def init_db() -> None:
    initialize_database(DB_PATH, now_iso(), team_count=TEAM_COUNT)


def row_dict(row: Any) -> dict:
    return dict(row)


def public_team(row: Any) -> dict:
    team = row_dict(row)
    encoded_quality = team.pop("showcase_sprite_quality_json", None)
    try:
        quality = json.loads(encoded_quality) if encoded_quality else None
    except (json.JSONDecodeError, TypeError):
        quality = None
    team["showcase_sprite_quality"] = quality
    return team


def inspect_animated_glb(contents: bytes, *, minimum_animations: int = 1) -> dict:
    """Validate the runtime contract before publishing a generated character."""
    if len(contents) > MAX_GLB_BYTES:
        raise ValueError(f"GLB는 {MAX_GLB_BYTES // (1024 * 1024)}MB 이하여야 합니다")
    if len(contents) < 20:
        raise ValueError("GLB 파일이 너무 짧습니다")

    magic, version, declared_length = struct.unpack_from("<4sII", contents)
    if magic != b"glTF" or version != 2:
        raise ValueError("glTF 2.0 GLB 파일이 아닙니다")
    if declared_length != len(contents):
        raise ValueError("GLB 헤더의 파일 크기가 실제 크기와 다릅니다")

    document = None
    offset = 12
    while offset + 8 <= len(contents):
        chunk_length, chunk_type = struct.unpack_from("<II", contents, offset)
        offset += 8
        chunk_end = offset + chunk_length
        if chunk_end > len(contents):
            raise ValueError("GLB 청크가 파일 범위를 벗어났습니다")
        if chunk_type == 0x4E4F534A and document is None:
            try:
                document = json.loads(contents[offset:chunk_end].rstrip(b"\x00 ").decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ValueError("GLB JSON 청크가 올바르지 않습니다") from exc
        offset = chunk_end
    if offset != len(contents) or not isinstance(document, dict):
        raise ValueError("GLB JSON 청크를 찾지 못했습니다")

    animations = document.get("animations") or []
    skins = document.get("skins") or []
    meshes = document.get("meshes") or []
    accessors = document.get("accessors") or []
    if not skins:
        raise ValueError("리깅(스킨) 정보가 없는 GLB입니다")
    if not animations or not any(animation.get("channels") for animation in animations):
        raise ValueError("걷기 애니메이션 채널이 없는 GLB입니다")
    if len(animations) < minimum_animations:
        raise ValueError(
            f"GLB에 애니메이션이 {len(animations)}개만 있습니다 "
            f"(필요: {minimum_animations}개)"
        )
    if not meshes:
        raise ValueError("메시가 없는 GLB입니다")

    for resource in [*(document.get("buffers") or []), *(document.get("images") or [])]:
        if resource.get("uri"):
            raise ValueError("외부 파일을 참조하지 않는 단일 GLB만 사용할 수 있습니다")

    triangle_count = 0
    for mesh in meshes:
        for primitive in mesh.get("primitives") or []:
            if primitive.get("mode", 4) != 4:
                continue
            accessor_index = primitive.get("indices")
            if accessor_index is None:
                accessor_index = (primitive.get("attributes") or {}).get("POSITION")
            if isinstance(accessor_index, int) and 0 <= accessor_index < len(accessors):
                triangle_count += int(accessors[accessor_index].get("count", 0)) // 3
    if triangle_count <= 0:
        raise ValueError("삼각형 수를 확인할 수 없는 GLB입니다")
    if triangle_count > MAX_GLB_TRIANGLES:
        raise ValueError(
            f"GLB가 너무 복잡합니다: {triangle_count:,} 삼각형 "
            f"(최대 {MAX_GLB_TRIANGLES:,})"
        )
    return {
        "bytes": len(contents),
        "triangles": triangle_count,
        "animations": len(animations),
        "skins": len(skins),
    }


def public_job(row: Any) -> dict:
    """Return only fields required by the admin UI."""
    job = row_dict(row)
    return {
        "id": job["id"],
        "team_id": None if job.get("asset_only") else job["team_id"],
        "asset_only": bool(job.get("asset_only")),
        "asset_name": job.get("asset_name"),
        "status": job["status"],
        "error": job["error"],
        "glb_url": job["glb_url"],
        "pipeline_profile": job.get("pipeline_profile") or DEFAULT_PIPELINE_PROFILE,
        "fallback_used": bool(job.get("fallback_used")),
        "credits_used": int(job.get("credits_used") or 0),
        "glb_bytes": job.get("glb_bytes"),
        "glb_triangles": job.get("glb_triangles"),
        "glb_animations": job.get("glb_animations"),
        "created_at": job["created_at"],
        "updated_at": job["updated_at"],
    }


def public_model_asset(row: Any) -> dict:
    asset = row_dict(row)
    team_ids = asset.get("team_ids") or ""
    return {
        "id": asset["id"],
        "name": asset["name"],
        "source_image_url": asset.get("source_image_url"),
        "glb_url": asset["glb_url"],
        "pipeline_profile": asset.get("pipeline_profile") or DEFAULT_PIPELINE_PROFILE,
        "glb_bytes": asset.get("glb_bytes"),
        "glb_triangles": asset.get("glb_triangles"),
        "glb_animations": asset.get("glb_animations"),
        "team_ids": [int(value) for value in str(team_ids).split(",") if value],
        "created_at": asset["created_at"],
        "updated_at": asset["updated_at"],
    }


def get_team_or_404(db: Any, team_id: int):
    if team_id < 1 or team_id > TEAM_COUNT:
        raise HTTPException(status_code=404, detail="조를 찾을 수 없습니다")
    row = db.execute("SELECT * FROM teams WHERE id = ?", (team_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="조를 찾을 수 없습니다")
    return row


def validate_group_order(group_order: List[int]) -> List[int]:
    if len(group_order) != TEAM_COUNT:
        raise HTTPException(status_code=422, detail=f"group_order는 정확히 {TEAM_COUNT}개여야 합니다")
    expected = set(range(1, TEAM_COUNT + 1))
    actual = set(group_order)
    if actual != expected or len(actual) != len(group_order):
        raise HTTPException(
            status_code=422,
            detail=f"group_order는 1부터 {TEAM_COUNT}까지 중복 없이 포함해야 합니다",
        )
    return group_order


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
                json.dumps(list(range(1, TEAM_COUNT + 1)), separators=(",", ":")),
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


def derive_title(team: dict) -> str:
    stats = {key: int(team[key]) for key in STAT_KEYS}
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


class TeamUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=30)
    identity_text: Optional[str] = Field(default=None, max_length=120)
    color: Optional[str] = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    symbol: Optional[str] = Field(default=None, max_length=20)


class GrowthCreate(BaseModel):
    source: str = Field(min_length=1, max_length=60)
    note: str = Field(default="", max_length=200)
    talent_delta: int = Field(default=0, ge=-10000, le=10000)
    stats: Dict[str, int] = Field(default_factory=dict)


class ModelAssetApply(BaseModel):
    team_ids: List[int] = Field(min_length=1, max_length=TEAM_COUNT)


class SeatingPresetPayload(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=80)
    time_label: str = Field(default="", max_length=80)
    group_order: List[int] = Field(min_length=TEAM_COUNT, max_length=TEAM_COUNT)


class ActiveSeatingPresetPayload(BaseModel):
    preset_id: str = Field(min_length=1, max_length=80)


class SpriteApprovalPayload(BaseModel):
    force: bool = False


def profile_config(profile: str) -> dict:
    if profile not in PIPELINE_PROFILES:
        raise ValueError(f"지원하지 않는 변환 프로필입니다: {profile}")
    return PIPELINE_PROFILES[profile]


def task_failure_message(task: Any, fallback: str) -> str:
    """Keep provider error codes visible in job history when no message is returned."""
    code = getattr(task, "error_code", None)
    message = getattr(task, "error_msg", None)
    if code is not None and message:
        return f"[Tripo {code}] {message}"
    if message:
        return str(message)
    if code is not None:
        return f"{fallback} (Tripo 오류 코드: {code})"
    return fallback


def image_model_options(profile: str) -> dict:
    config = profile_config(profile)
    options = {
        "model_version": config["model_version"],
        "texture": True,
        "pbr": False,
        "face_limit": min(TRIPO_FACE_LIMIT, config["max_face_limit"]),
        "texture_alignment": "original_image",
        "orientation": "align_image",
        "enable_image_autofix": True,
        "export_uv": True,
    }
    if profile == "h3_smart":
        options.update(
            texture_quality="standard",
            compress=True,
            geometry_quality="standard",
        )
    return options


def multiview_model_payload(profile: str, multiview_task_id: str) -> dict:
    config = profile_config(profile)
    payload = {
        "type": "multiview_to_model",
        "original_task_id": multiview_task_id,
        "model_version": config["model_version"],
        "texture": True,
        "pbr": False,
        "face_limit": min(TRIPO_FACE_LIMIT, config["max_face_limit"]),
        "texture_alignment": "original_image",
        "orientation": "align_image",
        "export_uv": True,
    }
    if profile == "h3_smart":
        payload.update(
            texture_quality="standard",
            compress="geometry",
            geometry_quality="standard",
        )
    return payload


async def create_image_model_task(client: TripoClient, image: str, profile: str) -> str:
    return await client.image_to_model(image=image, **image_model_options(profile))


async def create_multiview_model_task(
    client: TripoClient,
    multiview_task_id: str,
    profile: str,
) -> str:
    # tripo3d 0.4.2 does not expose original_task_id on multiview_to_model yet.
    return await client.create_task(multiview_model_payload(profile, multiview_task_id))


async def create_rig_task(client: TripoClient, model_task_id: str) -> str:
    return await client.rig_model(
        original_model_task_id=model_task_id,
        model_version=TRIPO_RIG_VERSION,
        out_format="glb",
        rig_type=RigType.BIPED,
    )


async def create_animation_task(client: TripoClient, rig_task_id: str) -> str:
    return await client.retarget_animation(
        original_model_task_id=rig_task_id,
        animation=[TRIPO_IDLE_ANIMATION, TRIPO_WALK_ANIMATION],
        out_format="glb",
        bake_animation=True,
        export_with_geometry=True,
        animate_in_place=True,
    )


async def fetch_tripo_task_usage(task_id: str) -> Optional[dict]:
    api_key = os.getenv("TRIPO_API_KEY", "")
    if not api_key.startswith("tsk_"):
        return None
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        response = await client.get(
            f"{TRIPO_API_BASE_URL}/task/{task_id}",
            headers={"Authorization": f"Bearer {api_key}"},
        )
        response.raise_for_status()
    data = response.json().get("data") or {}
    consumed = data.get("consumed_credit")
    if consumed is None:
        return None
    return {
        "task_type": str(data.get("type") or "unknown"),
        "consumed_credit": max(0, int(consumed)),
    }


async def record_task_usage(job_id: str, task_id: Optional[str]) -> None:
    if not task_id:
        return
    with connect_db() as db:
        existing = db.execute(
            "SELECT task_id FROM tripo_task_usage WHERE task_id = ?",
            (task_id,),
        ).fetchone()
    if existing:
        return
    try:
        usage = await fetch_tripo_task_usage(task_id)
    except Exception:  # noqa: BLE001 - billing telemetry must not fail conversion
        return
    if not usage:
        return
    with connect_db() as db:
        db.execute(
            """
            INSERT INTO tripo_task_usage (
                task_id, job_id, task_type, consumed_credit, recorded_at
            ) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (task_id) DO NOTHING
            """,
            (
                task_id,
                job_id,
                usage["task_type"],
                usage["consumed_credit"],
                now_iso(),
            ),
        )


job_queue: Optional[asyncio.Queue] = None
worker_tasks: List[asyncio.Task] = []
multiview_gate = asyncio.Semaphore(1)


def update_job(job_id: str, status: str, **fields: object) -> None:
    allowed = {
        "error",
        "glb_url",
        "model_task_id",
        "rig_check_task_id",
        "rig_task_id",
        "animation_task_id",
        "multiview_task_id",
        "fallback_model_task_id",
        "fallback_used",
        "glb_bytes",
        "glb_triangles",
        "glb_animations",
    }
    assignments = ["status = ?", "updated_at = ?", "lease_token = NULL", "lease_until = NULL"]
    values: List[object] = [status, now_iso()]
    for key, value in fields.items():
        if key in allowed:
            assignments.append(f"{key} = ?")
            values.append(value)
    values.append(job_id)
    with connect_db() as db:
        db.execute(
            f"UPDATE conversion_jobs SET {', '.join(assignments)} WHERE id = ?",
            values,
        )
        row = db.execute(
            "SELECT team_id, asset_only FROM conversion_jobs WHERE id = ?",
            (job_id,),
        ).fetchone()
        if row and not row["asset_only"]:
            db.execute(
                "UPDATE teams SET conversion_status = ?, updated_at = ? WHERE id = ?",
                (status, now_iso(), row["team_id"]),
            )


def reserve_multiview_slot(job_id: str) -> bool:
    """Atomically reserve the single provider multiview generation slot."""
    timestamp = now_iso()
    with connect_db() as db:
        if db.postgres:
            db.execute("SELECT pg_advisory_xact_lock(73190326)")
        active = db.execute(
            """
            SELECT COUNT(*) AS count FROM conversion_jobs
            WHERE status IN ('multiview_starting', 'multiview_generating')
              AND id != ?
            """,
            (job_id,),
        ).fetchone()["count"]
        if active:
            return False
        reserved = db.execute(
            """
            UPDATE conversion_jobs
            SET status = 'multiview_starting', fallback_used = 1, updated_at = ?
            WHERE id = ? AND status = 'rig_check'
            """,
            (timestamp, job_id),
        )
        if reserved.rowcount != 1:
            return False
        team = db.execute(
            "SELECT team_id, asset_only FROM conversion_jobs WHERE id = ?",
            (job_id,),
        ).fetchone()
        if team and not team["asset_only"]:
            db.execute(
                "UPDATE teams SET conversion_status = 'multiview_starting', updated_at = ? WHERE id = ?",
                (timestamp, team["team_id"]),
            )
    return True


def model_blob_path(job: dict) -> str:
    if job.get("asset_only"):
        return f"model-assets/{job['id']}/model.glb"
    return f"teams/{job['team_id']}/models/{job['id']}.glb"


async def upload_generated_glb(job: dict, source_url: str) -> tuple[str, dict]:
    async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
        contents = bytearray()
        async with client.stream("GET", source_url) as response:
            response.raise_for_status()
            async for chunk in response.aiter_bytes():
                contents.extend(chunk)
                if len(contents) > MAX_GLB_BYTES:
                    raise ValueError(
                        f"GLB는 {MAX_GLB_BYTES // (1024 * 1024)}MB 이하여야 합니다"
                    )
    glb = bytes(contents)
    metrics = inspect_animated_glb(glb, minimum_animations=2)
    url = await put_public_blob(
        model_blob_path(job),
        glb,
        content_type="model/gltf-binary",
        multipart=True,
    )
    return url, metrics


def final_model_url(task: Any) -> Optional[str]:
    return task.output.model or task.output.pbr_model or task.output.base_model


async def activate_generated_model(job: dict, glb_url: str, metrics: dict) -> None:
    timestamp = now_iso()
    with connect_db() as db:
        db.execute(
            """
            INSERT INTO model_assets (
                id, name, source_image_url, glb_url, pipeline_profile,
                glb_bytes, glb_triangles, glb_animations, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET
                name = excluded.name,
                source_image_url = excluded.source_image_url,
                glb_url = excluded.glb_url,
                pipeline_profile = excluded.pipeline_profile,
                glb_bytes = excluded.glb_bytes,
                glb_triangles = excluded.glb_triangles,
                glb_animations = excluded.glb_animations,
                updated_at = excluded.updated_at
            """,
            (
                job["id"],
                job.get("asset_name") or f"{job['team_id']}조 생성 모델",
                job.get("source_image_url"),
                glb_url,
                job.get("pipeline_profile") or DEFAULT_PIPELINE_PROFILE,
                metrics["bytes"],
                metrics["triangles"],
                metrics["animations"],
                job.get("created_at") or timestamp,
                timestamp,
            ),
        )
        if not job.get("asset_only"):
            get_team_or_404(db, job["team_id"])
            db.execute(
                """
                UPDATE teams SET model_url = ?, model_asset_id = ?,
                    conversion_status = 'done', updated_at = ? WHERE id = ?
                """,
                (glb_url, job["id"], timestamp, job["team_id"]),
            )
    update_job(
        job["id"],
        "done",
        glb_url=glb_url,
        glb_bytes=metrics["bytes"],
        glb_triangles=metrics["triangles"],
        glb_animations=metrics["animations"],
    )


async def run_pipeline(job_id: str) -> None:
    with connect_db() as db:
        row = db.execute("SELECT * FROM conversion_jobs WHERE id = ?", (job_id,)).fetchone()
    if not row:
        return
    job = row_dict(row)
    api_key = os.getenv("TRIPO_API_KEY", "")
    if not api_key.startswith("tsk_"):
        update_job(job_id, "failed", error="TRIPO_API_KEY에 tsk_로 시작하는 OpenAPI 키가 필요합니다")
        return

    try:
        async with TripoClient() as client:
            update_job(job_id, "modeling")
            profile = job.get("pipeline_profile") or DEFAULT_PIPELINE_PROFILE
            model_task_id = await create_image_model_task(
                client,
                job["image_path"],
                profile,
            )
            update_job(job_id, "modeling", model_task_id=model_task_id)
            model = await client.wait_for_task(model_task_id)
            await record_task_usage(job_id, model_task_id)
            if model.status != TaskStatus.SUCCESS:
                raise RuntimeError(task_failure_message(model, "3D 모델 생성에 실패했습니다"))

            update_job(job_id, "rig_check")
            check_task_id = await client.check_riggable(model_task_id)
            update_job(job_id, "rig_check", rig_check_task_id=check_task_id)
            check = await client.wait_for_task(check_task_id)
            await record_task_usage(job_id, check_task_id)
            active_model_task_id = model_task_id
            if check.status != TaskStatus.SUCCESS:
                raise RuntimeError(task_failure_message(check, "리깅 가능 여부 확인에 실패했습니다"))
            if not check.output.riggable:
                if not ENABLE_MULTIVIEW_FALLBACK:
                    raise RuntimeError(
                        "사람형 뼈대를 인식하지 못했습니다. 팔다리가 보이도록 다시 촬영해주세요"
                    )
                async with multiview_gate:
                    update_job(job_id, "multiview_generating", fallback_used=1)
                    multiview_task_id = await client.generate_multiview_image(job["image_path"])
                    update_job(
                        job_id,
                        "multiview_generating",
                        multiview_task_id=multiview_task_id,
                        fallback_used=1,
                    )
                    multiview = await client.wait_for_task(multiview_task_id)
                await record_task_usage(job_id, multiview_task_id)
                if multiview.status != TaskStatus.SUCCESS:
                    raise RuntimeError(
                        task_failure_message(multiview, "멀티뷰 이미지 생성에 실패했습니다")
                    )

                update_job(job_id, "multiview_modeling", fallback_used=1)
                fallback_model_task_id = await create_multiview_model_task(
                    client,
                    multiview_task_id,
                    profile,
                )
                update_job(
                    job_id,
                    "multiview_modeling",
                    fallback_model_task_id=fallback_model_task_id,
                    fallback_used=1,
                )
                fallback_model = await client.wait_for_task(fallback_model_task_id)
                await record_task_usage(job_id, fallback_model_task_id)
                if fallback_model.status != TaskStatus.SUCCESS:
                    raise RuntimeError(
                        task_failure_message(fallback_model, "멀티뷰 3D 생성에 실패했습니다")
                    )
                active_model_task_id = fallback_model_task_id

                update_job(job_id, "rig_check", fallback_used=1)
                check_task_id = await client.check_riggable(active_model_task_id)
                update_job(job_id, "rig_check", rig_check_task_id=check_task_id, fallback_used=1)
                check = await client.wait_for_task(check_task_id)
                await record_task_usage(job_id, check_task_id)
                if check.status != TaskStatus.SUCCESS or not check.output.riggable:
                    raise RuntimeError(
                        "멀티뷰 재생성 후에도 사람형 뼈대를 인식하지 못했습니다. "
                        "팔다리가 보이도록 다시 촬영해주세요"
                    )

            update_job(job_id, "rigging")
            rig_task_id = await create_rig_task(client, active_model_task_id)
            update_job(job_id, "rigging", rig_task_id=rig_task_id)
            rig = await client.wait_for_task(rig_task_id)
            await record_task_usage(job_id, rig_task_id)
            if rig.status != TaskStatus.SUCCESS:
                raise RuntimeError(task_failure_message(rig, "자동 리깅에 실패했습니다"))

            update_job(job_id, "animating")
            animation_task_id = await create_animation_task(client, rig_task_id)
            update_job(job_id, "animating", animation_task_id=animation_task_id)
            animation = await client.wait_for_task(animation_task_id)
            await record_task_usage(job_id, animation_task_id)
            if animation.status != TaskStatus.SUCCESS:
                raise RuntimeError(task_failure_message(animation, "대기·걷기 적용에 실패했습니다"))

            output_dir = MODELS_DIR / (
                f"asset-{job['id']}" if job.get("asset_only") else f"team-{job['team_id']}"
            )
            output_dir.mkdir(parents=True, exist_ok=True)
            files = await client.download_task_models(animation, str(output_dir))
            glb_path = next(
                (Path(path) for path in files.values() if path and str(path).lower().endswith(".glb")),
                None,
            )
            if glb_path is None:
                raise RuntimeError("완성된 GLB 파일을 찾지 못했습니다")
            glb_contents = glb_path.read_bytes()
            metrics = inspect_animated_glb(glb_contents, minimum_animations=2)
            if blob_configured():
                glb_url = await put_public_blob(
                    model_blob_path(job),
                    glb_contents,
                    content_type="model/gltf-binary",
                    multipart=True,
                )
            else:
                folder = f"asset-{job['id']}" if job.get("asset_only") else f"team-{job['team_id']}"
                glb_url = f"/static/models/{folder}/{glb_path.name}"
            await activate_generated_model(job, glb_url, metrics)
    except Exception as exc:  # noqa: BLE001 - user-facing job boundary
        update_job(job_id, "failed", error=str(exc))


async def advance_serverless_job(job_id: str) -> None:
    """Advance one non-blocking Tripo stage whenever the admin polls a job."""
    with connect_db() as db:
        row = db.execute("SELECT * FROM conversion_jobs WHERE id = ?", (job_id,)).fetchone()
    if not row or row["status"] in {"done", "failed"}:
        return

    job = row_dict(row)
    claim_token = uuid.uuid4().hex
    claim_time = now_iso()
    lease_until = (datetime.now(timezone.utc) + timedelta(seconds=45)).isoformat()
    with connect_db() as db:
        if job["status"] == "queued":
            if db.postgres:
                # Serialize slot allocation across independent Vercel instances.
                db.execute("SELECT pg_advisory_xact_lock(73190325)")
            active_count = db.execute(
                """
                SELECT COUNT(*) AS count FROM conversion_jobs
                WHERE status NOT IN ('done', 'failed')
                  AND (
                    status != 'queued'
                    OR (lease_token IS NOT NULL AND lease_until >= ?)
                  )
                """,
                (claim_time,),
            ).fetchone()["count"]
            if active_count >= WORKER_COUNT:
                return
        claimed = db.execute(
            """
            UPDATE conversion_jobs SET lease_token = ?, lease_until = ?
            WHERE id = ? AND updated_at = ? AND status = ?
              AND (lease_until IS NULL OR lease_until < ?)
            """,
            (
                claim_token,
                lease_until,
                job_id,
                job["updated_at"],
                job["status"],
                claim_time,
            ),
        )
        if claimed.rowcount != 1:
            return
    task_ids = {
        "modeling": job.get("model_task_id"),
        "rig_check": job.get("rig_check_task_id"),
        "rigging": job.get("rig_task_id"),
        "animating": job.get("animation_task_id"),
        "multiview_generating": job.get("multiview_task_id"),
        "multiview_modeling": job.get("fallback_model_task_id"),
    }

    try:
        async with TripoClient() as client:
            profile = job.get("pipeline_profile") or DEFAULT_PIPELINE_PROFILE
            if job["status"] == "queued":
                model_id = await create_image_model_task(client, job["image_path"], profile)
                update_job(job_id, "modeling", model_task_id=model_id)
                return

            if job["status"] == "multiview_starting":
                multiview_id = await client.generate_multiview_image(job["image_path"])
                update_job(
                    job_id,
                    "multiview_generating",
                    multiview_task_id=multiview_id,
                    fallback_used=1,
                )
                return

            task_id = task_ids.get(job["status"])
            if not task_id:
                raise RuntimeError("변환 작업 단계 정보가 누락되었습니다")
            task = await client.get_task(task_id)
            if task.status in {TaskStatus.QUEUED, TaskStatus.RUNNING}:
                return
            await record_task_usage(job_id, task_id)
            if task.status != TaskStatus.SUCCESS:
                raise RuntimeError(
                    task_failure_message(task, f"{job['status']} 단계에 실패했습니다")
                )

            if job["status"] == "modeling":
                check_id = await client.check_riggable(job["model_task_id"])
                update_job(job_id, "rig_check", rig_check_task_id=check_id)
                return

            if job["status"] == "rig_check":
                if not task.output.riggable:
                    if ENABLE_MULTIVIEW_FALLBACK and not job.get("fallback_used"):
                        if not reserve_multiview_slot(job_id):
                            return
                        multiview_id = await client.generate_multiview_image(job["image_path"])
                        update_job(
                            job_id,
                            "multiview_generating",
                            multiview_task_id=multiview_id,
                            fallback_used=1,
                        )
                        return
                    raise RuntimeError(
                        "멀티뷰 재생성 후에도 사람형 뼈대를 인식하지 못했습니다. "
                        "팔다리가 보이도록 다시 촬영해주세요"
                        if job.get("fallback_used")
                        else "사람형 뼈대를 인식하지 못했습니다. 팔다리가 보이도록 다시 촬영해주세요"
                    )
                active_model_id = job.get("fallback_model_task_id") or job["model_task_id"]
                rig_id = await create_rig_task(client, active_model_id)
                update_job(job_id, "rigging", rig_task_id=rig_id)
                return

            if job["status"] == "multiview_generating":
                fallback_model_id = await create_multiview_model_task(
                    client,
                    job["multiview_task_id"],
                    profile,
                )
                update_job(
                    job_id,
                    "multiview_modeling",
                    fallback_model_task_id=fallback_model_id,
                    fallback_used=1,
                )
                return

            if job["status"] == "multiview_modeling":
                check_id = await client.check_riggable(job["fallback_model_task_id"])
                update_job(
                    job_id,
                    "rig_check",
                    rig_check_task_id=check_id,
                    fallback_used=1,
                )
                return

            if job["status"] == "rigging":
                animation_id = await create_animation_task(client, job["rig_task_id"])
                update_job(job_id, "animating", animation_task_id=animation_id)
                return

            source_url = final_model_url(task)
            if not source_url:
                raise RuntimeError("완성된 GLB 다운로드 주소를 찾지 못했습니다")
            glb_url, metrics = await upload_generated_glb(job, source_url)
            await activate_generated_model(job, glb_url, metrics)
    except Exception as exc:  # noqa: BLE001 - user-facing job boundary
        update_job(job_id, "failed", error=str(exc))
    finally:
        with connect_db() as db:
            db.execute(
                """
                UPDATE conversion_jobs SET lease_token = NULL, lease_until = NULL
                WHERE id = ? AND lease_token = ?
                """,
                (job_id, claim_token),
            )


async def conversion_worker() -> None:
    assert job_queue is not None
    while True:
        job_id = await job_queue.get()
        try:
            await run_pipeline(job_id)
        finally:
            job_queue.task_done()


@asynccontextmanager
async def lifespan(_: FastAPI):
    global job_queue, worker_tasks
    init_db()
    if SERVERLESS_RUNTIME:
        yield
        return
    job_queue = asyncio.Queue()
    with connect_db() as db:
        stale = db.execute(
            "SELECT id FROM conversion_jobs WHERE status NOT IN ('done', 'failed') ORDER BY created_at"
        ).fetchall()
        db.execute(
            "UPDATE conversion_jobs SET status = 'queued', updated_at = ? WHERE status NOT IN ('done', 'failed')",
            (now_iso(),),
        )
    for row in stale:
        await job_queue.put(row["id"])
    worker_tasks = [asyncio.create_task(conversion_worker()) for _ in range(WORKER_COUNT)]
    yield
    for task in worker_tasks:
        task.cancel()
    await asyncio.gather(*worker_tasks, return_exceptions=True)


app = FastAPI(title="Peter3D Retreat", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin for origin in os.getenv("PETER3D_ALLOWED_ORIGINS", "http://localhost:8000").split(",") if origin],
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory=ROOT / "static", check_dir=not SERVERLESS_RUNTIME), name="static")
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")


def frontend_index() -> FileResponse:
    index_path = FRONTEND_DIST / "index.html"
    if not index_path.is_file():
        raise HTTPException(
            status_code=503,
            detail="React 화면이 빌드되지 않았습니다. frontend에서 npm run build를 실행하세요.",
        )
    return FileResponse(index_path)


@app.get("/")
async def world_page():
    return frontend_index()


@app.get("/admin")
async def admin_page():
    return frontend_index()


@app.get("/world-3d")
async def legacy_world_page():
    return frontend_index()


@app.get("/api/health")
async def health():
    api_key = os.getenv("TRIPO_API_KEY", "")
    openai_key = os.getenv("OPENAI_API_KEY", "")
    persistent = using_postgres() and blob_configured()
    return {
        "ok": True,
        "workers": 0 if SERVERLESS_RUNTIME else WORKER_COUNT,
        "tripo_configured": api_key.startswith("tsk_"),
        "openai_configured": openai_key.startswith("sk-"),
        "openai_image_model": OPENAI_IMAGE_MODEL,
        "openai_image_quality": OPENAI_IMAGE_QUALITY,
        "persistent_storage": persistent if SERVERLESS_RUNTIME else True,
        "database": "postgres" if using_postgres() else "sqlite",
        "object_storage": "vercel-blob" if blob_configured() else "local",
    }


async def sync_recent_task_usage(limit: int = 25) -> None:
    task_columns = (
        "model_task_id",
        "rig_check_task_id",
        "rig_task_id",
        "animation_task_id",
        "multiview_task_id",
        "fallback_model_task_id",
    )
    with connect_db() as db:
        jobs = db.execute(
            "SELECT * FROM conversion_jobs ORDER BY created_at DESC LIMIT 25"
        ).fetchall()
        recorded = {
            row["task_id"] for row in db.execute("SELECT task_id FROM tripo_task_usage").fetchall()
        }
    pending = []
    for row in jobs:
        for column in task_columns:
            task_id = row[column]
            if task_id and task_id not in recorded:
                pending.append((row["id"], task_id))
                recorded.add(task_id)
                if len(pending) >= limit:
                    break
        if len(pending) >= limit:
            break
    await asyncio.gather(
        *(record_task_usage(job_id, task_id) for job_id, task_id in pending),
        return_exceptions=True,
    )


@app.get("/api/tripo/billing")
async def tripo_billing():
    configured = os.getenv("TRIPO_API_KEY", "").startswith("tsk_")
    await sync_recent_task_usage()
    with connect_db() as db:
        tracked = db.execute(
            "SELECT COALESCE(SUM(consumed_credit), 0) AS total FROM tripo_task_usage"
        ).fetchone()["total"]
    result = {
        "configured": configured,
        "balance": None,
        "frozen": None,
        "tracked_credits": int(tracked or 0),
        "workers": WORKER_COUNT,
        "rig_version": TRIPO_RIG_VERSION,
        "profiles": [
            {
                "id": profile_id,
                "label": config["label"],
                "description": config["description"],
                "estimated_credits": config["estimated_credits"],
            }
            for profile_id, config in PIPELINE_PROFILES.items()
        ],
    }
    if not configured:
        return result
    try:
        async with TripoClient() as client:
            balance = await client.get_balance()
        result.update(balance=balance.balance, frozen=balance.frozen)
    except Exception as exc:  # noqa: BLE001 - admin telemetry remains available
        result["error"] = str(exc)
    return result


@app.get("/api/teams")
async def list_teams():
    with connect_db() as db:
        rows = db.execute(
            "SELECT * FROM teams WHERE id <= ? ORDER BY id",
            (TEAM_COUNT,),
        ).fetchall()
        return [public_team(row) for row in rows]


@app.get("/api/seating-presets")
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


@app.post("/api/seating-presets", status_code=201)
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


@app.put("/api/seating-presets/active")
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


@app.put("/api/seating-presets/{preset_id}")
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


@app.delete("/api/seating-presets/{preset_id}")
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


@app.get("/api/teams/{team_id}")
async def get_team(team_id: int):
    with connect_db() as db:
        return public_team(get_team_or_404(db, team_id))


@app.patch("/api/teams/{team_id}")
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


@app.get("/api/teams/{team_id}/history")
async def team_history(team_id: int):
    with connect_db() as db:
        get_team_or_404(db, team_id)
        rows = db.execute(
            "SELECT * FROM growth_events WHERE team_id = ? ORDER BY id DESC LIMIT 30",
            (team_id,),
        ).fetchall()
        return [row_dict(row) for row in rows]


@app.post("/api/teams/{team_id}/growth")
async def add_growth(team_id: int, payload: GrowthCreate):
    invalid = set(payload.stats) - set(STAT_KEYS)
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
        for key in STAT_KEYS:
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


def ensure_conversion_available(pipeline_profile: str) -> None:
    api_key = os.getenv("TRIPO_API_KEY", "")
    if SERVERLESS_RUNTIME and not (using_postgres() and blob_configured()):
        raise HTTPException(
            status_code=503,
            detail="Neon Postgres와 Vercel Blob 연결이 필요합니다.",
        )
    if SERVERLESS_RUNTIME and not api_key.startswith("tsk_"):
        raise HTTPException(status_code=503, detail="TRIPO_API_KEY가 설정되지 않았습니다")
    if pipeline_profile not in PIPELINE_PROFILES:
        raise HTTPException(status_code=422, detail="지원하지 않는 변환 프로필입니다")


async def validated_image_upload(image: UploadFile) -> tuple[bytes, str, str]:
    content_type = (image.content_type or "").lower()
    extensions = {"image/png": ".png", "image/jpeg": ".jpg"}
    if content_type not in extensions:
        raise HTTPException(status_code=415, detail="PNG 또는 JPG 이미지만 업로드할 수 있습니다")
    contents = await image.read(MAX_UPLOAD_BYTES + 1)
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="이미지는 10MB 이하여야 합니다")
    if not contents:
        raise HTTPException(status_code=422, detail="빈 파일은 업로드할 수 없습니다")
    signatures = {
        "image/png": contents.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg": contents.startswith(b"\xff\xd8\xff"),
    }
    if not signatures[content_type]:
        raise HTTPException(status_code=422, detail="파일 내용이 올바른 이미지 형식이 아닙니다")
    return contents, content_type, extensions[content_type]


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


def validate_showcase_sprite_png(sprite: bytes) -> tuple[int, int]:
    if (
        len(sprite) < 24
        or not sprite.startswith(b"\x89PNG\r\n\x1a\n")
        or sprite[12:16] != b"IHDR"
    ):
        raise ValueError("PNG 헤더가 올바르지 않습니다")

    width, height = struct.unpack(">II", sprite[16:24])
    if (width, height) != (SHOWCASE_SPRITE_WIDTH, SHOWCASE_SPRITE_HEIGHT):
        raise ValueError(
            f"스프라이트 크기는 {SHOWCASE_SPRITE_SIZE}여야 합니다 "
            f"(현재 {width}x{height})"
        )

    cell_width = width // SHOWCASE_SPRITE_COLUMNS
    cell_height = height // SHOWCASE_SPRITE_ROWS
    if (
        width % SHOWCASE_SPRITE_COLUMNS
        or height % SHOWCASE_SPRITE_ROWS
        or cell_width != cell_height
    ):
        raise ValueError("4x3 스프라이트의 각 셀은 동일한 정사각형이어야 합니다")
    return width, height


def _median(values: list[int]) -> int:
    ordered = sorted(values)
    if not ordered:
        return 0
    return ordered[len(ordered) // 2]


def _sprite_foreground_mask(cell: Image.Image) -> tuple[Image.Image, tuple[int, int, int], int]:
    rgb = cell.convert("RGB")
    width, height = rgb.size
    border = max(3, round(min(width, height) * 0.018))
    samples: list[tuple[int, int, int]] = []
    pixels = rgb.load()
    for x in range(0, width, 3):
        for y in (*range(0, border), *range(height - border, height)):
            samples.append(pixels[x, y])
    for y in range(border, height - border, 3):
        for x in (*range(0, border), *range(width - border, width)):
            samples.append(pixels[x, y])
    background = tuple(
        _median([sample[channel] for sample in samples])
        for channel in range(3)
    )
    border_distances = [
        round(sum((sample[channel] - background[channel]) ** 2 for channel in range(3)) ** 0.5)
        for sample in samples
    ]
    threshold = max(24, min(58, _median(border_distances) + 18))
    mask = Image.new("L", rgb.size, 0)
    mask_pixels = mask.load()
    for y in range(height):
        for x in range(width):
            pixel = pixels[x, y]
            distance = sum(
                (pixel[channel] - background[channel]) ** 2 for channel in range(3)
            ) ** 0.5
            if distance >= threshold:
                mask_pixels[x, y] = 255
    return mask.filter(ImageFilter.MedianFilter(3)), background, threshold


def analyze_showcase_sprite_pixels(sprite: bytes) -> dict:
    """Measure every cell so obvious clipping never depends on an AI opinion."""
    try:
        atlas = Image.open(io.BytesIO(sprite)).convert("RGB")
        atlas.load()
    except (UnidentifiedImageError, OSError, ValueError):
        return {
            "status": "failed",
            "summary": "스프라이트 픽셀을 읽을 수 없어 안전한 애니메이션인지 확인할 수 없습니다.",
            "can_approve": False,
            "frames": [],
            "issues": ["스프라이트 픽셀 디코딩 실패"],
        }

    width, height = atlas.size
    if (width, height) != (SHOWCASE_SPRITE_WIDTH, SHOWCASE_SPRITE_HEIGHT):
        return {
            "status": "failed",
            "summary": "스프라이트 캔버스 규격이 달라 프레임을 안전하게 나눌 수 없습니다.",
            "can_approve": False,
            "frames": [],
            "issues": [f"캔버스 {width}x{height}, 필요 {SHOWCASE_SPRITE_SIZE}"],
        }

    cell_width = width // SHOWCASE_SPRITE_COLUMNS
    cell_height = height // SHOWCASE_SPRITE_ROWS
    frames: list[dict] = []
    baseline_by_row: dict[int, list[int]] = {}
    failed_frames = 0
    warning_frames = 0

    for row in range(SHOWCASE_SPRITE_ROWS):
        for column in range(SHOWCASE_SPRITE_COLUMNS):
            frame_number = row * SHOWCASE_SPRITE_COLUMNS + column + 1
            cell = atlas.crop((
                column * cell_width,
                row * cell_height,
                (column + 1) * cell_width,
                (row + 1) * cell_height,
            ))
            mask, background, threshold = _sprite_foreground_mask(cell)
            bbox = mask.getbbox()
            issues: list[str] = []
            status = "passed"
            margins: dict[str, int] | None = None
            coverage = sum(mask.getdata()) / 255 / (cell_width * cell_height)
            if bbox is None or coverage < 0.025:
                status = "failed"
                issues.append("캐릭터 전신을 찾지 못함")
            else:
                left, top, right, bottom = bbox
                margins = {
                    "left": left,
                    "top": top,
                    "right": cell_width - right,
                    "bottom": cell_height - bottom,
                }
                baseline_by_row.setdefault(row, []).append(bottom)
                unsafe = [
                    edge for edge, value in margins.items()
                    if value < SHOWCASE_FRAME_SAFE_MARGIN
                ]
                if unsafe:
                    status = "failed"
                    korean_edges = {
                        "left": "왼쪽", "top": "위쪽", "right": "오른쪽", "bottom": "아래쪽",
                    }
                    issues.append(
                        f"{', '.join(korean_edges[edge] for edge in unsafe)} 여백 부족"
                    )
                elif min(margins.values()) < SHOWCASE_FRAME_SAFE_MARGIN + 8:
                    status = "warning"
                    issues.append("프레임 경계와 캐릭터가 가까움")
                if coverage > 0.72:
                    status = "failed"
                    issues.append("캐릭터 또는 배경이 셀 대부분을 차지함")

            if status == "failed":
                failed_frames += 1
            elif status == "warning":
                warning_frames += 1
            frames.append({
                "frame": frame_number,
                "row": row + 1,
                "column": column + 1,
                "status": status,
                "bbox": list(bbox) if bbox else None,
                "margins": margins,
                "coverage": round(coverage, 4),
                "background": list(background),
                "threshold": threshold,
                "issues": issues,
            })

    baseline_issues = []
    for row, baselines in baseline_by_row.items():
        if baselines and max(baselines) - min(baselines) > 14:
            baseline_issues.append(
                f"{row + 1}행 발 기준선 편차 {max(baselines) - min(baselines)}px"
            )
    if failed_frames:
        status = "failed"
        summary = f"{failed_frames}개 프레임에서 전신 잘림 위험을 찾았습니다."
    elif warning_frames or baseline_issues:
        status = "warning"
        summary = "전신은 확인됐지만 관리자 확인이 필요한 프레임이 있습니다."
    else:
        status = "passed"
        summary = "12개 프레임 모두 머리부터 발끝까지 안전 여백 안에 있습니다."
    return {
        "status": status,
        "summary": summary,
        "can_approve": status != "failed",
        "safe_margin_px": SHOWCASE_FRAME_SAFE_MARGIN,
        "frames": frames,
        "issues": baseline_issues,
    }


def _response_output_text(payload: dict) -> str:
    for item in payload.get("output") or []:
        if item.get("type") != "message":
            continue
        for content in item.get("content") or []:
            if content.get("type") == "output_text" and isinstance(content.get("text"), str):
                return content["text"]
    raise ValueError("Responses API 응답에서 텍스트를 찾지 못했습니다")


async def request_showcase_sprite_ai_review(sprite: bytes, deterministic: dict) -> dict:
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key.startswith("sk-"):
        return {
            "status": "unavailable",
            "summary": "AI 시각 검수를 실행할 API 키가 없습니다.",
            "issues": [],
            "frames": [],
            "model": OPENAI_SPRITE_QA_MODEL,
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
        SHOWCASE_SPRITE_QA_PROMPT
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
    if SHOWCASE_MASTER_PATH.is_file():
        content.append({
            "type": "input_image",
            "image_url": (
                "data:image/png;base64,"
                + base64.b64encode(SHOWCASE_MASTER_PATH.read_bytes()).decode("ascii")
            ),
            "detail": "high",
        })
    body = {
        "model": OPENAI_SPRITE_QA_MODEL,
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
        async with httpx.AsyncClient(timeout=httpx.Timeout(75.0, connect=10.0)) as client:
            response = await client.post(
                OPENAI_RESPONSES_API_URL,
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
                "model": OPENAI_SPRITE_QA_MODEL,
            }
        review = json.loads(_response_output_text(response.json()))
        review["model"] = OPENAI_SPRITE_QA_MODEL
        return review
    except (httpx.HTTPError, json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        return {
            "status": "unavailable",
            "summary": f"AI 시각 검수를 완료하지 못했습니다: {str(exc)[:160]}",
            "issues": [],
            "frames": [],
            "model": OPENAI_SPRITE_QA_MODEL,
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
    if SHOWCASE_MASTER_PATH.is_file():
        files.append((
            "image[]",
            ("fixed-peter-master.png", SHOWCASE_MASTER_PATH.read_bytes(), "image/png"),
        ))
    prompt = SHOWCASE_SPRITE_PROMPT
    if correction:
        prompt += (
            "\n\nCORRECTION REQUIRED AFTER THE PREVIOUS QA REVIEW:\n"
            + correction[:1800]
            + "\nFix these issues while preserving every requirement above."
        )
    data = {
        "model": OPENAI_IMAGE_MODEL,
        "prompt": prompt,
        "size": SHOWCASE_SPRITE_SIZE,
        "quality": OPENAI_IMAGE_QUALITY,
        "output_format": "png",
        "background": "opaque",
        "n": "1",
    }
    if OPENAI_IMAGE_MODEL == "gpt-image-1":
        data["input_fidelity"] = OPENAI_IMAGE_INPUT_FIDELITY
    try:
        timeout = httpx.Timeout(150.0, connect=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                OPENAI_IMAGE_API_URL,
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
    if len(sprite) > MAX_SPRITE_BYTES:
        raise HTTPException(status_code=502, detail="AI 스프라이트 파일이 너무 큽니다")
    try:
        validate_showcase_sprite_png(sprite)
    except ValueError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"AI 스프라이트 규격이 올바르지 않습니다: {exc}",
        ) from exc
    return sprite


async def persist_showcase_sprite(team_id: int, sprite: bytes) -> str:
    sprite_id = uuid.uuid4().hex[:12]
    if blob_configured():
        return await put_public_blob(
            f"teams/{team_id}/sprites/showcase-{sprite_id}.png",
            sprite,
            content_type="image/png",
        )
    if SERVERLESS_RUNTIME:
        raise HTTPException(
            status_code=503,
            detail="배포 환경에서 AI 스프라이트를 저장하려면 Vercel Blob 연결이 필요합니다",
        )
    filename = f"team-{team_id}-sprite-{sprite_id}.png"
    (UPLOADS_DIR / filename).write_bytes(sprite)
    return f"/uploads/{filename}"


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
                    OPENAI_IMAGE_MODEL,
                    quality.get("status", "unchecked") if quality else "unchecked",
                    json.dumps(quality, ensure_ascii=False) if quality else None,
                    OPENAI_SPRITE_QA_MODEL if quality else None,
                    timestamp,
                    timestamp,
                    team_id,
                ),
            )
        return public_team(get_team_or_404(db, team_id))


@app.post("/api/teams/{team_id}/image")
async def upload_team_image(team_id: int, image: UploadFile = File(...)):
    if SERVERLESS_RUNTIME and not blob_configured():
        raise HTTPException(
            status_code=503,
            detail="배포 환경에서 캐릭터 사진을 저장하려면 Vercel Blob 연결이 필요합니다",
        )
    with connect_db() as db:
        previous_team = row_dict(get_team_or_404(db, team_id))
    contents, content_type, extension = await validated_image_upload(image)

    image_id = uuid.uuid4().hex[:12]
    filename = f"team-{team_id}-showcase-{image_id}{extension}"
    image_path = UPLOADS_DIR / filename
    if blob_configured():
        image_url = await put_public_blob(
            f"teams/{team_id}/images/showcase-{image_id}{extension}",
            contents,
            content_type=content_type,
        )
        if not SERVERLESS_RUNTIME:
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


@app.post("/api/teams/{team_id}/showcase-sprite")
async def generate_showcase_sprite(team_id: int, reference: UploadFile = File(...)):
    if SERVERLESS_RUNTIME and not blob_configured():
        raise HTTPException(
            status_code=503,
            detail="배포 환경에서 AI 스프라이트를 저장하려면 Vercel Blob 연결이 필요합니다",
        )
    with connect_db() as db:
        previous_team = row_dict(get_team_or_404(db, team_id))
    if not previous_team["showcase_image_url"]:
        raise HTTPException(status_code=409, detail="먼저 이 조의 2D 캐릭터 사진을 등록해주세요")

    contents, content_type, _ = await validated_image_upload(reference)
    correction = ""
    previous_quality = previous_team.get("showcase_sprite_quality_json")
    if previous_quality:
        try:
            quality_payload = json.loads(previous_quality)
            correction = json.dumps({
                "summary": quality_payload.get("summary"),
                "pixel_issues": quality_payload.get("deterministic", {}).get("issues", []),
                "ai_issues": quality_payload.get("ai", {}).get("issues", []),
                "failed_frames": [
                    frame
                    for frame in quality_payload.get("deterministic", {}).get("frames", [])
                    if frame.get("status") == "failed"
                ],
                "ai_frames": quality_payload.get("ai", {}).get("frames", []),
            }, ensure_ascii=False)
        except (json.JSONDecodeError, TypeError):
            correction = ""
    update_showcase_sprite_status(team_id, "generating", error=None)
    try:
        sprite = await request_showcase_sprite(
            contents,
            content_type,
            reference.filename or "peter-reference.png",
            correction=correction,
        )
        quality = await inspect_showcase_sprite_quality(sprite)
        sprite_url = await persist_showcase_sprite(team_id, sprite)
        updated = update_showcase_sprite_status(
            team_id,
            "review",
            url=sprite_url,
            error=None,
            quality=quality,
        )
    except HTTPException as exc:
        update_showcase_sprite_status(team_id, "failed", error=str(exc.detail)[:300])
        raise
    except Exception as exc:  # noqa: BLE001 - external generation boundary
        update_showcase_sprite_status(team_id, "failed", error="AI 캐릭터 생성 중 오류가 발생했습니다")
        raise HTTPException(
            status_code=502,
            detail="AI 캐릭터 생성 중 오류가 발생했습니다",
        ) from exc

    previous_url = previous_team["showcase_sprite_url"]
    if (
        previous_url
        and previous_url != sprite_url
        and previous_url != previous_team["showcase_sprite_active_url"]
    ):
        await delete_blob_if_managed(previous_url)
    return updated


@app.post("/api/teams/{team_id}/showcase-sprite/approve")
async def approve_showcase_sprite(
    team_id: int,
    payload: Optional[SpriteApprovalPayload] = None,
):
    force = payload.force if payload else False
    with connect_db() as db:
        team = row_dict(get_team_or_404(db, team_id))
    if not team["showcase_sprite_url"]:
        raise HTTPException(status_code=409, detail="검수할 AI 스프라이트가 없습니다")
    if team["showcase_sprite_status"] not in ("review", "ready"):
        raise HTTPException(status_code=409, detail="생성이 완료된 AI 스프라이트만 승인할 수 있습니다")
    if team["showcase_sprite_status"] == "ready":
        return public_team(team)
    quality = {}
    if team.get("showcase_sprite_quality_json"):
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
        db.execute(
            """
            UPDATE teams
            SET showcase_sprite_active_url = showcase_sprite_url,
                showcase_sprite_status = 'ready',
                showcase_sprite_error = NULL,
                showcase_sprite_updated_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (timestamp, timestamp, team_id),
        )
        return public_team(get_team_or_404(db, team_id))


async def validated_glb_upload(glb: UploadFile) -> tuple[bytes, dict]:
    filename = (glb.filename or "").strip()
    if Path(filename).suffix.lower() != ".glb":
        raise HTTPException(status_code=415, detail=".glb 파일만 등록할 수 있습니다")
    contents = await glb.read(MAX_GLB_BYTES + 1)
    if len(contents) > MAX_GLB_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"GLB는 {MAX_GLB_BYTES // (1024 * 1024)}MB 이하여야 합니다",
        )
    if not contents:
        raise HTTPException(status_code=422, detail="빈 GLB 파일은 등록할 수 없습니다")
    try:
        metrics = inspect_animated_glb(contents)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return contents, metrics


async def persist_uploaded_glb(asset_id: str, contents: bytes) -> str:
    if blob_configured():
        return await put_public_blob(
            f"model-assets/{asset_id}/model.glb",
            contents,
            content_type="model/gltf-binary",
            multipart=True,
        )
    if SERVERLESS_RUNTIME:
        raise HTTPException(status_code=503, detail="Vercel Blob 연결이 필요합니다")

    target = MODELS_DIR / "model-assets" / asset_id / "model.glb"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(contents)
    try:
        public_path = target.resolve().relative_to((ROOT / "static").resolve())
    except ValueError as exc:
        target.unlink(missing_ok=True)
        raise HTTPException(
            status_code=503,
            detail="로컬 모델 폴더가 static 폴더 안에 있어야 합니다",
        ) from exc
    return f"/static/{public_path.as_posix()}"


async def enqueue_conversion(job_id: str) -> None:
    if SERVERLESS_RUNTIME:
        return
    if job_queue is None:
        raise HTTPException(status_code=503, detail="변환 대기열이 준비되지 않았습니다")
    await job_queue.put(job_id)


@app.get("/api/model-assets")
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


@app.post("/api/model-assets/generate", status_code=202)
async def generate_model_asset(
    image: UploadFile = File(...),
    name: str = Form(...),
    pipeline_profile: str = Form(DEFAULT_PIPELINE_PROFILE),
):
    ensure_conversion_available(pipeline_profile)
    asset_name = name.strip()
    if not asset_name or len(asset_name) > 60:
        raise HTTPException(status_code=422, detail="모델 이름은 1~60자로 입력해주세요")
    contents, content_type, extension = await validated_image_upload(image)
    job_id = uuid.uuid4().hex[:12]
    filename = f"asset-{job_id}{extension}"
    image_path = UPLOADS_DIR / filename
    if blob_configured():
        image_url = await put_public_blob(
            f"model-assets/{job_id}/source{extension}",
            contents,
            content_type=content_type,
        )
        if not SERVERLESS_RUNTIME:
            image_path.write_bytes(contents)
    else:
        image_path.write_bytes(contents)
        image_url = f"/uploads/{filename}"
    image_job_source = image_url if SERVERLESS_RUNTIME else str(image_path)
    timestamp = now_iso()
    with connect_db() as db:
        db.execute(
            """
            INSERT INTO conversion_jobs (
                id, team_id, status, image_path, pipeline_profile, asset_only,
                asset_name, source_image_url, created_at, updated_at
            ) VALUES (?, 1, 'queued', ?, ?, 1, ?, ?, ?, ?)
            """,
            (
                job_id, image_job_source, pipeline_profile, asset_name,
                image_url, timestamp, timestamp,
            ),
        )
    await enqueue_conversion(job_id)
    return {"job_id": job_id, "status": "queued", "asset_name": asset_name}


@app.post("/api/model-assets/upload", status_code=201)
async def upload_model_asset(
    glb: UploadFile = File(...),
    name: str = Form(...),
):
    if SERVERLESS_RUNTIME and not (using_postgres() and blob_configured()):
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
            (ROOT / glb_url.removeprefix("/")).unlink(missing_ok=True)
        raise
    asset["team_ids"] = ""
    return public_model_asset(asset)


@app.post("/api/model-assets/{asset_id}/apply")
async def apply_model_asset(asset_id: str, payload: ModelAssetApply):
    team_ids = sorted(set(payload.team_ids))
    if any(team_id < 1 or team_id > TEAM_COUNT for team_id in team_ids):
        raise HTTPException(
            status_code=422,
            detail=f"조 번호는 1~{TEAM_COUNT} 사이여야 합니다",
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


@app.post("/api/teams/{team_id}/convert", status_code=202)
async def convert_team(
    team_id: int,
    image: UploadFile = File(...),
    pipeline_profile: str = Form(DEFAULT_PIPELINE_PROFILE),
):
    ensure_conversion_available(pipeline_profile)
    with connect_db() as db:
        previous_team = row_dict(get_team_or_404(db, team_id))
        active_job = db.execute(
            """
            SELECT id FROM conversion_jobs
            WHERE team_id = ? AND asset_only = 0 AND status NOT IN ('done', 'failed')
            ORDER BY created_at DESC LIMIT 1
            """,
            (team_id,),
        ).fetchone()
    if active_job:
        raise HTTPException(
            status_code=409,
            detail=f"이 조는 이미 변환 작업 {active_job['id']}을 진행 중입니다",
        )
    contents, content_type, extension = await validated_image_upload(image)

    job_id = uuid.uuid4().hex[:12]
    filename = f"team-{team_id}-{job_id}{extension}"
    image_path = UPLOADS_DIR / filename
    if blob_configured():
        image_url = await put_public_blob(
            f"teams/{team_id}/images/{job_id}{extension}",
            contents,
            content_type=content_type,
        )
        if not SERVERLESS_RUNTIME:
            image_path.write_bytes(contents)
    else:
        image_path.write_bytes(contents)
        image_url = f"/uploads/{filename}"
    image_job_source = image_url if SERVERLESS_RUNTIME else str(image_path)
    timestamp = now_iso()
    with connect_db() as db:
        db.execute(
            """
            INSERT INTO conversion_jobs (
                id, team_id, status, image_path, pipeline_profile,
                asset_name, source_image_url, created_at, updated_at
            ) VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?)
            """,
            (
                job_id, team_id, image_job_source, pipeline_profile,
                f"{previous_team['name']} 생성 모델", image_url, timestamp, timestamp,
            ),
        )
        db.execute(
            "UPDATE teams SET image_url = ?, conversion_status = 'queued', updated_at = ? WHERE id = ?",
            (image_url, timestamp, team_id),
        )
    if previous_team["image_url"] != image_url:
        await delete_blob_if_managed(previous_team["image_url"])

    await enqueue_conversion(job_id)
    return {"job_id": job_id, "team_id": team_id, "status": "queued"}


@app.get("/api/jobs")
async def list_jobs():
    if SERVERLESS_RUNTIME:
        with connect_db() as db:
            active = db.execute(
                """
                SELECT id FROM conversion_jobs
                WHERE status NOT IN ('queued', 'done', 'failed')
                ORDER BY updated_at ASC LIMIT ?
                """,
                (WORKER_COUNT,),
            ).fetchall()
            slots = max(0, WORKER_COUNT - len(active))
            queued = db.execute(
                """
                SELECT id FROM conversion_jobs
                WHERE status = 'queued'
                ORDER BY created_at ASC LIMIT ?
                """,
                (slots,),
            ).fetchall() if slots else []
        await asyncio.gather(
            *(advance_serverless_job(row["id"]) for row in [*active, *queued]),
            return_exceptions=True,
        )
    with connect_db() as db:
        rows = db.execute(
            """
            SELECT conversion_jobs.*,
                COALESCE((
                    SELECT SUM(consumed_credit) FROM tripo_task_usage
                    WHERE job_id = conversion_jobs.id
                ), 0) AS credits_used
            FROM conversion_jobs ORDER BY created_at DESC LIMIT 100
            """
        ).fetchall()
        return [public_job(row) for row in rows]


@app.get("/api/jobs/{job_id}")
async def get_job(job_id: str):
    if SERVERLESS_RUNTIME:
        await advance_serverless_job(job_id)
    with connect_db() as db:
        row = db.execute(
            """
            SELECT conversion_jobs.*,
                COALESCE((
                    SELECT SUM(consumed_credit) FROM tripo_task_usage
                    WHERE job_id = conversion_jobs.id
                ), 0) AS credits_used
            FROM conversion_jobs WHERE id = ?
            """,
            (job_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="변환 작업을 찾을 수 없습니다")
        queued_before = db.execute(
            "SELECT COUNT(*) AS count FROM conversion_jobs WHERE status = 'queued' AND created_at < ?",
            (row["created_at"],),
        ).fetchone()["count"]
        result = public_job(row)
        result["queue_position"] = queued_before + 1 if row["status"] == "queued" else 0
        return result


# Keep this mount last so API, generated models, and uploads retain priority.
app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True, check_dir=False), name="frontend")
