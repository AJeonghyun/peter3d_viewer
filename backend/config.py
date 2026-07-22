"""Runtime configuration for the Peter3D retreat backend.

Every value here is read through the module object (``config.X``) so tests can
swap paths and model names in one place.
"""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
MODELS_DIR = Path(os.getenv("PETER3D_MODELS_DIR", ROOT / "static" / "models"))
UPLOADS_DIR = Path(os.getenv("PETER3D_UPLOADS_DIR", ROOT / "uploads"))
FRONTEND_DIST = ROOT / "frontend" / "dist"
DB_PATH = Path(os.getenv("PETER3D_DB_PATH", DATA_DIR / "peter3d.db"))
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_GLB_BYTES = max(1, int(os.getenv("PETER3D_MAX_GLB_MB", "10"))) * 1024 * 1024
MAX_GLB_TRIANGLES = max(1_000, int(os.getenv("PETER3D_MAX_GLB_TRIANGLES", "100000")))
MAX_SPRITE_BYTES = 25 * 1024 * 1024
SERVERLESS_RUNTIME = os.getenv("PETER3D_SERVERLESS", "0") == "1"
OPENAI_IMAGE_MODEL = os.getenv("OPENAI_IMAGE_MODEL", "gpt-image-2")
OPENAI_IMAGE_QUALITY = os.getenv("OPENAI_IMAGE_QUALITY", "high")
OPENAI_IMAGE_INPUT_FIDELITY = os.getenv("OPENAI_IMAGE_INPUT_FIDELITY", "high")
OPENAI_IMAGE_API_URL = "https://api.openai.com/v1/images/edits"
OPENAI_SPRITE_QA_MODEL = os.getenv("OPENAI_SPRITE_QA_MODEL", "gpt-5.4-mini")
OPENAI_RESPONSES_API_URL = "https://api.openai.com/v1/responses"
GARMENT_IMAGE_TIMEOUT_SECONDS = 240.0
OPENAI_QA_TIMEOUT_SECONDS = 75.0
COMPOSE_GENERATION_LEASE_SECONDS = 330
COMPOSE_REVIEW_LEASE_SECONDS = 120
COMPOSE_RETRY_AFTER_SECONDS = 10
COMPOSE_ACTIVE_TEAM_STATUSES = {"generating", "composing", "reviewing", "saving"}
TEAM_COUNT = 21
SHOWCASE_SPRITE_COLUMNS = 4
SHOWCASE_SPRITE_ROWS = 3
SHOWCASE_SPRITE_WIDTH = 1536
SHOWCASE_SPRITE_HEIGHT = 1152
SHOWCASE_SPRITE_SIZE = f"{SHOWCASE_SPRITE_WIDTH}x{SHOWCASE_SPRITE_HEIGHT}"
LEGACY_GARMENT_TRANSFER_CONTRACT = "fixed-peter-garment-transfer-v2"
PREVIOUS_GARMENT_TRANSFER_CONTRACT = "fixed-peter-master-edit-v3"
PRE_CAMPFIRE_GARMENT_TRANSFER_CONTRACT = "fixed-peter-master-edit-v4"
V5_GARMENT_TRANSFER_CONTRACT = "fixed-peter-master-edit-v5"
V6_GARMENT_TRANSFER_CONTRACT = "fixed-peter-master-edit-v6"
GARMENT_TRANSFER_CONTRACT = "fixed-peter-master-edit-v7"
GARMENT_ATLAS_COLUMNS = 8
GARMENT_ATLAS_ROWS = 4
GARMENT_FRAME_COUNT = 32
GARMENT_ATLAS_CELL_SIZE = 360
GARMENT_ATLAS_WIDTH = GARMENT_ATLAS_COLUMNS * GARMENT_ATLAS_CELL_SIZE
GARMENT_ATLAS_HEIGHT = GARMENT_ATLAS_ROWS * GARMENT_ATLAS_CELL_SIZE
GARMENT_ATLAS_SIZE = GARMENT_ATLAS_WIDTH
GARMENT_AI_CELL_SIZE = 384
GARMENT_AI_ATLAS_WIDTH = GARMENT_ATLAS_COLUMNS * GARMENT_AI_CELL_SIZE
GARMENT_AI_ATLAS_HEIGHT = GARMENT_ATLAS_ROWS * GARMENT_AI_CELL_SIZE
GARMENT_AI_ATLAS_SIZE = GARMENT_AI_ATLAS_WIDTH
GARMENT_AI_IMAGE_SIZE = f"{GARMENT_AI_ATLAS_WIDTH}x{GARMENT_AI_ATLAS_HEIGHT}"
GARMENT_AI_FRAME_SIZE = 1024
GARMENT_AI_FRAME_IMAGE_SIZE = f"{GARMENT_AI_FRAME_SIZE}x{GARMENT_AI_FRAME_SIZE}"
GARMENT_AI_BACKGROUND = (0, 255, 0)
CHROMA_EDGE_FEATHER_RADIUS = 0.55
CHROMA_SPILL_TOLERANCE = 8
GARMENT_DISPLAY_SCALE = 1.38
GARMENT_TEMPLATE_SIZE = (1240, 1754)
GARMENT_PART_CROPS = {
    "upper": (0.12, 0.34, 0.88, 0.62),
    "lower": (0.25, 0.60, 0.75, 0.82),
    "left_shoe": (0.22, 0.79, 0.49, 0.94),
    "right_shoe": (0.52, 0.79, 0.79, 0.94),
}
GARMENT_PARTS = tuple(GARMENT_PART_CROPS.keys())
SHOWCASE_SOURCE_MASTER_PATH = (
    ROOT / "frontend" / "public" / "assets" / "peter-sober" / "peter-sober-master.png"
)
SHOWCASE_SAFE_MASTER_PATH = (
    ROOT / "runtime-assets" / "peter-sober-master-safe.png"
)
SHOWCASE_EXPANDED_MASTER_PATH = (
    ROOT / "runtime-assets" / "peter-retreat-master-expanded-v7.png"
)
SHOWCASE_RETREAT_MASTER_PATH = (
    ROOT / "frontend" / "public" / "assets" / "retreat" / "peter-retreat-master.png"
)
SHOWCASE_MASTER_PATH = (
    SHOWCASE_EXPANDED_MASTER_PATH
    if SHOWCASE_EXPANDED_MASTER_PATH.is_file()
    else SHOWCASE_SAFE_MASTER_PATH
    if SHOWCASE_SAFE_MASTER_PATH.is_file()
    else SHOWCASE_SOURCE_MASTER_PATH
)
SHOWCASE_FRAME_SAFE_MARGIN = 14
STAT_KEYS = ("courage", "wisdom", "faith", "love")

