"""25-frame master-locked compose workflow: start, generate, patch, review."""

import asyncio
import json
import time
import uuid

import httpx
from fastapi import APIRouter, HTTPException

from backend import ai_generation, ai_review, config
from backend.compose_state import (
    compose_next_action,
    compose_response,
    current_compose_version,
    ensure_compose_not_active,
    frame_patch_metadata,
    record_compose_failure,
    record_compose_retry,
    retryable_compose_error,
)
from backend.db import connect_db, loads_json, now_iso
from backend.media import (
    image_to_png_bytes,
    persist_showcase_asset,
    read_public_asset_bytes,
)
from backend.schemas import SpriteFramePatchPayload
from backend.sprite_pixels import replace_garment_atlas_frame

router = APIRouter()


@router.get("/api/teams/{team_id}/capture/compose/status")
async def get_showcase_compose_status(team_id: int):
    _, version = current_compose_version(team_id)
    with connect_db() as db:
        return compose_response(db, team_id, version["id"])


@router.post("/api/teams/{team_id}/capture/compose")
@router.post("/api/teams/{team_id}/capture/compose/start")
async def start_showcase_capture_compose(team_id: int):
    team, version = current_compose_version(team_id)
    active_statuses = {"queued", "generating", "composing", "generated", "reviewing", "saving"}
    if (
        version.get("status") in active_statuses
        and team.get("showcase_sprite_status") in {"generating", "composing", "reviewing", "saving"}
    ):
        with connect_db() as db:
            return compose_response(db, team_id, version["id"])

    timestamp = now_iso()
    parts_payload = loads_json(version.get("parts_json"))
    if isinstance(parts_payload, dict):
        parts_payload.pop("frame_patch", None)
    with connect_db() as db:
        db.execute(
            """
            UPDATE sprite_versions
            SET status = 'queued', error = NULL, parts_json = ?, updated_at = ?
            WHERE id = ? AND team_id = ?
            """,
            (
                json.dumps(parts_payload, ensure_ascii=False) if parts_payload else None,
                timestamp,
                version["id"],
                team_id,
            ),
        )
        db.execute(
            """
            UPDATE teams
            SET showcase_sprite_status = 'generating', showcase_sprite_error = NULL,
                showcase_sprite_updated_at = ?, updated_at = ?
            WHERE id = ? AND showcase_sprite_version_id = ?
            """,
            (timestamp, timestamp, team_id, version["id"]),
        )
        return compose_response(
            db,
            team_id,
            version["id"],
            next_action="generate",
        )


