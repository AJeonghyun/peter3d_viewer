"""GLB validation and storage for manually uploaded 3D character models."""

import json
import struct
from pathlib import Path

from fastapi import HTTPException, UploadFile

from peter3d_storage import blob_configured, put_public_blob

from backend import config


def inspect_animated_glb(contents: bytes, *, minimum_animations: int = 1) -> dict:
    """Validate the runtime contract before publishing a generated character."""
    if len(contents) > config.MAX_GLB_BYTES:
        raise ValueError(f"GLB는 {config.MAX_GLB_BYTES // (1024 * 1024)}MB 이하여야 합니다")
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
    if len(animations) < minimum_animations:
        raise ValueError(
            f"GLB에 애니메이션이 {len(animations)}개만 있습니다 "
            f"(필요: {minimum_animations}개)"
        )
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
    if triangle_count > config.MAX_GLB_TRIANGLES:
        raise ValueError(
            f"GLB가 너무 복잡합니다: {triangle_count:,} 삼각형 "
            f"(최대 {config.MAX_GLB_TRIANGLES:,})"
        )
    return {
        "bytes": len(contents),
        "triangles": triangle_count,
        "animations": len(animations),
        "skins": len(skins),
    }


async def validated_glb_upload(glb: UploadFile) -> tuple[bytes, dict]:
    filename = (glb.filename or "").strip()
    if Path(filename).suffix.lower() != ".glb":
        raise HTTPException(status_code=415, detail=".glb 파일만 등록할 수 있습니다")
    contents = await glb.read(config.MAX_GLB_BYTES + 1)
    if len(contents) > config.MAX_GLB_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"GLB는 {config.MAX_GLB_BYTES // (1024 * 1024)}MB 이하여야 합니다",
        )
    if not contents:
        raise HTTPException(status_code=422, detail="빈 GLB 파일은 등록할 수 없습니다")
    try:
        metrics = inspect_animated_glb(contents)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return contents, metrics


async def persist_uploaded_glb(asset_id: str, contents: bytes) -> str:
    if blob_configured():
        return await put_public_blob(
            f"model-assets/{asset_id}/model.glb",
            contents,
            content_type="model/gltf-binary",
            multipart=True,
        )
    if config.SERVERLESS_RUNTIME:
        raise HTTPException(status_code=503, detail="Vercel Blob 연결이 필요합니다")

    target = config.MODELS_DIR / "model-assets" / asset_id / "model.glb"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(contents)
    try:
        public_path = target.resolve().relative_to((config.ROOT / "static").resolve())
    except ValueError as exc:
        target.unlink(missing_ok=True)
        raise HTTPException(
            status_code=503,
            detail="로컬 모델 폴더가 static 폴더 안에 있어야 합니다",
        ) from exc
    return f"/static/{public_path.as_posix()}"
