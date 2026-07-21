"""Database connection helpers shared by every route module."""

import json
from datetime import datetime, timezone
from typing import Any

from peter3d_storage import connect_database, initialize_database

from backend import config


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def connect_db():
    return connect_database(config.DB_PATH)


def init_db() -> None:
    initialize_database(config.DB_PATH, now_iso(), team_count=config.TEAM_COUNT)


def row_dict(row: Any) -> dict:
    return dict(row)


def loads_json(value: Any) -> Any:
    try:
        return json.loads(value) if value else None
    except (json.JSONDecodeError, TypeError):
        return None