@router.post("/api/teams/{team_id}/capture/compose/patch/start")
async def start_showcase_frame_patch(team_id: int, payload: SpriteFramePatchPayload):
    team, source_version = current_compose_version(team_id)
    frames = sorted(set(payload.frames))
    frame_count = config.GARMENT_ATLAS_COLUMNS * config.GARMENT_ATLAS_ROWS
    invalid_frames = [frame for frame in frames if frame < 1 or frame > frame_count]
    if invalid_frames:
        raise HTTPException(status_code=422, detail="프레임 번호는 1부터 25까지여야 합니다")
    existing_patch = frame_patch_metadata(source_version)
    if team.get("showcase_sprite_status") in config.COMPOSE_ACTIVE_TEAM_STATUSES and existing_patch:
        existing_frames = sorted({
            frame for frame in existing_patch.get("frames", [])
            if isinstance(frame, int)
        })
        if existing_frames == frames:
            with connect_db() as db:
                return compose_response(db, team_id, source_version["id"])
        raise HTTPException(status_code=409, detail="다른 문제 컷 교체 작업이 이미 진행 중입니다")
    ensure_compose_not_active(team)
    if source_version.get("contract") != config.GARMENT_TRANSFER_CONTRACT:
        raise HTTPException(status_code=409, detail="마스터 고정 25컷만 문제 컷을 교체할 수 있습니다")
    if not source_version.get("atlas_url"):
        raise HTTPException(status_code=409, detail="교체할 기존 25컷 아틀라스가 없습니다")
    source_qa = source_version.get("qa_json") or team.get("showcase_sprite_quality_json")
    problem_frames = set(ai_review.garment_problem_frames(source_qa))
    if not problem_frames:
        raise HTTPException(status_code=409, detail="현재 QA에서 재생성이 필요한 컷이 없습니다")
    non_problem_frames = [frame for frame in frames if frame not in problem_frames]
    if non_problem_frames:
        raise HTTPException(
            status_code=422,
            detail=f"현재 QA 문제 컷만 선택할 수 있습니다: {', '.join(map(str, sorted(problem_frames)))}",
        )

    timestamp = now_iso()
    version_id = f"sprite-{team_id}-{uuid.uuid4().hex}"
    parts_payload = loads_json(source_version.get("parts_json"))
    if not isinstance(parts_payload, dict):
        parts_payload = {}
    parts_payload.pop("frame_patch", None)
    parts_payload["frame_patch"] = {
        "source_version_id": source_version["id"],
        "frames": frames,
        "completed_frames": [],
        "issues": {
            str(frame): ai_review.garment_frame_retry_instruction(source_qa, frame)
            for frame in frames
        },
    }
    with connect_db() as db:
        db.execute(
            """
            INSERT INTO sprite_versions (
                id, team_id, contract, status, error, source_url, corrected_url,
                upper_url, lower_url, left_shoe_url, right_shoe_url, atlas_url,
                quality_json, parts_json, qa_json, model, created_at, updated_at
            ) VALUES (?, ?, ?, 'queued', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                version_id,
                team_id,
                config.GARMENT_TRANSFER_CONTRACT,
                source_version.get("source_url"),
                source_version.get("corrected_url"),
                source_version.get("upper_url"),
                source_version.get("lower_url"),
                source_version.get("left_shoe_url"),
                source_version.get("right_shoe_url"),
                source_version["atlas_url"],
                source_version.get("quality_json"),
                json.dumps(parts_payload, ensure_ascii=False),
                source_qa,
                config.OPENAI_IMAGE_MODEL,
                timestamp,
                timestamp,
            ),
        )
        updated = db.execute(
            """
            UPDATE teams
            SET showcase_sprite_version_id = ?,
                showcase_sprite_url = ?,
                showcase_sprite_status = 'generating',
                showcase_sprite_error = NULL,
                showcase_sprite_updated_at = ?,
                updated_at = ?
            WHERE id = ? AND showcase_sprite_version_id = ?
            """,
            (
                version_id,
                source_version["atlas_url"],
                timestamp,
                timestamp,
                team_id,
                source_version["id"],
            ),
        )
        if updated.rowcount != 1:
            db.execute(
                "DELETE FROM sprite_versions WHERE id = ? AND team_id = ?",
                (version_id, team_id),
            )
            raise HTTPException(
                status_code=409,
                detail="다른 생성 작업이 먼저 시작되었습니다. 현재 상태를 다시 확인해주세요.",
            )
        return compose_response(
            db,
            team_id,
            version_id,
            next_action="patch",
        )


@router.post("/api/teams/{team_id}/capture/compose/patch")
async def regenerate_showcase_frame_patch(team_id: int):
    request_started = time.monotonic()
    _, version = current_compose_version(team_id)
    version_id = version["id"]
    next_action = compose_next_action(version)
    if next_action in {"generate", "review", "complete", "failed"}:
        with connect_db() as db:
            return compose_response(db, team_id, version_id)
    if next_action == "wait":
        with connect_db() as db:
            return compose_response(
                db,
                team_id,
                version_id,
                next_action="wait",
                retry_after_seconds=3,
            )

    parts_payload = loads_json(version.get("parts_json"))
    patch = frame_patch_metadata(version)
    if not isinstance(parts_payload, dict) or not patch:
        raise HTTPException(status_code=409, detail="문제 컷 교체 작업 정보가 없습니다")
    frames = [frame for frame in patch.get("frames", []) if isinstance(frame, int)]
    completed = [frame for frame in patch.get("completed_frames", []) if isinstance(frame, int)]
    remaining = [frame for frame in frames if frame not in completed]
    if not remaining:
        with connect_db() as db:
            db.execute(
                """
                UPDATE sprite_versions SET status = 'generated', updated_at = ?
                WHERE id = ? AND team_id = ?
                """,
                (now_iso(), version_id, team_id),
            )
            return compose_response(db, team_id, version_id, next_action="review")
    frame = remaining[0]

    def report_timing(stage: str) -> None:
        print(
            json.dumps({
                "event": "garment_frame_patch_stage",
                "team_id": team_id,
                "version_id": version_id,
                "frame": frame,
                "stage": stage,
                "elapsed_seconds": round(time.monotonic() - request_started, 2),
            }),
            flush=True,
        )

    timestamp = now_iso()
    with connect_db() as db:
        claimed = db.execute(
            """
            UPDATE sprite_versions
            SET status = 'generating', error = NULL, updated_at = ?
            WHERE id = ? AND team_id = ? AND status = ? AND updated_at = ?
            """,
            (
                timestamp,
                version_id,
                team_id,
                version.get("status"),
                version.get("updated_at"),
            ),
        )
        if claimed.rowcount != 1:
            return compose_response(
                db,
                team_id,
                version_id,
                next_action="wait",
                retry_after_seconds=3,
            )

    def report_progress(status: str) -> None:
        progress_timestamp = now_iso()
        with connect_db() as db:
            db.execute(
                """
                UPDATE sprite_versions
                SET status = ?, error = NULL, updated_at = ?
                WHERE id = ? AND team_id = ?
                """,
                (status, progress_timestamp, version_id, team_id),
            )
            db.execute(
                """
                UPDATE teams
                SET showcase_sprite_status = ?, showcase_sprite_error = NULL,
                    showcase_sprite_updated_at = ?, updated_at = ?
                WHERE id = ? AND showcase_sprite_version_id = ?
                """,
                (status, progress_timestamp, progress_timestamp, team_id, version_id),
            )
        report_timing(status)

    try:
        atlas_bytes, corrected_bytes = await asyncio.gather(
            read_public_asset_bytes(version["atlas_url"]),
            read_public_asset_bytes(version["corrected_url"]),
        )
        replacement_bytes = await ai_generation.request_master_locked_garment_frame(
            corrected_bytes,
            atlas_bytes,
            frame,
            filename=f"team-{team_id}-corrected-peter.png",
            correction=str((patch.get("issues") or {}).get(str(frame), "")),
            on_progress=report_progress,
        )
        patched_atlas = replace_garment_atlas_frame(atlas_bytes, replacement_bytes, frame)
        patched_bytes = image_to_png_bytes(patched_atlas)
        atlas_url = await persist_showcase_asset(
            team_id,
            f"sprite-v4-frame-{frame}",
            patched_bytes,
        )
    except HTTPException as exc:
        report_timing(f"failed_{exc.status_code}")
        if retryable_compose_error(exc):
            return record_compose_retry(
                team_id,
                version_id,
                version_status="queued",
                team_status="generating",
                detail=str(exc.detail),
            )
        record_compose_failure(team_id, version_id, str(exc.detail))
        raise
    except (httpx.HTTPError, OSError) as exc:
        report_timing("failed_transient")
        return record_compose_retry(
            team_id,
            version_id,
            version_status="queued",
            team_status="generating",
            detail=f"{frame}컷 교체 결과를 처리하지 못했습니다: {str(exc)[:160]}",
        )
    except Exception as exc:  # noqa: BLE001 - persist a terminal stage instead of stranding the lease
        report_timing("failed_internal")
        detail = f"{frame}컷 교체 결과를 처리하지 못했습니다: {str(exc)[:220]}"
        record_compose_failure(team_id, version_id, detail)
        raise HTTPException(status_code=502, detail=detail) from exc

    completed = [*completed, frame]
    patch["completed_frames"] = completed
    parts_payload["frame_patch"] = patch
    remaining = [candidate for candidate in frames if candidate not in completed]
    version_status = "queued" if remaining else "generated"
    team_status = "generating" if remaining else "reviewing"
    timestamp = now_iso()
    with connect_db() as db:
        db.execute(
            """
            UPDATE sprite_versions
            SET status = ?, error = NULL, atlas_url = ?, parts_json = ?,
                model = ?, updated_at = ?
            WHERE id = ? AND team_id = ?
            """,
            (
                version_status,
                atlas_url,
                json.dumps(parts_payload, ensure_ascii=False),
                config.OPENAI_IMAGE_MODEL,
                timestamp,
                version_id,
                team_id,
            ),
        )
        db.execute(
            """
            UPDATE teams
            SET showcase_sprite_url = ?,
                showcase_sprite_status = ?,
                showcase_sprite_error = NULL,
                showcase_sprite_updated_at = ?,
                updated_at = ?
            WHERE id = ? AND showcase_sprite_version_id = ?
            """,
            (
                atlas_url,
                team_status,
                timestamp,
                timestamp,
                team_id,
                version_id,
            ),
        )
        report_timing("frame_replaced")
        return compose_response(
            db,
            team_id,
            version_id,
            next_action="patch" if remaining else "review",
        )


@router.post("/api/teams/{team_id}/capture/compose/generate")
async def generate_showcase_capture_atlas(team_id: int):
    request_started = time.monotonic()

    def report_timing(stage: str) -> None:
        print(
            json.dumps({
                "event": "garment_compose_stage",
                "team_id": team_id,
                "stage": stage,
                "elapsed_seconds": round(time.monotonic() - request_started, 2),
            }),
            flush=True,
        )

    _, version = current_compose_version(team_id)
    version_id = version["id"]
    next_action = compose_next_action(version)
    if next_action in {"patch", "review", "complete", "failed"}:
        with connect_db() as db:
            return compose_response(db, team_id, version_id)
    if next_action == "wait":
        with connect_db() as db:
            return compose_response(
                db,
                team_id,
                version_id,
                next_action="wait",
                retry_after_seconds=3,
            )

    timestamp = now_iso()
    with connect_db() as db:
        claimed = db.execute(
            """
            UPDATE sprite_versions
            SET status = 'generating', error = NULL, updated_at = ?
            WHERE id = ? AND team_id = ? AND status = ? AND updated_at = ?
            """,
            (
                timestamp,
                version_id,
                team_id,
                version.get("status"),
                version.get("updated_at"),
            ),
        )
        if claimed.rowcount != 1:
            return compose_response(
                db,
                team_id,
                version_id,
                next_action="wait",
                retry_after_seconds=3,
            )
        db.execute(
            """
            UPDATE teams
            SET showcase_sprite_status = 'generating', showcase_sprite_error = NULL,
                showcase_sprite_updated_at = ?, updated_at = ?
            WHERE id = ? AND showcase_sprite_version_id = ?
            """,
            (timestamp, timestamp, team_id, version_id),
        )

    correction = ai_review.garment_retry_instruction(version.get("qa_json"))

    def report_progress(status: str) -> None:
        progress_timestamp = now_iso()
        with connect_db() as db:
            db.execute(
                """
                UPDATE sprite_versions
                SET status = ?, error = NULL, updated_at = ?
                WHERE id = ? AND team_id = ?
                """,
                (status, progress_timestamp, version_id, team_id),
            )
            db.execute(
                """
                UPDATE teams
                SET showcase_sprite_status = ?, showcase_sprite_error = NULL,
                    showcase_sprite_updated_at = ?, updated_at = ?
                WHERE id = ? AND showcase_sprite_version_id = ?
                """,
                (status, progress_timestamp, progress_timestamp, team_id, version_id),
            )
        report_timing(status)

    try:
        corrected_bytes = await read_public_asset_bytes(version["corrected_url"])
        report_timing("generation_started")
        atlas_bytes = await ai_generation.request_master_locked_garment_atlas(
            corrected_bytes,
            filename=f"team-{team_id}-corrected-peter.png",
            correction=correction,
            on_progress=report_progress,
        )
        atlas_url = await persist_showcase_asset(team_id, "sprite-v4-atlas", atlas_bytes)
    except HTTPException as exc:
        report_timing(f"failed_{exc.status_code}")
        if retryable_compose_error(exc):
            return record_compose_retry(
                team_id,
                version_id,
                version_status="queued",
                team_status="generating",
                detail=str(exc.detail),
            )
        record_compose_failure(team_id, version_id, str(exc.detail))
        raise
    except (httpx.HTTPError, OSError) as exc:
        report_timing("failed_transient")
        return record_compose_retry(
            team_id,
            version_id,
            version_status="queued",
            team_status="generating",
            detail=f"25컷 생성 결과를 처리하지 못했습니다: {str(exc)[:160]}",
        )
    except Exception as exc:  # noqa: BLE001 - persist a terminal stage instead of stranding the lease
        report_timing("failed_internal")
        detail = f"25컷 생성 결과를 처리하지 못했습니다: {str(exc)[:220]}"
        record_compose_failure(team_id, version_id, detail)
        raise HTTPException(status_code=502, detail=detail) from exc

    timestamp = now_iso()
    with connect_db() as db:
        db.execute(
            """
            UPDATE sprite_versions
            SET status = 'generated', error = NULL, atlas_url = ?,
                model = ?, updated_at = ?
            WHERE id = ? AND team_id = ?
            """,
            (
                atlas_url,
                config.OPENAI_IMAGE_MODEL,
                timestamp,
                version_id,
                team_id,
            ),
        )
        db.execute(
            """
            UPDATE teams
            SET showcase_sprite_status = 'reviewing',
                showcase_sprite_error = NULL,
                showcase_sprite_updated_at = ?,
                updated_at = ?
            WHERE id = ? AND showcase_sprite_version_id = ?
            """,
            (
                timestamp,
                timestamp,
                team_id,
                version_id,
            ),
        )
        report_timing("generated")
        return compose_response(
            db,
            team_id,
            version_id,
            next_action="review",
        )


@router.post("/api/teams/{team_id}/capture/compose/review")
async def review_showcase_capture_atlas(team_id: int):
    request_started = time.monotonic()
    _, version = current_compose_version(team_id)
    version_id = version["id"]
    next_action = compose_next_action(version)
    if next_action in {"complete", "failed"}:
        with connect_db() as db:
            return compose_response(db, team_id, version_id)
    if next_action in {"generate", "patch", "wait"} and version.get("status") != "generated":
        with connect_db() as db:
            return compose_response(
                db,
                team_id,
                version_id,
                next_action=next_action,
                retry_after_seconds=3 if next_action == "wait" else None,
            )
    if not version.get("atlas_url"):
        raise HTTPException(status_code=409, detail="저장된 25컷 결과가 없어 다시 생성해야 합니다")

    timestamp = now_iso()
    with connect_db() as db:
        claimed = db.execute(
            """
            UPDATE sprite_versions
            SET status = 'reviewing', error = NULL, updated_at = ?
            WHERE id = ? AND team_id = ? AND status = ? AND updated_at = ?
            """,
            (
                timestamp,
                version_id,
                team_id,
                version.get("status"),
                version.get("updated_at"),
            ),
        )
        if claimed.rowcount != 1:
            return compose_response(
                db,
                team_id,
                version_id,
                next_action="wait",
                retry_after_seconds=3,
            )
        db.execute(
            """
            UPDATE teams
            SET showcase_sprite_status = 'reviewing', showcase_sprite_error = NULL,
                showcase_sprite_updated_at = ?, updated_at = ?
            WHERE id = ? AND showcase_sprite_version_id = ?
            """,
            (timestamp, timestamp, team_id, version_id),
        )

    try:
        atlas_bytes, corrected_bytes = await asyncio.gather(
            read_public_asset_bytes(version["atlas_url"]),
            read_public_asset_bytes(version["corrected_url"]),
        )
        qa = await ai_review.inspect_garment_atlas_quality(atlas_bytes, corrected_bytes)
    except HTTPException as exc:
        if retryable_compose_error(exc):
            return record_compose_retry(
                team_id,
                version_id,
                version_status="generated",
                team_status="reviewing",
                detail=str(exc.detail),
            )
        record_compose_failure(team_id, version_id, str(exc.detail))
        raise
    except (httpx.HTTPError, OSError) as exc:
        return record_compose_retry(
            team_id,
            version_id,
            version_status="generated",
            team_status="reviewing",
            detail=f"25컷 QA 자료를 불러오지 못했습니다: {str(exc)[:160]}",
        )
    except Exception as exc:  # noqa: BLE001 - persist a terminal stage instead of stranding the lease
        detail = f"25컷 QA를 완료하지 못했습니다: {str(exc)[:220]}"
        record_compose_failure(team_id, version_id, detail)
        raise HTTPException(status_code=502, detail=detail) from exc

    timestamp = now_iso()
    with connect_db() as db:
        db.execute(
            """
            UPDATE sprite_versions
            SET status = 'saving', error = NULL, updated_at = ?
            WHERE id = ? AND team_id = ?
            """,
            (timestamp, version_id, team_id),
        )
        db.execute(
            """
            UPDATE teams
            SET showcase_sprite_status = 'saving', showcase_sprite_error = NULL,
                showcase_sprite_updated_at = ?, updated_at = ?
            WHERE id = ? AND showcase_sprite_version_id = ?
            """,
            (timestamp, timestamp, team_id, version_id),
        )
        db.execute(
            """
            UPDATE sprite_versions
            SET status = 'review', error = NULL, qa_json = ?,
                model = ?, updated_at = ?
            WHERE id = ? AND team_id = ?
            """,
            (
                json.dumps(qa, ensure_ascii=False),
                config.OPENAI_IMAGE_MODEL,
                timestamp,
                version_id,
                team_id,
            ),
        )
        db.execute(
            """
            UPDATE teams
            SET showcase_sprite_url = ?,
                showcase_sprite_status = 'review',
                showcase_sprite_error = NULL,
                showcase_sprite_model = ?,
                showcase_sprite_quality_status = ?,
                showcase_sprite_quality_json = ?,
                showcase_sprite_qa_model = ?,
                showcase_sprite_contract = ?,
                showcase_sprite_version_id = ?,
                showcase_sprite_updated_at = ?,
                updated_at = ?
            WHERE id = ? AND showcase_sprite_version_id = ?
            """,
            (
                version["atlas_url"],
                config.OPENAI_IMAGE_MODEL,
                qa.get("status", "unchecked"),
                json.dumps(qa, ensure_ascii=False),
                config.OPENAI_SPRITE_QA_MODEL,
                config.GARMENT_TRANSFER_CONTRACT,
                version_id,
                timestamp,
                timestamp,
                team_id,
                version_id,
            ),
        )
        print(
            json.dumps({
                "event": "garment_compose_stage",
                "team_id": team_id,
                "stage": "completed",
                "elapsed_seconds": round(time.monotonic() - request_started, 2),
            }),
            flush=True,
        )
        return compose_response(
            db,
            team_id,
            version_id,
            next_action="complete",
        )
