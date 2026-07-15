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
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from tripo3d import TaskStatus, TripoClient
from tripo3d.models import Animation, RigType

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
TRIPO_FACE_LIMIT = max(1_000, min(int(os.getenv("TRIPO_FACE_LIMIT", "20000")), 100_000))
WORKER_COUNT = max(1, min(int(os.getenv("PETER3D_WORKERS", "3")), 5))
SERVERLESS_RUNTIME = os.getenv("PETER3D_SERVERLESS", "0") == "1"
STAT_KEYS = ("courage", "wisdom", "faith", "love")

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


def inspect_animated_glb(contents: bytes) -> dict:
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
        "team_id": job["team_id"],
        "status": job["status"],
        "error": job["error"],
        "glb_url": job["glb_url"],
        "created_at": job["created_at"],
        "updated_at": job["updated_at"],
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


job_queue: Optional[asyncio.Queue] = None
worker_tasks: List[asyncio.Task] = []


def update_job(job_id: str, status: str, **fields: object) -> None:
    allowed = {
        "error",
        "glb_url",
        "model_task_id",
        "rig_check_task_id",
        "rig_task_id",
        "animation_task_id",
    }
    assignments = ["status = ?", "updated_at = ?"]
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
        row = db.execute("SELECT team_id FROM conversion_jobs WHERE id = ?", (job_id,)).fetchone()
        if row:
            db.execute(
                "UPDATE teams SET conversion_status = ?, updated_at = ? WHERE id = ?",
                (status, now_iso(), row["team_id"]),
            )


async def upload_generated_glb(team_id: int, job_id: str, source_url: str) -> str:
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
    inspect_animated_glb(glb)
    return await put_public_blob(
        f"teams/{team_id}/models/{job_id}.glb",
        glb,
        content_type="model/gltf-binary",
        multipart=True,
    )


def final_model_url(task: Any) -> Optional[str]:
    return task.output.model or task.output.pbr_model or task.output.base_model


async def run_pipeline(job_id: str) -> None:
    with connect_db() as db:
        job = db.execute("SELECT * FROM conversion_jobs WHERE id = ?", (job_id,)).fetchone()
    if not job:
        return
    api_key = os.getenv("TRIPO_API_KEY", "")
    if not api_key.startswith("tsk_"):
        update_job(job_id, "failed", error="TRIPO_API_KEY에 tsk_로 시작하는 OpenAPI 키가 필요합니다")
        return

    try:
        async with TripoClient() as client:
            update_job(job_id, "modeling")
            model_task_id = await client.image_to_model(
                image=job["image_path"],
                model_version=os.getenv("TRIPO_MODEL_VERSION", "v3.1-20260211"),
                texture=True,
                pbr=False,
                texture_quality="standard",
                geometry_quality="standard",
                face_limit=TRIPO_FACE_LIMIT,
                orientation="align_image",
                compress=True,
            )
            update_job(job_id, "modeling", model_task_id=model_task_id)
            model = await client.wait_for_task(model_task_id)
            if model.status != TaskStatus.SUCCESS:
                raise RuntimeError(model.error_msg or "3D 모델 생성에 실패했습니다")

            update_job(job_id, "rig_check")
            check_task_id = await client.check_riggable(model_task_id)
            check = await client.wait_for_task(check_task_id)
            if check.status != TaskStatus.SUCCESS or not check.output.riggable:
                raise RuntimeError("사람형 뼈대를 인식하지 못했습니다. 팔다리가 보이도록 다시 촬영해주세요")

            update_job(job_id, "rigging")
            rig_task_id = await client.rig_model(
                original_model_task_id=model_task_id,
                out_format="glb",
                rig_type=RigType.BIPED,
            )
            update_job(job_id, "rigging", rig_task_id=rig_task_id)
            rig = await client.wait_for_task(rig_task_id)
            if rig.status != TaskStatus.SUCCESS:
                raise RuntimeError(rig.error_msg or "자동 리깅에 실패했습니다")

            update_job(job_id, "animating")
            animation_task_id = await client.retarget_animation(
                original_model_task_id=rig_task_id,
                animation=Animation.WALK,
                out_format="glb",
                export_with_geometry=True,
                animate_in_place=True,
            )
            update_job(job_id, "animating", animation_task_id=animation_task_id)
            animation = await client.wait_for_task(animation_task_id)
            if animation.status != TaskStatus.SUCCESS:
                raise RuntimeError(animation.error_msg or "걷기 적용에 실패했습니다")

            output_dir = MODELS_DIR / f"team-{job['team_id']}"
            output_dir.mkdir(parents=True, exist_ok=True)
            files = await client.download_task_models(animation, str(output_dir))
            glb_path = next(
                (Path(path) for path in files.values() if path and str(path).lower().endswith(".glb")),
                None,
            )
            if glb_path is None:
                raise RuntimeError("완성된 GLB 파일을 찾지 못했습니다")
            glb_contents = glb_path.read_bytes()
            inspect_animated_glb(glb_contents)
            if blob_configured():
                glb_url = await put_public_blob(
                    f"teams/{job['team_id']}/models/{job_id}.glb",
                    glb_contents,
                    content_type="model/gltf-binary",
                    multipart=True,
                )
            else:
                glb_url = f"/static/models/team-{job['team_id']}/{glb_path.name}"
            update_job(job_id, "done", glb_url=glb_url)
            with connect_db() as db:
                previous = row_dict(get_team_or_404(db, job["team_id"]))
                db.execute(
                    "UPDATE teams SET model_url = ?, conversion_status = 'done', updated_at = ? WHERE id = ?",
                    (glb_url, now_iso(), job["team_id"]),
                )
            if previous["model_url"] != glb_url:
                await delete_blob_if_managed(previous["model_url"])
    except Exception as exc:  # noqa: BLE001 - user-facing job boundary
        update_job(job_id, "failed", error=str(exc))


