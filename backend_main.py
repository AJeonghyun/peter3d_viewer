"""Peter3D retreat kiosk backend.

Serves the Galilee world, stores 25 teams in SQLite, and processes Tripo jobs
through a small queue so a batch upload cannot exhaust the API concurrency.
"""

import asyncio
import os
import sqlite3
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from tripo3d import TaskStatus, TripoClient
from tripo3d.models import Animation, RigType

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
MODELS_DIR = ROOT / "static" / "models"
UPLOADS_DIR = ROOT / "uploads"
DB_PATH = Path(os.getenv("PETER3D_DB_PATH", DATA_DIR / "peter3d.db"))
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
WORKER_COUNT = max(1, min(int(os.getenv("PETER3D_WORKERS", "3")), 5))
STAT_KEYS = ("courage", "wisdom", "faith", "love")

for directory in (DATA_DIR, MODELS_DIR, UPLOADS_DIR):
    directory.mkdir(parents=True, exist_ok=True)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def connect_db() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_db() -> None:
    with connect_db() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS teams (
                id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 25),
                name TEXT NOT NULL,
                identity_text TEXT NOT NULL DEFAULT '',
                color TEXT NOT NULL DEFAULT '#67b8c7',
                symbol TEXT NOT NULL DEFAULT '물고기',
                courage INTEGER NOT NULL DEFAULT 10,
                wisdom INTEGER NOT NULL DEFAULT 10,
                faith INTEGER NOT NULL DEFAULT 10,
                love INTEGER NOT NULL DEFAULT 10,
                talents INTEGER NOT NULL DEFAULT 0,
                title TEXT NOT NULL DEFAULT '첫걸음을 준비하는 자',
                image_url TEXT,
                model_url TEXT,
                conversion_status TEXT NOT NULL DEFAULT 'empty',
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS growth_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
                source TEXT NOT NULL,
                note TEXT NOT NULL DEFAULT '',
                talent_delta INTEGER NOT NULL DEFAULT 0,
                courage_delta INTEGER NOT NULL DEFAULT 0,
                wisdom_delta INTEGER NOT NULL DEFAULT 0,
                faith_delta INTEGER NOT NULL DEFAULT 0,
                love_delta INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS conversion_jobs (
                id TEXT PRIMARY KEY,
                team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
                status TEXT NOT NULL,
                error TEXT,
                image_path TEXT NOT NULL,
                glb_url TEXT,
                model_task_id TEXT,
                rig_task_id TEXT,
                animation_task_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            """
        )
        timestamp = now_iso()
        for team_id in range(1, 26):
            db.execute(
                "INSERT OR IGNORE INTO teams (id, name, updated_at) VALUES (?, ?, ?)",
                (team_id, f"{team_id}조", timestamp),
            )


def row_dict(row: sqlite3.Row) -> dict:
    return dict(row)


def get_team_or_404(db: sqlite3.Connection, team_id: int) -> sqlite3.Row:
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
    allowed = {"error", "glb_url", "model_task_id", "rig_task_id", "animation_task_id"}
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
            glb_url = f"/static/models/team-{job['team_id']}/{glb_path.name}"
            update_job(job_id, "done", glb_url=glb_url)
            with connect_db() as db:
                db.execute(
                    "UPDATE teams SET model_url = ?, conversion_status = 'done', updated_at = ? WHERE id = ?",
                    (glb_url, now_iso(), job["team_id"]),
                )
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
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")


@app.get("/")
async def world_page():
    return FileResponse(ROOT / "peter3d_viewer.html")


@app.get("/admin")
async def admin_page():
    return FileResponse(ROOT / "admin.html")


@app.get("/api/health")
async def health():
    api_key = os.getenv("TRIPO_API_KEY", "")
    return {"ok": True, "workers": WORKER_COUNT, "tripo_configured": api_key.startswith("tsk_")}


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
    with connect_db() as db:
        get_team_or_404(db, team_id)
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
    image_path.write_bytes(contents)
    image_url = f"/uploads/{filename}"
    timestamp = now_iso()
    with connect_db() as db:
        db.execute(
            """
            INSERT INTO conversion_jobs (id, team_id, status, image_path, created_at, updated_at)
            VALUES (?, ?, 'queued', ?, ?, ?)
            """,
            (job_id, team_id, str(image_path), timestamp, timestamp),
        )
        db.execute(
            "UPDATE teams SET image_url = ?, conversion_status = 'queued', updated_at = ? WHERE id = ?",
            (image_url, timestamp, team_id),
        )
    if job_queue is None:
        raise HTTPException(status_code=503, detail="변환 대기열이 준비되지 않았습니다")
    await job_queue.put(job_id)
    return {"job_id": job_id, "team_id": team_id, "status": "queued"}


@app.get("/api/jobs")
async def list_jobs():
    with connect_db() as db:
        rows = db.execute(
            "SELECT * FROM conversion_jobs ORDER BY created_at DESC LIMIT 100"
        ).fetchall()
        return [row_dict(row) for row in rows]


@app.get("/api/jobs/{job_id}")
async def get_job(job_id: str):
    with connect_db() as db:
        row = db.execute("SELECT * FROM conversion_jobs WHERE id = ?", (job_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="변환 작업을 찾을 수 없습니다")
        queued_before = db.execute(
            "SELECT COUNT(*) FROM conversion_jobs WHERE status = 'queued' AND created_at < ?",
            (row["created_at"],),
        ).fetchone()[0]
        result = row_dict(row)
        result["queue_position"] = queued_before + 1 if row["status"] == "queued" else 0
        return result
