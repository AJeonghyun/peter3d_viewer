"""Peter3D retreat kiosk backend.

Serves the Galilee world, stores 25 teams in SQLite or Postgres, and persists
uploaded images and generated GLBs in Vercel Blob when configured.
"""

import asyncio
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
from tripo3d import TaskStatus, TripoClient
from tripo3d.models import RigType

from peter3d_storage import (
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
TRIPO_FACE_LIMIT = max(1_000, min(int(os.getenv("TRIPO_FACE_LIMIT", "40000")), 100_000))
WORKER_COUNT = max(1, min(int(os.getenv("PETER3D_WORKERS", "3")), 5))
SERVERLESS_RUNTIME = os.getenv("PETER3D_SERVERLESS", "0") == "1"
TRIPO_RIG_VERSION = os.getenv("TRIPO_RIG_VERSION", "v1.0-20240301")
TRIPO_IDLE_ANIMATION = "preset:biped:standing_relax"
TRIPO_WALK_ANIMATION = "preset:biped:walk"
TRIPO_API_BASE_URL = os.getenv("TRIPO_API_BASE_URL", "https://api.tripo3d.ai/v2/openapi")
ENABLE_MULTIVIEW_FALLBACK = os.getenv("TRIPO_MULTIVIEW_FALLBACK", "1") == "1"
STAT_KEYS = ("courage", "wisdom", "faith", "love")

PIPELINE_PROFILES = {
    "h3_smart": {
        "label": "H3.1 + Smart Low Poly",
        "description": "그림 충실도와 iPad 경량화의 균형",
        "model_version": "v3.1-20260211",
        "smart_low_poly": True,
        "estimated_credits": 85,
    },
    "p1": {
        "label": "P1 Smart Mesh",
        "description": "더 정돈된 저폴리 토폴로지 비교용",
        "model_version": "P1-20260311",
        "smart_low_poly": False,
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
    initialize_database(DB_PATH, now_iso())


def row_dict(row: Any) -> dict:
    return dict(row)


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
    row = db.execute("SELECT * FROM teams WHERE id = ?", (team_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="조를 찾을 수 없습니다")
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
    team_ids: List[int] = Field(min_length=1, max_length=25)


def profile_config(profile: str) -> dict:
    if profile not in PIPELINE_PROFILES:
        raise ValueError(f"지원하지 않는 변환 프로필입니다: {profile}")
    return PIPELINE_PROFILES[profile]


def image_model_options(profile: str) -> dict:
    config = profile_config(profile)
    options = {
        "model_version": config["model_version"],
        "texture": True,
        "pbr": False,
        "face_limit": min(TRIPO_FACE_LIMIT, 40_000),
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
            smart_low_poly=True,
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
        "face_limit": min(TRIPO_FACE_LIMIT, 40_000),
        "texture_alignment": "original_image",
        "orientation": "align_image",
        "export_uv": True,
    }
    if profile == "h3_smart":
        payload.update(
            texture_quality="standard",
            compress="geometry",
            geometry_quality="standard",
            smart_low_poly=True,
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
                raise RuntimeError(model.error_msg or "3D 모델 생성에 실패했습니다")

            update_job(job_id, "rig_check")
            check_task_id = await client.check_riggable(model_task_id)
            update_job(job_id, "rig_check", rig_check_task_id=check_task_id)
            check = await client.wait_for_task(check_task_id)
            await record_task_usage(job_id, check_task_id)
            active_model_task_id = model_task_id
            if check.status != TaskStatus.SUCCESS:
                raise RuntimeError(check.error_msg or "리깅 가능 여부 확인에 실패했습니다")
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
                    raise RuntimeError(multiview.error_msg or "멀티뷰 이미지 생성에 실패했습니다")

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
                    raise RuntimeError(fallback_model.error_msg or "멀티뷰 3D 생성에 실패했습니다")
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
                raise RuntimeError(rig.error_msg or "자동 리깅에 실패했습니다")

            update_job(job_id, "animating")
            animation_task_id = await create_animation_task(client, rig_task_id)
            update_job(job_id, "animating", animation_task_id=animation_task_id)
            animation = await client.wait_for_task(animation_task_id)
            await record_task_usage(job_id, animation_task_id)
            if animation.status != TaskStatus.SUCCESS:
                raise RuntimeError(animation.error_msg or "대기·걷기 적용에 실패했습니다")

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
                raise RuntimeError(task.error_msg or f"{job['status']} 단계에 실패했습니다")

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


@app.get("/api/health")
async def health():
    api_key = os.getenv("TRIPO_API_KEY", "")
    persistent = using_postgres() and blob_configured()
    return {
        "ok": True,
        "workers": 0 if SERVERLESS_RUNTIME else WORKER_COUNT,
        "tripo_configured": api_key.startswith("tsk_"),
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
        return [row_dict(row) for row in db.execute("SELECT * FROM teams ORDER BY id")]


@app.get("/api/teams/{team_id}")
async def get_team(team_id: int):
    with connect_db() as db:
        return row_dict(get_team_or_404(db, team_id))


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
        return row_dict(get_team_or_404(db, team_id))


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


@app.post("/api/model-assets/{asset_id}/apply")
async def apply_model_asset(asset_id: str, payload: ModelAssetApply):
    team_ids = sorted(set(payload.team_ids))
    if any(team_id < 1 or team_id > 25 for team_id in team_ids):
        raise HTTPException(status_code=422, detail="조 번호는 1~25 사이여야 합니다")
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
