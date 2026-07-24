"""Showcase sprite generation and student worksheet capture processing."""

import io
import json
import uuid
from typing import Optional

from fastapi import APIRouter, File, HTTPException, UploadFile
from PIL import Image

from peter3d_storage import blob_configured, delete_blob_if_managed

from backend import ai_generation, ai_review, config
from backend.capture import correct_capture_image, extract_garment_parts
from backend.compose_state import ensure_compose_not_active, update_showcase_sprite_status
from backend.db import connect_db, loads_json, now_iso, row_dict
from backend.media import (
    image_to_png_bytes,
    persist_showcase_asset,
    persist_showcase_sprite,
    read_public_asset_bytes,
    validated_image_upload,
)
from backend.serializers import (
    get_sprite_version_or_404,
    get_team_or_404,
    public_sprite_version,
    public_team,
)

router = APIRouter()


@router.post("/api/teams/{team_id}/showcase-sprite")
async def generate_showcase_sprite(team_id: int, reference: UploadFile = File(...)):
    if config.SERVERLESS_RUNTIME and not blob_configured():
        raise HTTPException(
            status_code=503,
            detail="배포 환경에서 AI 스프라이트를 저장하려면 Vercel Blob 연결이 필요합니다",
        )
    with connect_db() as db:
        previous_team = row_dict(get_team_or_404(db, team_id))
    if not previous_team["showcase_image_url"]:
        raise HTTPException(status_code=409, detail="먼저 이 조의 2D 캐릭터 사진을 등록해주세요")

    contents, content_type, _ = await validated_image_upload(reference)
    correction = ""
    previous_quality = previous_team.get("showcase_sprite_quality_json")
    if previous_quality:
        try:
            quality_payload = json.loads(previous_quality)
            correction = json.dumps({
                "summary": quality_payload.get("summary"),
                "pixel_issues": quality_payload.get("deterministic", {}).get("issues", []),
                "ai_issues": quality_payload.get("ai", {}).get("issues", []),
                "failed_frames": [
                    frame
                    for frame in quality_payload.get("deterministic", {}).get("frames", [])
                    if frame.get("status") == "failed"
                ],
                "ai_frames": quality_payload.get("ai", {}).get("frames", []),
            }, ensure_ascii=False)
        except (json.JSONDecodeError, TypeError):
            correction = ""
    update_showcase_sprite_status(team_id, "generating", error=None)
    try:
        sprite = await ai_generation.request_showcase_sprite(
            contents,
            content_type,
            reference.filename or "peter-reference.png",
            correction=correction,
        )
        quality = await ai_review.inspect_showcase_sprite_quality(sprite)
        sprite_url = await persist_showcase_sprite(team_id, sprite)
        updated = update_showcase_sprite_status(
            team_id,
            "review",
            url=sprite_url,
            error=None,
            quality=quality,
        )
    except HTTPException as exc:
        update_showcase_sprite_status(team_id, "failed", error=str(exc.detail)[:300])
        raise
    except Exception as exc:  # noqa: BLE001 - external generation boundary
        update_showcase_sprite_status(team_id, "failed", error="AI 캐릭터 생성 중 오류가 발생했습니다")
        raise HTTPException(
            status_code=502,
            detail="AI 캐릭터 생성 중 오류가 발생했습니다",
        ) from exc

    previous_url = previous_team["showcase_sprite_url"]
    if (
        previous_url
        and previous_url != sprite_url
        and previous_url != previous_team["showcase_sprite_active_url"]
    ):
        await delete_blob_if_managed(previous_url)
    return updated


