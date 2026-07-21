"""Vercel serverless entrypoint for the Peter3D FastAPI routes."""

import os

os.environ.setdefault("PETER3D_SERVERLESS", "1")
os.environ.setdefault("PETER3D_DB_PATH", "/tmp/peter3d.db")
os.environ.setdefault("PETER3D_MODELS_DIR", "/tmp/peter3d-models")
os.environ.setdefault("PETER3D_UPLOADS_DIR", "/tmp/peter3d-uploads")

from backend_main import app  # noqa: E402  (environment must be set before import)