GARMENT_MASTER_EDIT_PROMPT = """
You receive exactly two reference images in this order:
1. FIXED MASTER: the canonical Peter v7 32-frame pose sheet in a strict 8x4 grid
2. STUDENT DESIGN: one corrected full-body photo of Peter decorated by students

Create a NEW production-ready 32-frame Peter sheet by editing the fixed master.
The fixed master is an immutable template for every team. Copy its exact 8x4
frame order, poses, direction, face, hair, beard, skin, hands, body proportions,
outline style, character size, bottom-center anchors, and safe padding. Do not
redesign, redraw, simplify, enlarge, shrink, rotate, reorder, or replace Peter.
Frames 1-2 are front-facing idle breathing. Frames 3-13 are the complete waving
animation. Frames 14-24 are the complete joyful-jump animation. Frames 25-26
are praying breathing. Frames 27-32 are point, listen-front, listen-side,
listen-rear, listen-back, and standing-back. Preserve this order exactly.
The listening-back frame is a true fully seated rear view with no face visible.
The final back frame is a true standing rear view. Every pose uses the same
large visual scale as listen-front; never make prayer, point, or jump smaller.

Transfer from the student design only:
- upper garment colors, patterns, writing, marks, and handmade texture
- lower garment colors, patterns, writing, marks, and handmade texture
- belt decoration only when the student changed it
- student-left footwear design onto Peter's left foot
- student-right footwear design onto Peter's right foot

Keep these four garment regions visually separate in every frame. Upper-garment
pixels must never spill into the lower garment, belt, hands, skin, hair, beard,
legs, or shoes. Lower-garment pixels must never spill into the upper garment,
skin, legs, or shoes. Footwear designs must remain on their corresponding foot.
Preserve intentional left/right asymmetry. For side views and hidden areas,
continue only the nearest visible color or motif; invent nothing new.

Ignore the paper, room, lighting, glare, shadows, wrinkles, perspective, printed
guide marks, and everything outside the student's four decorated regions.

OUTPUT CONTRACT:
- exactly 3072 by 1536 pixels
- exactly 32 complete characters in a strict 8-column by 4-row grid
- every cell is exactly 384 by 384 pixels
- one complete Peter per cell, matching the corresponding master cell
- same character scale and same bottom-center anchor as the fixed master
- full hair, head, beard, raised hands, clothes, legs, feet, and shoe soles visible
- at least 20 pixels of empty background around every visible body part
- a perfectly flat, uniform pure chroma-green RGB(0,255,0) background
- no chroma-green fringe, rim, outline, glow, reflection, or color spill around
  any part of Peter; use a clean anti-aliased silhouette whose edge colors come
  only from Peter, and the background color must never appear on the character
- no transparency, gradients, scenery, shadows, grid lines, borders, labels,
  captions, watermarks, extra people, extra limbs, or duplicated features

This is a master-locked garment edit, not free image generation. If the student
design is ambiguous, preserve the fixed master rather than guessing.
""".strip()