@router.post("/api/teams/{team_id}/capture/process")
async def process_showcase_capture(team_id: int, reference: UploadFile = File(...)):
    if config.SERVERLESS_RUNTIME and not blob_configured():
        raise HTTPException(status_code=503, detail="Vercel Blob 연결이 필요합니다")
    with connect_db() as db:
        team = row_dict(get_team_or_404(db, team_id))
    ensure_compose_not_active(team)
    contents, content_type, extension = await validated_image_upload(reference)
    timestamp = now_iso()
    with connect_db() as db:
        db.execute(
            """
            UPDATE teams
            SET showcase_capture_status = 'processing',
                showcase_capture_url = NULL,
                showcase_capture_corrected_url = NULL,
                showcase_sprite_status = 'processing',
                showcase_sprite_url = NULL,
                showcase_sprite_version_id = NULL,
                showcase_sprite_error = NULL,
                showcase_sprite_quality_status = 'unchecked',
                showcase_sprite_quality_json = NULL,
                showcase_sprite_updated_at = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (timestamp, timestamp, team_id),
        )
    quality = await ai_generation.request_capture_quality_review(contents, content_type)
    if not quality.get("can_process", False):
        timestamp = now_iso()
        with connect_db() as db:
            db.execute(
                """
                UPDATE teams
                SET showcase_capture_status = 'failed',
                    showcase_sprite_status = 'failed',
                    showcase_capture_quality_json = ?,
                    showcase_sprite_error = ?,
                    showcase_sprite_updated_at = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    json.dumps(quality, ensure_ascii=False),
                    quality.get("summary", "캡처 품질 검수 실패"),
                    timestamp,
                    timestamp,
                    team_id,
                ),
            )
            return {
                "team": public_team(get_team_or_404(db, team_id)),
                "quality": quality,
                "can_process": False,
            }
    source_url = await persist_showcase_asset(
        team_id,
        "capture-source",
        contents,
        content_type=content_type,
        extension=extension,
    )
    timestamp = now_iso()
    with connect_db() as db:
        db.execute(
            """
            UPDATE teams
            SET showcase_capture_source_url = ?, updated_at = ?
            WHERE id = ?
            """,
            (source_url, timestamp, team_id),
        )
    try:
        corrected = correct_capture_image(contents, quality)
        corrected_bytes = image_to_png_bytes(corrected)
        illustration_bytes = await ai_generation.request_capture_illustration(
            corrected_bytes,
            filename=f"team-{team_id}-corrected-capture.png",
        )
        illustration_url = await persist_showcase_asset(
            team_id,
            "capture-illustration",
            illustration_bytes,
        )
    except HTTPException as exc:
        timestamp = now_iso()
        with connect_db() as db:
            db.execute(
                """
                UPDATE teams
                SET showcase_capture_status = 'failed',
                    showcase_sprite_status = 'failed',
                    showcase_sprite_error = ?,
                    showcase_capture_quality_json = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    str(exc.detail)[:300],
                    json.dumps(quality, ensure_ascii=False),
                    timestamp,
                    team_id,
                ),
            )
        raise
    except Exception as exc:  # noqa: BLE001 - image conversion and storage boundary
        detail = "사진을 일러스트로 변환하거나 저장하지 못했습니다"
        timestamp = now_iso()
        with connect_db() as db:
            db.execute(
                """
                UPDATE teams
                SET showcase_capture_status = 'failed',
                    showcase_sprite_status = 'failed',
                    showcase_sprite_error = ?,
                    showcase_capture_quality_json = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    detail,
                    json.dumps(quality, ensure_ascii=False),
                    timestamp,
                    team_id,
                ),
            )
        raise HTTPException(status_code=502, detail=detail) from exc
    version_id = uuid.uuid4().hex
    timestamp = now_iso()
    reference_payload = {
        "contract": config.GARMENT_TRANSFER_CONTRACT,
        "template_size": list(config.GARMENT_TEMPLATE_SIZE),
        "mode": "illustrated-full-body-master-edit",
        "corrected_url": illustration_url,
        "regions": ["upper", "lower", "left_shoe", "right_shoe"],
    }
    with connect_db() as db:
        db.execute(
            """
            INSERT INTO sprite_versions (
                id, team_id, contract, status, source_url, corrected_url,
                quality_json, parts_json, model, created_at, updated_at
            ) VALUES (?, ?, ?, 'reference_ready', ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                version_id,
                team_id,
                config.GARMENT_TRANSFER_CONTRACT,
                source_url,
                illustration_url,
                json.dumps(quality, ensure_ascii=False),
                json.dumps(reference_payload, ensure_ascii=False),
                config.OPENAI_IMAGE_MODEL,
                timestamp,
                timestamp,
            ),
        )
        db.execute(
            """
            UPDATE teams
            SET showcase_capture_url = ?,
                showcase_capture_source_url = ?,
                showcase_capture_corrected_url = ?,
                showcase_capture_status = 'garment_review',
                showcase_capture_quality_json = ?,
                showcase_garment_parts_json = NULL,
                showcase_sprite_contract = ?,
                showcase_sprite_version_id = ?,
                showcase_sprite_status = 'garment_review',
                showcase_sprite_error = NULL,
                showcase_sprite_updated_at = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (
                illustration_url,
                source_url,
                illustration_url,
                json.dumps(quality, ensure_ascii=False),
                config.GARMENT_TRANSFER_CONTRACT,
                version_id,
                timestamp,
                timestamp,
                team_id,
            ),
        )
        return {
            "team": public_team(get_team_or_404(db, team_id)),
            "version": public_sprite_version(get_sprite_version_or_404(db, team_id, version_id)),
            "quality": quality,
            "reference": reference_payload,
            "status": "reference_ready",
        }


