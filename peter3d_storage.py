"""Persistent database and object-storage helpers for Peter3D."""

from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path
from typing import Any, Iterable, Optional


DEFAULT_SEATING_PRESET_ID = "default"
DEFAULT_SEATING_PRESET_NAME = "기본 자리표"
DEFAULT_SEATING_PRESET_TITLE = "첫째 날 자리표"
DEFAULT_SEATING_PRESET_TIME_LABEL = ""


def database_url() -> str:
    return os.getenv("DATABASE_URL") or os.getenv("POSTGRES_URL") or ""


def using_postgres() -> bool:
    return database_url().startswith(("postgres://", "postgresql://"))


def _postgres_query(query: str) -> str:
    """Translate the small qmark SQL subset used by this project to psycopg."""
    return query.replace("?", "%s")


class DatabaseConnection:
    """Tiny compatibility wrapper shared by local SQLite and hosted Postgres."""

    def __init__(self, raw: Any, postgres: bool):
        self.raw = raw
        self.postgres = postgres

    def execute(self, query: str, params: Iterable[Any] = ()):
        statement = _postgres_query(query) if self.postgres else query
        return self.raw.execute(statement, tuple(params))

    def __enter__(self) -> "DatabaseConnection":
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        try:
            if exc_type is None:
                self.raw.commit()
            else:
                self.raw.rollback()
        finally:
            self.raw.close()


def connect_database(sqlite_path: Path) -> DatabaseConnection:
    url = database_url()
    if using_postgres():
        import psycopg
        from psycopg.rows import dict_row

        raw = psycopg.connect(url, row_factory=dict_row)
        return DatabaseConnection(raw, postgres=True)

    raw = sqlite3.connect(sqlite_path)
    raw.row_factory = sqlite3.Row
    raw.execute("PRAGMA foreign_keys = ON")
    return DatabaseConnection(raw, postgres=False)