GARMENT_FRAME_EDIT_PROMPT = """
You receive exactly three reference images in this order:
1. FIXED FRAME: one immutable canonical Peter animation frame
2. STUDENT DESIGN: one corrected full-body photo decorated by students
3. CURRENT FRAME: the generated frame being replaced

Create exactly ONE corrected production-ready Peter frame. The FIXED FRAME is
immutable for pose, direction, face, hair, beard, skin, hands, body proportions,
outline style, character scale, and full-body silhouette. Transfer only the
student's upper garment, lower garment, belt decoration, and corresponding
left/right footwear designs. Use the CURRENT FRAME only to preserve garment
continuity; do not preserve its reported defect.

OUTPUT CONTRACT:
- exactly one complete Peter centered in a 1024 by 1024 square
- same pose, direction, scale, and bottom-center anchor as FIXED FRAME
- full hair, head, beard, raised hands, clothes, legs, feet, and soles visible
- generous empty padding around every visible body part
- perfectly flat, uniform pure chroma-green RGB(0,255,0) background
- no transparency, shadows, scenery, borders, labels, extra people, extra
  limbs, duplicated features, cropping, or chroma-green fringe

This is a master-locked single-frame repair. Change no frame other than the one
provided, and never redesign Peter.
""".strip()

SHOWCASE_SPRITE_PROMPT = """
You receive two reference images in this exact order:
1. a phone photo of a student's drawing on the printed Peter worksheet
2. the fixed Peter master animation sheet used by every team

Create one production-ready 2D sprite sheet. The fixed master is the sole source
of truth for Peter's face, hair, beard, skin, body proportions, line style, and
character identity. The student photo is the sole source of truth only for the
upper garment, lower garment, belt decoration if the student changed it, and
left/right footwear. This is a garment transfer, never a character redesign.

PRESERVE IN EVERY FRAME:
- copy Peter's face, expression, head shape, hair, beard, skin tone, hands,
  body proportions, and illustration style from the fixed master without change
- transfer the student's exact upper/lower clothing colors, patterns, writing,
  marks, handmade texture, and footwear colors/patterns onto those master poses
- keep intentional left/right asymmetry in the student's clothes and footwear
- infer only the minimum continuation needed for side views; invent no new motif
- ignore paper color, room background, shadows, wrinkles, hands holding the
  paper, perspective distortion, glare, and anything outside Peter's clothing

LAYOUT:
- exactly 12 separate full-body frames in a strict 4-column by 3-row grid
- all 12 cells are identical squares with identical camera, character scale,
  padding, and bottom-center anchor
- the lowest shoe sole uses the same baseline in every cell
- exactly one complete character in each cell, with no cropping or overlap
- keep at least 24 pixels of empty background around every visible body part in
  every 384 by 384 cell, including raised hands, hair, beard, and shoe soles
- no visible body pixel may touch or nearly touch a cell edge

ANIMATION:
- row 1: four subtle front-facing idle frames forming a seamless loop; only
  breathing, a tiny body sway, and at most one blink may change
- row 2: four strict 90-degree side-profile walking-right frames forming a
  seamless loop, with alternating contact and passing poses; the forehead,
  nose, mouth, chin, torso, arms, legs, and shoe toes all face right; show one
  visible eye and preserve a recognizable side-profile version of the same face,
  hair, and facial hair
- row 3: four front-facing friendly wave frames: arm rising, hand tilted one
  way, hand tilted the other way, arm returning

For areas hidden by the side view, infer the minimum necessary continuation
from the student's garment while preserving the fixed master identity. Do not
add new motifs, text, accessories, or clothing features. Use one perfectly flat,
uniform very light warm-gray background across
the full sheet. No transparency, gradient, scenery, cast shadows, grid lines,
borders, labels, captions, watermarks, extra people, extra limbs, duplicated
features, or cropped body parts. The result must look like one consistently
authored animation sheet, never twelve independently redesigned characters.
""".strip()

SHOWCASE_SPRITE_QA_PROMPT = """
Inspect this 4-column by 3-row sprite sheet as a strict animation QA reviewer.
There must be exactly one complete Peter character in each of the 12 square
cells. The first image is the generated sheet and the second image is the fixed
Peter master when supplied. Check every frame independently.

Fail a frame if any hair, head, beard, face, raised hand, arm, garment, leg,
foot, shoe, or outline is cut off, hidden by the cell boundary, merged with a
neighboring cell, or so close to an edge that animation playback could clip it.
Also fail obvious missing body parts, extra limbs, duplicated features, or a
walking frame that is not a right-facing side profile. Fail if Peter's face,
hair, beard, body proportions, or illustration style visibly drift away from
the fixed master. Clothing and shoes are expected to differ because they come
from the student's drawing. Use warning only for minor visual inconsistency that
does not crop the full body. Do not fail merely because the background is opaque.

Return a concise Korean summary and frame-specific issues. Frame numbering is
left-to-right, top-to-bottom, 1 through 12.
""".strip()

for _directory in (DB_PATH.parent, MODELS_DIR, UPLOADS_DIR):
    _directory.mkdir(parents=True, exist_ok=True)
