"""Compatibility entrypoint for the Peter3D retreat backend.

The implementation now lives in the ``backend`` package. This module keeps the
historical import surface working: ``uvicorn backend_main:app``, the Vercel
entrypoint (``api/index.py``), and the test suite all import from here.
"""

import base64  # noqa: F401 - re-exported for tests
import httpx  # noqa: F401 - re-exported for tests
from fastapi import UploadFile  # noqa: F401 - re-exported for tests

from backend import config
from backend.app import app  # noqa: F401
from backend.config import (  # noqa: F401
    CHROMA_EDGE_FEATHER_RADIUS,
    CHROMA_SPILL_TOLERANCE,
    COMPOSE_ACTIVE_TEAM_STATUSES,
    COMPOSE_GENERATION_LEASE_SECONDS,
    COMPOSE_RETRY_AFTER_SECONDS,
    COMPOSE_REVIEW_LEASE_SECONDS,
    DATA_DIR,
    DB_PATH,
    FRONTEND_DIST,
    GARMENT_AI_ATLAS_HEIGHT,
    GARMENT_AI_ATLAS_SIZE,
    GARMENT_AI_ATLAS_WIDTH,
    GARMENT_AI_BACKGROUND,
    GARMENT_AI_CELL_SIZE,
    GARMENT_AI_FRAME_IMAGE_SIZE,
    GARMENT_AI_FRAME_SIZE,
    GARMENT_AI_IMAGE_SIZE,
    GARMENT_ATLAS_HEIGHT,
    GARMENT_ATLAS_CELL_SIZE,
    GARMENT_ATLAS_COLUMNS,
    GARMENT_ATLAS_ROWS,
    GARMENT_ATLAS_SIZE,
    GARMENT_ATLAS_WIDTH,
    GARMENT_DISPLAY_SCALE,
    GARMENT_FRAME_COUNT,
    GARMENT_FRAME_EDIT_PROMPT,
    GARMENT_IMAGE_TIMEOUT_SECONDS,
    GARMENT_MASTER_EDIT_PROMPT,
    GARMENT_PART_CROPS,
    GARMENT_PARTS,
    GARMENT_TEMPLATE_SIZE,
    GARMENT_TRANSFER_CONTRACT,
    LEGACY_GARMENT_TRANSFER_CONTRACT,
    MAX_GLB_BYTES,
    MAX_GLB_TRIANGLES,
    MAX_SPRITE_BYTES,
    MAX_UPLOAD_BYTES,
    MODELS_DIR,
    OPENAI_IMAGE_API_URL,
    OPENAI_IMAGE_INPUT_FIDELITY,
    OPENAI_IMAGE_MODEL,
    OPENAI_IMAGE_QUALITY,
    OPENAI_QA_TIMEOUT_SECONDS,
    OPENAI_RESPONSES_API_URL,
    OPENAI_SPRITE_QA_MODEL,
    PRE_CAMPFIRE_GARMENT_TRANSFER_CONTRACT,
    PREVIOUS_GARMENT_TRANSFER_CONTRACT,
    ROOT,
    SERVERLESS_RUNTIME,
    SHOWCASE_EXPANDED_MASTER_PATH,
    SHOWCASE_FRAME_SAFE_MARGIN,
    SHOWCASE_MASTER_PATH,
    SHOWCASE_RETREAT_MASTER_PATH,
    SHOWCASE_SAFE_MASTER_PATH,
    SHOWCASE_SOURCE_MASTER_PATH,
    SHOWCASE_SPRITE_COLUMNS,
    SHOWCASE_SPRITE_HEIGHT,
    SHOWCASE_SPRITE_PROMPT,
    SHOWCASE_SPRITE_QA_PROMPT,
    SHOWCASE_SPRITE_ROWS,
    SHOWCASE_SPRITE_SIZE,
    SHOWCASE_SPRITE_WIDTH,
    STAT_KEYS,
    TEAM_COUNT,
    UPLOADS_DIR,
    V5_GARMENT_TRANSFER_CONTRACT,
)
from backend.db import connect_db, init_db, now_iso, row_dict  # noqa: F401
from backend.schemas import (  # noqa: F401
    ActiveSeatingPresetPayload,
    GrowthCreate,
    ModelAssetApply,
    SeatingPresetPayload,
    SpriteApprovalPayload,
    SpriteFramePatchPayload,
    TeamUpdate,
)
from backend.serializers import (  # noqa: F401
    derive_title,
    get_sprite_version_or_404,
    get_team_or_404,
    public_model_asset,
    public_sprite_contract,
    public_sprite_version,
    public_team,
    validate_group_order,
)
from backend.glb import (  # noqa: F401
    inspect_animated_glb,
    persist_uploaded_glb,
    validated_glb_upload,
)
from backend.media import (  # noqa: F401
    image_to_png_bytes,
    persist_showcase_asset,
    persist_showcase_sprite,
    read_public_asset_bytes,
    validated_image_upload,
)
from backend.sprite_pixels import (  # noqa: F401
    analyze_garment_atlas_pixels,
    analyze_showcase_sprite_pixels,
    count_chroma_spill_pixels,
    decontaminate_chroma_contour,
    frame_reference_for_ai,
    garment_atlas_frame_box,
    master_display_target_bbox,
    master_frame_reference_for_ai,
    master_reference_for_ai,
    load_garment_master_atlas,
    normalize_master_locked_atlas,
    normalize_master_locked_frame,
    remove_connected_cell_background,
    remove_detached_alpha_components,
    replace_garment_atlas_frame,
    validate_showcase_sprite_png,
)
from backend.capture import (  # noqa: F401
    apply_garment_parts_to_cell,
    compose_garment_atlas,
    correct_capture_image,
    default_capture_quality,
    extract_garment_parts,
    neutral_paper_white_balance,
    normalize_capture_quality,
)
from backend.ai_generation import (  # noqa: F401
    openai_error_detail,
    request_capture_quality_review,
    request_master_locked_garment_atlas,
    request_master_locked_garment_frame,
    request_showcase_sprite,
)
from backend.ai_review import (  # noqa: F401
    garment_frame_retry_instruction,
    garment_problem_frames,
    garment_retry_instruction,
    inspect_garment_atlas_quality,
    inspect_showcase_sprite_quality,
    request_garment_atlas_ai_review,
    request_showcase_sprite_ai_review,
)
from backend.compose_state import (  # noqa: F401
    ensure_compose_not_active,
    update_showcase_sprite_status,
)
from backend.routes.pages import (  # noqa: F401
    admin_page,
    fixed_peter_master,
    frontend_index,
    health,
    legacy_world_page,
    retreat_display_page,
    world_page,
)
from backend.routes.teams import (  # noqa: F401
    add_growth,
    get_team,
    list_teams,
    team_history,
    update_team,
    upload_team_image,
)
from backend.routes.seating import (  # noqa: F401
    create_seating_preset,
    delete_seating_preset,
    ensure_default_seating_preset,
    get_active_seating_preset_id,
    get_seating_preset_or_404,
    list_seating_presets,
    public_seating_preset,
    set_active_seating_preset,
    update_seating_preset,
)
from backend.routes.model_assets import (  # noqa: F401
    apply_model_asset,
    list_model_assets,
    upload_model_asset,
)
from backend.routes.sprites_capture import (  # noqa: F401
    generate_showcase_sprite,
    process_showcase_capture,
    retry_showcase_capture_part,
)
from backend.routes.sprites_compose import (  # noqa: F401
    generate_showcase_capture_atlas,
    get_showcase_compose_status,
    regenerate_showcase_frame_patch,
    review_showcase_capture_atlas,
    start_showcase_capture_compose,
    start_showcase_frame_patch,
)
from backend.routes.sprites_versions import (  # noqa: F401
    approve_showcase_sprite,
    list_sprite_versions,
    restore_sprite_version,
)

from backend.db import loads_json as _loads_json  # noqa: F401

# Backwards-compatible aliases kept for older callers.
_image_to_png_bytes = image_to_png_bytes
