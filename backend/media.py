"""Image upload validation and public asset persistence helpers."""

import io
import uuid
from pathlib import Path

import httpx
from fastapi import HTTPException, UploadFile
from PIL import Image

from peter3d_storage import blob_configured, put_public_blob

from backend import config


async def validated_image_upload(image: UploadFile) -> tuple[bytes, str, str]:
    content_type = (image.content_type or "").lower()
    extensions = {"image/png": ".png", "image/jpeg": ".jpg"}
    if content_type not in extensions:
        raise HTTPException(status_code=415, detail="PNG 또는 JPG 이미지만 업로드할 수 있습니다")
    contents = await image.read(config.MAX_UPLOAD_BYTES + 1)
    if len(contents) > config.MAX_UPLOAD_BYTES:
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


def image_to_png_bytes(image: Image.Image) -> bytes:
    stream = io.BytesIO()
    image.save(stream, format="PNG")
    return stream.getvalue()


async def persist_showcase_sprite(team_id: int, sprite: bytes) -> str:
    sprite_id = uuid.uuid4().hex[:12]
    if blob_configured():
        return await put_public_blob(
            f"teams/{team_id}/sprites/showcase-{sprite_id}.png",
            sprite,
            content_type="image/png",
        )
    if config.SERVERLESS_RUNTIME:
        raise HTTPException(
            status_code=503,
            detail="배포 환경에서 AI 스프라이트를 저장하려면 Vercel Blob 연결이 필요합니다",
        )
    filename = f"team-{team_id}-sprite-{sprite_id}.png"
    (config.UPLOADS_DIR / filename).write_bytes(sprite)
    return f"/uploads/{filename}"


async def persist_showcase_asset(
    team_id: int,
    kind: str,
    contents: bytes,
    *,
    content_type: str = "image/png",
    extension: str = ".png",
) -> str:
    asset_id = uuid.uuid4().hex[:12]
    if blob_configured():
        return await put_public_blob(
            f"teams/{team_id}/sprites/{kind}-{asset_id}{extension}",
            contents,
            content_type=content_type,
        )
    if config.SERVERLESS_RUNTIME:
        raise HTTPException(status_code=503, detail="Vercel Blob 연결이 필요합니다")
    filename = f"team-{team_id}-{kind}-{asset_id}{extension}"
    (config.UPLOADS_DIR / filename).write_bytes(contents)
    return f"/uploads/{filename}"


async def read_public_asset_bytes(url: str) -> bytes:
    if url.startswith("/uploads/"):
        path = config.UPLOADS_DIR / Path(url).name
        return path.read_bytes()
    if url.startswith("/static/"):
        path = config.ROOT / url.lstrip("/")
        return path.read_bytes()
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as client:
        response = await client.get(url)
    response.raise_for_status()
    return response.content