async def advance_serverless_job(job_id: str) -> None:
    """Advance one non-blocking Tripo stage whenever the admin polls a job."""
    with connect_db() as db:
        row = db.execute("SELECT * FROM conversion_jobs WHERE id = ?", (job_id,)).fetchone()
    if not row or row["status"] in {"done", "failed"}:
        return

    job = row_dict(row)
    claimed_at = now_iso()
    with connect_db() as db:
        claimed = db.execute(
            """
            UPDATE conversion_jobs SET updated_at = ?
            WHERE id = ? AND updated_at = ? AND status = ?
            """,
            (claimed_at, job_id, job["updated_at"], job["status"]),
        )
        if claimed.rowcount != 1:
            return
    job["updated_at"] = claimed_at
    task_ids = {
        "modeling": job.get("model_task_id"),
        "rig_check": job.get("rig_check_task_id"),
        "rigging": job.get("rig_task_id"),
        "animating": job.get("animation_task_id"),
    }
    task_id = task_ids.get(job["status"])
    if not task_id:
        update_job(job_id, "failed", error="변환 작업 단계 정보가 누락되었습니다")
        return

    try:
        async with TripoClient() as client:
            task = await client.get_task(task_id)
            if task.status in {TaskStatus.QUEUED, TaskStatus.RUNNING}:
                return
            if task.status != TaskStatus.SUCCESS:
                raise RuntimeError(task.error_msg or f"{job['status']} 단계에 실패했습니다")

            if job["status"] == "modeling":
                check_id = await client.check_riggable(job["model_task_id"])
                update_job(job_id, "rig_check", rig_check_task_id=check_id)
                return

            if job["status"] == "rig_check":
                if not task.output.riggable:
                    raise RuntimeError(
                        "사람형 뼈대를 인식하지 못했습니다. 팔다리가 보이도록 다시 촬영해주세요"
                    )
                rig_id = await client.rig_model(
                    original_model_task_id=job["model_task_id"],
                    out_format="glb",
                    rig_type=RigType.BIPED,
                )
                update_job(job_id, "rigging", rig_task_id=rig_id)
                return

            if job["status"] == "rigging":
                animation_id = await client.retarget_animation(
                    original_model_task_id=job["rig_task_id"],
                    animation=Animation.WALK,
                    out_format="glb",
                    export_with_geometry=True,
                    animate_in_place=True,
                )
                update_job(job_id, "animating", animation_task_id=animation_id)
                return

            source_url = final_model_url(task)
            if not source_url:
                raise RuntimeError("완성된 GLB 다운로드 주소를 찾지 못했습니다")
            glb_url = await upload_generated_glb(job["team_id"], job_id, source_url)
            with connect_db() as db:
                previous = row_dict(get_team_or_404(db, job["team_id"]))
                db.execute(
                    "UPDATE teams SET model_url = ?, conversion_status = 'done', updated_at = ? WHERE id = ?",
                    (glb_url, now_iso(), job["team_id"]),
                )
            update_job(job_id, "done", glb_url=glb_url)
            if previous["model_url"] != glb_url:
                await delete_blob_if_managed(previous["model_url"])
    except Exception as exc:  # noqa: BLE001 - user-facing job boundary
        update_job(job_id, "failed", error=str(exc))


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