SQLITE_SCHEMA = (
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
        showcase_image_url TEXT,
        showcase_sprite_url TEXT,
        showcase_sprite_active_url TEXT,
        showcase_sprite_status TEXT NOT NULL DEFAULT 'empty',
        showcase_sprite_error TEXT,
        showcase_sprite_model TEXT,
        showcase_sprite_quality_status TEXT NOT NULL DEFAULT 'unchecked',
        showcase_sprite_quality_json TEXT,
        showcase_sprite_qa_model TEXT,
        showcase_sprite_updated_at TEXT,
        image_url TEXT,
        model_url TEXT,
        model_asset_id TEXT,
        conversion_status TEXT NOT NULL DEFAULT 'empty',
        updated_at TEXT NOT NULL
    )
    """,
    """
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
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS conversion_jobs (
        id TEXT PRIMARY KEY,
        team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        error TEXT,
        image_path TEXT NOT NULL,
        glb_url TEXT,
        model_task_id TEXT,
        rig_check_task_id TEXT,
        rig_task_id TEXT,
        animation_task_id TEXT,
        multiview_task_id TEXT,
        fallback_model_task_id TEXT,
        pipeline_profile TEXT NOT NULL DEFAULT 'h3_smart',
        fallback_used INTEGER NOT NULL DEFAULT 0,
        glb_bytes INTEGER,
        glb_triangles INTEGER,
        glb_animations INTEGER,
        lease_token TEXT,
        lease_until TEXT,
        asset_only INTEGER NOT NULL DEFAULT 0,
        asset_name TEXT,
        source_image_url TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS tripo_task_usage (
        task_id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES conversion_jobs(id) ON DELETE CASCADE,
        task_type TEXT NOT NULL,
        consumed_credit INTEGER NOT NULL DEFAULT 0,
        recorded_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS model_assets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        source_image_url TEXT,
        glb_url TEXT NOT NULL,
        pipeline_profile TEXT NOT NULL DEFAULT 'h3_smart',
        glb_bytes INTEGER,
        glb_triangles INTEGER,
        glb_animations INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS seating_presets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        title TEXT NOT NULL,
        time_label TEXT NOT NULL DEFAULT '',
        group_order TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    """,
)


POSTGRES_SCHEMA = (
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
        showcase_image_url TEXT,
        showcase_sprite_url TEXT,
        showcase_sprite_active_url TEXT,
        showcase_sprite_status TEXT NOT NULL DEFAULT 'empty',
        showcase_sprite_error TEXT,
        showcase_sprite_model TEXT,
        showcase_sprite_quality_status TEXT NOT NULL DEFAULT 'unchecked',
        showcase_sprite_quality_json TEXT,
        showcase_sprite_qa_model TEXT,
        showcase_sprite_updated_at TEXT,
        image_url TEXT,
        model_url TEXT,
        model_asset_id TEXT,
        conversion_status TEXT NOT NULL DEFAULT 'empty',
        updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS growth_events (
        id BIGSERIAL PRIMARY KEY,
        team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        talent_delta INTEGER NOT NULL DEFAULT 0,
        courage_delta INTEGER NOT NULL DEFAULT 0,
        wisdom_delta INTEGER NOT NULL DEFAULT 0,
        faith_delta INTEGER NOT NULL DEFAULT 0,
        love_delta INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS conversion_jobs (
        id TEXT PRIMARY KEY,
        team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        error TEXT,
        image_path TEXT NOT NULL,
        glb_url TEXT,
        model_task_id TEXT,
        rig_check_task_id TEXT,
        rig_task_id TEXT,
        animation_task_id TEXT,
        multiview_task_id TEXT,
        fallback_model_task_id TEXT,
        pipeline_profile TEXT NOT NULL DEFAULT 'h3_smart',
        fallback_used INTEGER NOT NULL DEFAULT 0,
        glb_bytes INTEGER,
        glb_triangles INTEGER,
        glb_animations INTEGER,
        lease_token TEXT,
        lease_until TEXT,
        asset_only INTEGER NOT NULL DEFAULT 0,
        asset_name TEXT,
        source_image_url TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS tripo_task_usage (
        task_id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES conversion_jobs(id) ON DELETE CASCADE,
        task_type TEXT NOT NULL,
        consumed_credit INTEGER NOT NULL DEFAULT 0,
        recorded_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS model_assets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        source_image_url TEXT,
        glb_url TEXT NOT NULL,
        pipeline_profile TEXT NOT NULL DEFAULT 'h3_smart',
        glb_bytes INTEGER,
        glb_triangles INTEGER,
        glb_animations INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS seating_presets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        title TEXT NOT NULL,
        time_label TEXT NOT NULL DEFAULT '',
        group_order TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    """,
)


JOB_COLUMN_MIGRATIONS = {
    "rig_check_task_id": "TEXT",
    "multiview_task_id": "TEXT",
    "fallback_model_task_id": "TEXT",
    "pipeline_profile": "TEXT NOT NULL DEFAULT 'h3_smart'",
    "fallback_used": "INTEGER NOT NULL DEFAULT 0",
    "glb_bytes": "INTEGER",
    "glb_triangles": "INTEGER",
    "glb_animations": "INTEGER",
    "lease_token": "TEXT",
    "lease_until": "TEXT",
    "asset_only": "INTEGER NOT NULL DEFAULT 0",
    "asset_name": "TEXT",
    "source_image_url": "TEXT",
}

TEAM_COLUMN_MIGRATIONS = {
    "showcase_image_url": "TEXT",
    "showcase_sprite_url": "TEXT",
    "showcase_sprite_active_url": "TEXT",
    "showcase_sprite_status": "TEXT NOT NULL DEFAULT 'empty'",
    "showcase_sprite_error": "TEXT",
    "showcase_sprite_model": "TEXT",
    "showcase_sprite_quality_status": "TEXT NOT NULL DEFAULT 'unchecked'",
    "showcase_sprite_quality_json": "TEXT",
    "showcase_sprite_qa_model": "TEXT",
    "showcase_sprite_updated_at": "TEXT",
    "model_asset_id": "TEXT",
}


def initialize_database(sqlite_path: Path, timestamp: str, *, team_count: int = 21) -> None:
    with connect_database(sqlite_path) as db:
        schema = POSTGRES_SCHEMA if db.postgres else SQLITE_SCHEMA
        for statement in schema:
            db.execute(statement)

        if db.postgres:
            for column, definition in TEAM_COLUMN_MIGRATIONS.items():
                db.execute(f"ALTER TABLE teams ADD COLUMN IF NOT EXISTS {column} {definition}")
            for column, definition in JOB_COLUMN_MIGRATIONS.items():
                db.execute(
                    f"ALTER TABLE conversion_jobs ADD COLUMN IF NOT EXISTS {column} {definition}"
                )
            for team_id in range(1, team_count + 1):
                db.execute(
                    """
                    INSERT INTO teams (id, name, updated_at) VALUES (?, ?, ?)
                    ON CONFLICT (id) DO NOTHING
                    """,
                    (team_id, f"{team_id}조", timestamp),
                )
            db.execute(
                """
                UPDATE teams
                SET showcase_sprite_active_url = showcase_sprite_url
                WHERE showcase_sprite_active_url IS NULL
                  AND showcase_sprite_status = 'ready'
                  AND showcase_sprite_url IS NOT NULL
                """
            )
        else:
            team_columns = {
                row["name"] for row in db.execute("PRAGMA table_info(teams)").fetchall()
            }
            for column, definition in TEAM_COLUMN_MIGRATIONS.items():
                if column not in team_columns:
                    db.execute(f"ALTER TABLE teams ADD COLUMN {column} {definition}")
            columns = {
                row["name"] for row in db.execute("PRAGMA table_info(conversion_jobs)").fetchall()
            }
            for column, definition in JOB_COLUMN_MIGRATIONS.items():
                if column not in columns:
                    db.execute(f"ALTER TABLE conversion_jobs ADD COLUMN {column} {definition}")
            for team_id in range(1, team_count + 1):
                db.execute(
                    "INSERT OR IGNORE INTO teams (id, name, updated_at) VALUES (?, ?, ?)",
                    (team_id, f"{team_id}조", timestamp),
                )
            db.execute(
                """
                UPDATE teams
                SET showcase_sprite_active_url = showcase_sprite_url
                WHERE showcase_sprite_active_url IS NULL
                  AND showcase_sprite_status = 'ready'
                  AND showcase_sprite_url IS NOT NULL
                """
            )

        db.execute(
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
        db.execute(
            """
            UPDATE teams SET model_asset_id = (
                SELECT conversion_jobs.id FROM conversion_jobs
                WHERE conversion_jobs.team_id = teams.id
                  AND conversion_jobs.status = 'done'
                  AND conversion_jobs.glb_url = teams.model_url
                ORDER BY conversion_jobs.updated_at DESC LIMIT 1
            )
            WHERE model_asset_id IS NULL AND model_url IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM conversion_jobs
                WHERE conversion_jobs.team_id = teams.id
                  AND conversion_jobs.status = 'done'
                  AND conversion_jobs.glb_url = teams.model_url
              )
            """
        )
        default_group_order = json.dumps(list(range(1, team_count + 1)), separators=(",", ":"))
        db.execute(
            """
            INSERT INTO seating_presets (
                id, name, title, time_label, group_order, created_at, updated_at
            )
            SELECT ?, ?, ?, ?, ?, ?, ?
            WHERE NOT EXISTS (SELECT 1 FROM seating_presets)
            """,
            (
                DEFAULT_SEATING_PRESET_ID,
                DEFAULT_SEATING_PRESET_NAME,
                DEFAULT_SEATING_PRESET_TITLE,
                DEFAULT_SEATING_PRESET_TIME_LABEL,
                default_group_order,
                timestamp,
                timestamp,
            ),
        )
        active_exists = db.execute(
            """
            SELECT 1 FROM app_settings
            WHERE key = 'active_seating_preset_id'
              AND value IN (SELECT id FROM seating_presets)
            """
        ).fetchone()
        if active_exists is None:
            active = db.execute(
                """
                SELECT id FROM seating_presets
                ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, updated_at DESC, id
                LIMIT 1
                """,
                (DEFAULT_SEATING_PRESET_ID,),
            ).fetchone()
            if active is not None:
                db.execute(
                    """
                    INSERT INTO app_settings (key, value, updated_at)
                    VALUES ('active_seating_preset_id', ?, ?)
                    ON CONFLICT (key) DO UPDATE SET
                        value = excluded.value,
                        updated_at = excluded.updated_at
                    """,
                    (active["id"], timestamp),
                )


def blob_configured() -> bool:
    return bool(os.getenv("BLOB_READ_WRITE_TOKEN"))


async def put_public_blob(
    pathname: str,
    body: bytes,
    *,
    content_type: str,
    multipart: bool = False,
) -> str:
    if not blob_configured():
        raise RuntimeError("BLOB_READ_WRITE_TOKEN이 설정되지 않았습니다")

    from vercel.blob import AsyncBlobClient

    result = await AsyncBlobClient().put(
        pathname,
        body,
        access="public",
        content_type=content_type,
        add_random_suffix=False,
        overwrite=True,
        cache_control_max_age=31_536_000,
        multipart=multipart,
    )
    return result.url


async def delete_blob_if_managed(url: Optional[str]) -> None:
    if not url or not blob_configured() or "blob.vercel-storage.com" not in url:
        return

    from vercel.blob import AsyncBlobClient

    await AsyncBlobClient().delete(url)
