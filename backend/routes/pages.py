"""SPA page routes, health check, and the fixed Peter master asset."""

import os

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from peter3d_storage import blob_configured, using_postgres

from backend import config

router = APIRouter()


def frontend_index() -> FileResponse:
    index_path = config.FRONTEND_DIST / "index.html"
    if not index_path.is_file():
        raise HTTPException(
            status_code=503,
            detail="React 화면이 빌드되지 않았습니다. frontend에서 npm run build를 실행하세요.",
        )
    return FileResponse(index_path)


@router.get("/")
async def world_page():
    return frontend_index()


@router.get("/admin")
async def admin_page():
    return frontend_index()


@router.get("/world-3d")
async def legacy_world_page():
    return frontend_index()


@router.get("/page-1")
@router.get("/page-2")
@router.get("/page-3")
@router.get("/display/group-layout")
@router.get("/display/notice")
@router.get("/display/all-characters")
@router.get("/showcase")
@router.get("/print-template")
@router.get("/editor")
@router.get("/admin/seating")
@router.get("/seating-admin")
@router.get("/sprite-lab")
@router.get("/garment-test")
async def retreat_display_page():
    return frontend_index()


@router.get("/api/health")
async def health():
    openai_key = os.getenv("OPENAI_API_KEY", "")
    persistent = using_postgres() and blob_configured()
    return {
        "ok": True,
        "openai_configured": openai_key.startswith("sk-"),
        "openai_image_model": config.OPENAI_IMAGE_MODEL,
        "openai_image_quality": config.OPENAI_IMAGE_QUALITY,
        "fixed_peter_master_available": config.SHOWCASE_MASTER_PATH.is_file(),
        "fixed_peter_master_frames": (
            config.GARMENT_ATLAS_COLUMNS * config.GARMENT_ATLAS_ROWS
            if config.SHOWCASE_MASTER_PATH.is_file()
            else 0
        ),
        "persistent_storage": persistent if config.SERVERLESS_RUNTIME else True,
        "database": "postgres" if using_postgres() else "sqlite",
        "object_storage": "vercel-blob" if blob_configured() else "local",
    }


@router.get("/api/showcase/fixed-master")
async def fixed_peter_master():
    if not config.SHOWCASE_MASTER_PATH.is_file():
        raise HTTPException(
            status_code=503,
            detail="고정 Peter 마스터 스프라이트를 찾지 못했습니다",
        )
    return FileResponse(
        config.SHOWCASE_MASTER_PATH,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=3600"},
    )
