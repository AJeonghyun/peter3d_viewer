"""FastAPI application assembly for the Peter3D retreat backend."""

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend import config
from backend.db import init_db
from backend.routes import (
    model_assets,
    pages,
    seating,
    sprites_capture,
    sprites_compose,
    sprites_versions,
    teams,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="Peter3D Retreat", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            origin
            for origin in os.getenv("PETER3D_ALLOWED_ORIGINS", "http://localhost:8000").split(",")
            if origin
        ],
        allow_methods=["GET", "POST", "PATCH"],
        allow_headers=["*"],
    )
    app.mount(
        "/static",
        StaticFiles(directory=config.ROOT / "static", check_dir=not config.SERVERLESS_RUNTIME),
        name="static",
    )
    app.mount("/uploads", StaticFiles(directory=config.UPLOADS_DIR), name="uploads")

    app.include_router(pages.router)
    app.include_router(teams.router)
    app.include_router(seating.router)
    app.include_router(sprites_capture.router)
    app.include_router(sprites_compose.router)
    app.include_router(sprites_versions.router)
    app.include_router(model_assets.router)

    # Keep this mount last so API, generated models, and uploads retain priority.
    app.mount(
        "/",
        StaticFiles(directory=config.FRONTEND_DIST, html=True, check_dir=False),
        name="frontend",
    )
    return app


app = create_app()
