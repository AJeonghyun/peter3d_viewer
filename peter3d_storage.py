"""Persistent database and object-storage helpers for Peter3D."""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from typing import Any, Iterable, Optional


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
        image_url TEXT,
        model_url TEXT,
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
        image_url TEXT,
        model_url TEXT,
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
}


def initialize_database(sqlite_path: Path, timestamp: str) -> None:
    with connect_database(sqlite_path) as db:
        schema = POSTGRES_SCHEMA if db.postgres else SQLITE_SCHEMA
        for statement in schema:
            db.execute(statement)

        if db.postgres:
            for column, definition in JOB_COLUMN_MIGRATIONS.items():
                db.execute(
                    f"ALTER TABLE conversion_jobs ADD COLUMN IF NOT EXISTS {column} {definition}"
                )
            for team_id in range(1, 26):
                db.execute(
                    """
                    INSERT INTO teams (id, name, updated_at) VALUES (?, ?, ?)
                    ON CONFLICT (id) DO NOTHING
                    """,
                    (team_id, f"{team_id}조", timestamp),
                )
        else:
            columns = {
                row["name"] for row in db.execute("PRAGMA table_info(conversion_jobs)").fetchall()
            }
            for column, definition in JOB_COLUMN_MIGRATIONS.items():
                if column not in columns:
                    db.execute(f"ALTER TABLE conversion_jobs ADD COLUMN {column} {definition}")
            for team_id in range(1, 26):
                db.execute(
                    "INSERT OR IGNORE INTO teams (id, name, updated_at) VALUES (?, ?, ?)",
                    (team_id, f"{team_id}조", timestamp),
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
