"""One-time, idempotent migration from local SQLite to hosted Postgres.

The matching images and models must already exist in object storage. Local
asset paths are rewritten to the predictable ``teams/{id}/.../migrated`` Blob
paths so the hosted application never depends on a developer filesystem.
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from peter3d_storage import JOB_COLUMN_MIGRATIONS, POSTGRES_SCHEMA, TEAM_COLUMN_MIGRATIONS


TEAM_COLUMNS = (
    "id",
    "name",
    "identity_text",
    "color",
    "symbol",
    "courage",
    "wisdom",
    "faith",
    "love",
    "talents",
    "title",
    "image_url",
    "model_url",
    "model_asset_id",
    "conversion_status",
    "updated_at",
)

EVENT_COLUMNS = (
    "id",
    "team_id",
    "source",
    "note",
    "talent_delta",
    "courage_delta",
    "wisdom_delta",
    "faith_delta",
    "love_delta",
    "created_at",
)

JOB_COLUMNS = (
    "id",
    "team_id",
    "status",
    "error",
    "image_path",
    "glb_url",
    "model_task_id",
    "rig_check_task_id",
    "rig_task_id",
    "animation_task_id",
    "multiview_task_id",
    "fallback_model_task_id",
    "pipeline_profile",
    "fallback_used",
    "glb_bytes",
    "glb_triangles",
    "glb_animations",
    "lease_token",
    "lease_until",
    "asset_only",
    "asset_name",
    "source_image_url",
    "created_at",
    "updated_at",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sqlite", type=Path, default=Path("data/peter3d.db"))
    parser.add_argument(
        "--blob-base-url",
        required=True,
        help="Public Vercel Blob origin, without a trailing slash",
    )
    return parser.parse_args()


def postgres_url() -> str:
    url = os.getenv("DATABASE_URL") or os.getenv("POSTGRES_URL") or ""
    if not url.startswith(("postgres://", "postgresql://")):
        raise SystemExit("DATABASE_URL 또는 POSTGRES_URL에 Postgres 연결 문자열이 필요합니다.")
    return url


def local_asset_url(value: Any, team_id: int, kind: str, blob_base_url: str) -> Any:
    if not value or str(value).startswith(("http://", "https://")):
        return value
    if kind == "models":
        filename = "migrated.glb"
    else:
        suffix = Path(str(value)).suffix.lower()
        filename = f"migrated{suffix if suffix in {'.png', '.jpg', '.jpeg'} else '.png'}"
    return f"{blob_base_url}/teams/{team_id}/{kind}/{filename}"


def upsert(cur: psycopg.Cursor, table: str, columns: tuple[str, ...], row: dict[str, Any]) -> None:
    assignments = ", ".join(f"{column} = EXCLUDED.{column}" for column in columns if column != "id")
    placeholders = ", ".join(["%s"] * len(columns))
    cur.execute(
        f"""
        INSERT INTO {table} ({', '.join(columns)}) VALUES ({placeholders})
        ON CONFLICT (id) DO UPDATE SET {assignments}
        """,
        tuple(row.get(column) for column in columns),
    )


def main() -> None:
    args = parse_args()
    sqlite_path = args.sqlite.resolve()
    if not sqlite_path.is_file():
        raise SystemExit(f"SQLite 파일을 찾을 수 없습니다: {sqlite_path}")
    blob_base_url = args.blob_base_url.rstrip("/")

    sqlite_db = sqlite3.connect(sqlite_path)
    sqlite_db.row_factory = sqlite3.Row
    teams = [dict(row) for row in sqlite_db.execute("SELECT * FROM teams ORDER BY id")]
    events = [dict(row) for row in sqlite_db.execute("SELECT * FROM growth_events ORDER BY id")]
    jobs = [dict(row) for row in sqlite_db.execute("SELECT * FROM conversion_jobs ORDER BY created_at")]
    sqlite_db.close()

    migrated_team_assets: dict[int, tuple[Any, Any]] = {}
    for team in teams:
        team_id = int(team["id"])
        team["image_url"] = local_asset_url(team["image_url"], team_id, "images", blob_base_url)
        team["model_url"] = local_asset_url(team["model_url"], team_id, "models", blob_base_url)
        migrated_team_assets[team_id] = (team["image_url"], team["model_url"])

    with psycopg.connect(postgres_url(), row_factory=dict_row) as postgres_db:
        with postgres_db.cursor() as cur:
            for statement in POSTGRES_SCHEMA:
                cur.execute(statement)
            for column, definition in TEAM_COLUMN_MIGRATIONS.items():
                cur.execute(f"ALTER TABLE teams ADD COLUMN IF NOT EXISTS {column} {definition}")
            for column, definition in JOB_COLUMN_MIGRATIONS.items():
                cur.execute(
                    f"ALTER TABLE conversion_jobs ADD COLUMN IF NOT EXISTS {column} {definition}"
                )

            for team in teams:
                team.setdefault("model_asset_id", None)
                upsert(cur, "teams", TEAM_COLUMNS, team)
            for event in events:
                upsert(cur, "growth_events", EVENT_COLUMNS, event)

            for job in jobs:
                team_image, team_model = migrated_team_assets.get(int(job["team_id"]), (None, None))
                for column in JOB_COLUMNS:
                    job.setdefault(column, None)
                job["pipeline_profile"] = job["pipeline_profile"] or "h3_smart"
                job["fallback_used"] = int(job["fallback_used"] or 0)
                job["asset_only"] = int(job["asset_only"] or 0)
                job["image_path"] = team_image or "migrated://source-unavailable"
                if job["status"] == "done":
                    job["glb_url"] = team_model
                elif job["status"] not in {"failed", "done"}:
                    job["status"] = "failed"
                    job["error"] = "클라우드 이관 중 중단된 작업입니다. 이미지를 다시 등록해주세요."
                upsert(cur, "conversion_jobs", JOB_COLUMNS, job)

            cur.execute(
                """
                INSERT INTO model_assets (
                    id, name, source_image_url, glb_url, pipeline_profile,
                    glb_bytes, glb_triangles, glb_animations, created_at, updated_at
                )
                SELECT id, COALESCE(asset_name, '기존 생성 모델 ' || id), source_image_url,
                    glb_url, pipeline_profile, glb_bytes, glb_triangles, glb_animations,
                    created_at, updated_at
                FROM conversion_jobs
                WHERE status = 'done' AND glb_url IS NOT NULL
                ON CONFLICT (id) DO NOTHING
                """
            )

            cur.execute(
                """
                SELECT setval(
                    pg_get_serial_sequence('growth_events', 'id'),
                    COALESCE((SELECT MAX(id) FROM growth_events), 1),
                    EXISTS(SELECT 1 FROM growth_events)
                )
                """
            )

    print(
        f"이관 완료: 조 {len(teams)}개, 성장 기록 {len(events)}개, 변환 작업 {len(jobs)}개"
    )


if __name__ == "__main__":
    main()