@app.post("/api/teams/{team_id}/convert", status_code=202)
async def convert_team(team_id: int, image: UploadFile = File(...)):
    api_key = os.getenv("TRIPO_API_KEY", "")
    if SERVERLESS_RUNTIME and not (using_postgres() and blob_configured()):
        raise HTTPException(
            status_code=503,
            detail="Neon Postgres와 Vercel Blob 연결이 필요합니다.",
        )
    if SERVERLESS_RUNTIME and not api_key.startswith("tsk_"):
        raise HTTPException(status_code=503, detail="TRIPO_API_KEY가 설정되지 않았습니다")
    with connect_db() as db:
        previous_team = row_dict(get_team_or_404(db, team_id))
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

    job_id = uuid.uuid4().hex[:12]
    filename = f"team-{team_id}-{job_id}{extensions[content_type]}"
    image_path = UPLOADS_DIR / filename
    if blob_configured():
        image_url = await put_public_blob(
            f"teams/{team_id}/images/{job_id}{extensions[content_type]}",
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
            INSERT INTO conversion_jobs (id, team_id, status, image_path, created_at, updated_at)
            VALUES (?, ?, 'queued', ?, ?, ?)
            """,
            (job_id, team_id, image_job_source, timestamp, timestamp),
        )
        db.execute(
            "UPDATE teams SET image_url = ?, conversion_status = 'queued', updated_at = ? WHERE id = ?",
            (image_url, timestamp, team_id),
        )
    if previous_team["image_url"] != image_url:
        await delete_blob_if_managed(previous_team["image_url"])

    if SERVERLESS_RUNTIME:
        image_path.write_bytes(contents)
        try:
            async with TripoClient() as client:
                model_task_id = await client.image_to_model(
                    image=str(image_path),
                    model_version=os.getenv("TRIPO_MODEL_VERSION", "v3.1-20260211"),
                    texture=True,
                    pbr=False,
                    texture_quality="standard",
                    geometry_quality="standard",
                    face_limit=TRIPO_FACE_LIMIT,
                    orientation="align_image",
                    compress=True,
                )
            update_job(job_id, "modeling", model_task_id=model_task_id)
        except Exception as exc:  # noqa: BLE001 - external API boundary
            update_job(job_id, "failed", error=str(exc))
            raise HTTPException(status_code=502, detail=f"Tripo 작업 생성 실패: {exc}") from exc
        finally:
            image_path.unlink(missing_ok=True)
        return {"job_id": job_id, "team_id": team_id, "status": "modeling"}

    if job_queue is None:
        raise HTTPException(status_code=503, detail="변환 대기열이 준비되지 않았습니다")
    await job_queue.put(job_id)
    return {"job_id": job_id, "team_id": team_id, "status": "queued"}


@app.get("/api/jobs")
async def list_jobs():
    if SERVERLESS_RUNTIME:
        with connect_db() as db:
            active = db.execute(
                """
                SELECT id FROM conversion_jobs
                WHERE status NOT IN ('done', 'failed')
                ORDER BY updated_at ASC LIMIT 8
                """
            ).fetchall()
        await asyncio.gather(
            *(advance_serverless_job(row["id"]) for row in active),
            return_exceptions=True,
        )
    with connect_db() as db:
        rows = db.execute(
            "SELECT * FROM conversion_jobs ORDER BY created_at DESC LIMIT 100"
        ).fetchall()
        return [public_job(row) for row in rows]


@app.get("/api/jobs/{job_id}")
async def get_job(job_id: str):
    if SERVERLESS_RUNTIME:
        await advance_serverless_job(job_id)
    with connect_db() as db:
        row = db.execute("SELECT * FROM conversion_jobs WHERE id = ?", (job_id,)).fetchone()
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