@router.post("/api/teams/{team_id}/capture/parts/{part}/retry")
async def retry_showcase_capture_part(
    team_id: int,
    part: str,
    reference: Optional[UploadFile] = File(default=None),
):
    if reference is not None and not hasattr(reference, "content_type"):
        reference = None
    if part not in config.GARMENT_PARTS:
        raise HTTPException(status_code=404, detail="지원하지 않는 의상 영역입니다")
    with connect_db() as db:
        team = row_dict(get_team_or_404(db, team_id))
        version_id = team.get("showcase_sprite_version_id")
        if not version_id:
            raise HTTPException(status_code=409, detail="먼저 캡처를 처리해주세요")
        version = row_dict(get_sprite_version_or_404(db, team_id, version_id))
    if version.get("contract") == config.GARMENT_TRANSFER_CONTRACT:
        raise HTTPException(
            status_code=410,
            detail="마스터 고정 생성에서는 영역별 재추출을 사용하지 않습니다. 전체 사진을 다시 올리거나 32컷을 다시 생성해주세요.",
        )
    if reference is not None:
        contents, content_type, _ = await validated_image_upload(reference)
        quality = await ai_generation.request_capture_quality_review(contents, content_type)
        if not quality.get("can_process", False):
            raise HTTPException(status_code=422, detail=quality.get("summary", "캡처 품질 검수 실패"))
        corrected = correct_capture_image(contents, quality)
    else:
        if not version.get("corrected_url"):
            raise HTTPException(status_code=409, detail="보정된 캡처가 없어 재추출할 수 없습니다")
        corrected_bytes = await read_public_asset_bytes(version["corrected_url"])
        corrected = Image.open(io.BytesIO(corrected_bytes)).convert("RGB")
    part_image = extract_garment_parts(corrected)[part]
    part_url = await persist_showcase_asset(team_id, f"capture-{part}", image_to_png_bytes(part_image))
    parts_payload = loads_json(version.get("parts_json")) or {
        "contract": config.GARMENT_TRANSFER_CONTRACT,
        "template_size": list(config.GARMENT_TEMPLATE_SIZE),
        "crops": {name: list(crop) for name, crop in config.GARMENT_PART_CROPS.items()},
        "urls": {},
    }
    parts_payload.setdefault("urls", {})[part] = part_url
    timestamp = now_iso()
    column = f"{part}_url"
    with connect_db() as db:
        db.execute(
            f"""
            UPDATE sprite_versions
            SET {column} = ?, parts_json = ?, status = 'parts_ready',
                atlas_url = NULL, qa_json = NULL, updated_at = ?
            WHERE id = ? AND team_id = ?
            """,
            (
                part_url,
                json.dumps(parts_payload, ensure_ascii=False),
                timestamp,
                version_id,
                team_id,
            ),
        )
        db.execute(
            """
            UPDATE teams
            SET showcase_garment_parts_json = ?,
                showcase_sprite_status = 'garment_review',
                showcase_sprite_url = NULL,
                showcase_sprite_quality_json = NULL,
                showcase_sprite_quality_status = 'unchecked',
                showcase_sprite_updated_at = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (
                json.dumps(parts_payload, ensure_ascii=False),
                timestamp,
                timestamp,
                team_id,
            ),
        )
        return {
            "team": public_team(get_team_or_404(db, team_id)),
            "version": public_sprite_version(get_sprite_version_or_404(db, team_id, version_id)),
            "part": part,
            "part_url": part_url,
            "status": "parts_ready",
        }
