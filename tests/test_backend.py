import asyncio
import io
import json
import struct
import tempfile
import unittest
from pathlib import Path
from typing import Optional
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from PIL import Image, ImageDraw
from starlette.datastructures import Headers

import backend_main
from backend import config


def make_glb(document: dict) -> bytes:
    payload = json.dumps(document, separators=(",", ":")).encode("utf-8")
    payload += b" " * ((4 - len(payload) % 4) % 4)
    chunk = struct.pack("<II", len(payload), 0x4E4F534A) + payload
    return struct.pack("<4sII", b"glTF", 2, 12 + len(chunk)) + chunk


def make_png_header(width: int, height: int) -> bytes:
    return (
        b"\x89PNG\r\n\x1a\n"
        + struct.pack(">I", 13)
        + b"IHDR"
        + struct.pack(">II", width, height)
        + b"\x08\x06\x00\x00\x00"
    )

def make_sprite_atlas(*, clipped_frame: Optional[int] = None) -> bytes:
    atlas = Image.new("RGB", (1536, 1152), (240, 238, 232))
    draw = ImageDraw.Draw(atlas)
    for frame in range(1, 13):
        column = (frame - 1) % 4
        row = (frame - 1) // 4
        x = column * 384
        y = row * 384
        top = y if frame == clipped_frame else y + 34
        draw.ellipse((x + 108, top, x + 276, y + 178), fill=(78, 49, 32))
        draw.rounded_rectangle(
            (x + 84, y + 150, x + 300, y + 314),
            radius=32,
            fill=(104, 177, 211),
        )
        draw.rectangle((x + 112, y + 306, x + 168, y + 350), fill=(244, 146, 126))
        draw.rectangle((x + 216, y + 306, x + 272, y + 350), fill=(244, 146, 126))
    stream = io.BytesIO()
    atlas.save(stream, format="PNG")
    return stream.getvalue()


def make_garment_capture() -> bytes:
    image = Image.new("RGB", backend_main.GARMENT_TEMPLATE_SIZE, (246, 246, 242))
    draw = ImageDraw.Draw(image)
    colors = {
        "upper": (210, 48, 72),
        "lower": (38, 112, 205),
        "left_shoe": (30, 170, 92),
        "right_shoe": (235, 196, 38),
    }
    width, height = image.size
    for part, crop in backend_main.GARMENT_PART_CROPS.items():
        left, top, right, bottom = crop
        draw.rectangle(
            (
                round(left * width) + 12,
                round(top * height) + 12,
                round(right * width) - 12,
                round(bottom * height) - 12,
            ),
            fill=colors[part],
        )
    stream = io.BytesIO()
    image.save(stream, format="PNG")
    return stream.getvalue()


class Peter3DBackendTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.original_db_path = config.DB_PATH
        self.original_models_dir = config.MODELS_DIR
        self.original_uploads_dir = config.UPLOADS_DIR
        self.original_frontend_dist = config.FRONTEND_DIST
        config.DB_PATH = Path(self.tempdir.name) / "test.db"
        config.MODELS_DIR = Path(self.tempdir.name) / "models"
        config.UPLOADS_DIR = Path(self.tempdir.name) / "uploads"
        config.FRONTEND_DIST = Path(self.tempdir.name) / "frontend" / "dist"
        config.MODELS_DIR.mkdir()
        config.UPLOADS_DIR.mkdir()
        config.FRONTEND_DIST.mkdir(parents=True)
        (config.FRONTEND_DIST / "index.html").write_text(
            '<!doctype html><div id="root"></div>',
            encoding="utf-8",
        )
        backend_main.init_db()

    def tearDown(self):
        config.DB_PATH = self.original_db_path
        config.MODELS_DIR = self.original_models_dir
        config.UPLOADS_DIR = self.original_uploads_dir
        config.FRONTEND_DIST = self.original_frontend_dist
        self.tempdir.cleanup()

    def test_initializes_exactly_21_teams(self):
        with backend_main.connect_db() as db:
            count = db.execute("SELECT COUNT(*) FROM teams").fetchone()[0]
        self.assertEqual(count, 21)

    def test_scene_media_and_layout_are_shared_through_the_database(self):
        stream = io.BytesIO()
        Image.new("RGBA", (24, 24), (210, 48, 72, 255)).save(stream, format="PNG")
        upload = backend_main.UploadFile(
            filename="shared-object.png",
            file=io.BytesIO(stream.getvalue()),
            headers=Headers({"content-type": "image/png"}),
        )

        media = asyncio.run(backend_main.upload_retreat_scene_media("stand", upload))
        media_key = f"media-{media['id']}"
        payload = backend_main.RetreatSceneLayoutPayload(layout={
            "group-1": {
                "x": 14,
                "bottom": 3,
                "scale": 1.1,
                "flipX": False,
                "visible": True,
                "poseId": "idle",
            },
            media_key: {
                "x": 62,
                "bottom": 26,
                "scale": 0.8,
                "flipX": True,
                "visible": True,
                "poseId": "idle",
            },
        })
        saved = asyncio.run(backend_main.save_retreat_scene_layout("stand", payload))
        loaded = asyncio.run(backend_main.get_retreat_scene("stand"))

        self.assertEqual(saved["layout"][media_key]["x"], 62.0)
        self.assertEqual(loaded["media"][0]["name"], "shared-object.png")
        self.assertEqual(loaded["media"][0]["asset_url"], media["asset_url"])
        self.assertTrue((config.UPLOADS_DIR / Path(media["asset_url"]).name).is_file())

        asyncio.run(backend_main.delete_retreat_scene_media("stand", media["id"]))
        deleted = asyncio.run(backend_main.get_retreat_scene("stand"))
        self.assertEqual(deleted["media"], [])
        self.assertNotIn(media_key, deleted["layout"])
        self.assertFalse((config.UPLOADS_DIR / Path(media["asset_url"]).name).exists())

    def test_scene_media_preserves_animated_gif_uploads(self):
        stream = io.BytesIO()
        frames = [
            Image.new("RGBA", (16, 16), (255, 80, 40, 255)),
            Image.new("RGBA", (16, 16), (40, 120, 255, 255)),
        ]
        frames[0].save(
            stream,
            format="GIF",
            save_all=True,
            append_images=frames[1:],
            duration=80,
            loop=0,
        )
        upload = backend_main.UploadFile(
            filename="animated.gif",
            file=io.BytesIO(stream.getvalue()),
            headers=Headers({"content-type": "image/gif"}),
        )

        media = asyncio.run(backend_main.upload_retreat_scene_media("campfire", upload))

        self.assertEqual(media["mime_type"], "image/gif")
        stored = (config.UPLOADS_DIR / Path(media["asset_url"]).name).read_bytes()
        self.assertEqual(stored, stream.getvalue())

    def test_team_api_hides_legacy_teams_above_21(self):
        with backend_main.connect_db() as db:
            db.execute(
                "INSERT INTO teams (id, name, updated_at) VALUES (?, ?, ?)",
                (22, "22조", backend_main.now_iso()),
            )

        teams = asyncio.run(backend_main.list_teams())

        self.assertEqual(len(teams), 21)
        self.assertEqual(max(team["id"] for team in teams), 21)
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(backend_main.get_team(22))
        self.assertEqual(caught.exception.status_code, 404)

    def test_initializes_pipeline_metadata_and_credit_ledger(self):
        with backend_main.connect_db() as db:
            columns = {
                row["name"] for row in db.execute("PRAGMA table_info(conversion_jobs)").fetchall()
            }
            usage_table = db.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tripo_task_usage'"
            ).fetchone()

        self.assertTrue({
            "pipeline_profile",
            "multiview_task_id",
            "fallback_model_task_id",
            "fallback_used",
            "glb_bytes",
            "glb_triangles",
            "glb_animations",
            "lease_token",
            "lease_until",
            "asset_only",
            "asset_name",
            "source_image_url",
        }.issubset(columns))
        self.assertIsNotNone(usage_table)
        with backend_main.connect_db() as db:
            team_columns = {
                row["name"] for row in db.execute("PRAGMA table_info(teams)").fetchall()
            }
            asset_table = db.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'model_assets'"
            ).fetchone()
            version_table = db.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sprite_versions'"
            ).fetchone()
        self.assertIn("model_asset_id", team_columns)
        self.assertIn("showcase_image_url", team_columns)
        self.assertTrue({
            "showcase_sprite_url",
            "showcase_sprite_active_url",
            "showcase_sprite_status",
            "showcase_sprite_error",
            "showcase_sprite_model",
            "showcase_sprite_quality_status",
            "showcase_sprite_quality_json",
            "showcase_sprite_qa_model",
            "showcase_sprite_updated_at",
            "showcase_capture_url",
            "showcase_capture_status",
            "showcase_capture_quality_json",
            "showcase_garment_parts_json",
            "showcase_sprite_contract",
            "showcase_sprite_version_id",
            "showcase_sprite_active_version_id",
        }.issubset(team_columns))
        self.assertIsNotNone(version_table)
        self.assertIsNotNone(asset_table)

    def test_initializes_default_seating_preset_and_active_setting(self):
        result = asyncio.run(backend_main.list_seating_presets())

        self.assertEqual(result["active_preset_id"], "default")
        self.assertEqual(len(result["presets"]), 1)
        preset = result["presets"][0]
        self.assertEqual(preset["id"], "default")
        self.assertEqual(preset["name"], "기본 자리표")
        self.assertEqual(preset["title"], "첫째 날 자리표")
        self.assertEqual(preset["time_label"], "")
        self.assertEqual(preset["group_order"], list(range(1, 22)))

    def test_seating_preset_crud_and_active_selection(self):
        created = asyncio.run(backend_main.create_seating_preset(
            backend_main.SeatingPresetPayload(
                name="첫째 날 저녁",
                title="첫째 날 저녁 자리표",
                time_label="저녁 집회",
                group_order=list(range(21, 0, -1)),
            )
        ))

        self.assertEqual(created["name"], "첫째 날 저녁")
        self.assertEqual(created["title"], "첫째 날 저녁 자리표")
        self.assertEqual(created["time_label"], "저녁 집회")
        self.assertEqual(created["group_order"], list(range(21, 0, -1)))

        updated = asyncio.run(backend_main.update_seating_preset(
            created["id"],
            backend_main.SeatingPresetPayload(
                name="둘째 날 아침",
                title="둘째 날 아침 자리표",
                time_label="아침 QT",
                group_order=[2, *range(3, 22), 1],
            ),
        ))
        self.assertEqual(updated["name"], "둘째 날 아침")
        self.assertEqual(updated["group_order"], [2, *range(3, 22), 1])

        active = asyncio.run(backend_main.set_active_seating_preset(
            backend_main.ActiveSeatingPresetPayload(preset_id=created["id"])
        ))
        self.assertEqual(active["active_preset_id"], created["id"])
        self.assertEqual(active["preset"]["id"], created["id"])

        listed = asyncio.run(backend_main.list_seating_presets())
        self.assertEqual(listed["active_preset_id"], created["id"])
        self.assertEqual({preset["id"] for preset in listed["presets"]}, {"default", created["id"]})

        deleted = asyncio.run(backend_main.delete_seating_preset(created["id"]))
        self.assertEqual(deleted["deleted"], created["id"])
        self.assertEqual(deleted["active_preset_id"], "default")

    def test_seating_preset_rejects_missing_or_duplicate_group_slots(self):
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(backend_main.create_seating_preset(
                backend_main.SeatingPresetPayload(
                    name="잘못된 자리표",
                    title="잘못된 자리표",
                    time_label="",
                    group_order=[1] * 21,
                )
            ))

        self.assertEqual(caught.exception.status_code, 422)
        self.assertIn("중복 없이", caught.exception.detail)

    def test_seating_preset_delete_recreates_default_when_none_remain(self):
        deleted = asyncio.run(backend_main.delete_seating_preset("default"))
        listed = asyncio.run(backend_main.list_seating_presets())

        self.assertEqual(deleted["deleted"], "default")
        self.assertEqual(listed["active_preset_id"], "default")
        self.assertEqual(len(listed["presets"]), 1)
        self.assertEqual(listed["presets"][0]["group_order"], list(range(1, 22)))


    def test_showcase_sprite_contract_uses_square_four_by_three_cells(self):
        self.assertEqual(backend_main.SHOWCASE_SPRITE_SIZE, "1536x1152")
        self.assertEqual(
            backend_main.SHOWCASE_SPRITE_WIDTH // backend_main.SHOWCASE_SPRITE_COLUMNS,
            384,
        )
        self.assertEqual(
            backend_main.SHOWCASE_SPRITE_HEIGHT // backend_main.SHOWCASE_SPRITE_ROWS,
            384,
        )
        self.assertEqual(
            backend_main.validate_showcase_sprite_png(make_png_header(1536, 1152)),
            (1536, 1152),
        )

    def test_showcase_sprite_contract_rejects_a_non_square_sheet(self):
        with self.assertRaisesRegex(ValueError, "1536x1152"):
            backend_main.validate_showcase_sprite_png(make_png_header(1536, 1024))

    def test_showcase_sprite_prompt_locks_master_identity_and_transfers_garments(self):
        prompt = backend_main.SHOWCASE_SPRITE_PROMPT
        self.assertIn("fixed master is the sole source", prompt)
        self.assertIn("upper garment", prompt)
        self.assertIn("handmade texture", prompt)
        self.assertIn("strict 90-degree side-profile walking-right", prompt)

    def test_master_edit_prompt_locks_all_32_poses_and_garment_boundaries(self):
        prompt = backend_main.GARMENT_MASTER_EDIT_PROMPT
        self.assertIn("fixed master is an immutable template", prompt)
        self.assertIn("exactly 32 complete characters", prompt)
        self.assertIn("strict 8-column by 4-row grid", prompt)
        self.assertIn("Frames 3-13 are the complete waving", prompt)
        self.assertIn("Frames 14-24 are the complete joyful-jump", prompt)
        self.assertIn("listen-rear, listen-back, and standing-back", prompt)
        self.assertIn("never make prayer, point, or jump smaller", prompt)
        self.assertIn("upper garment", prompt)
        self.assertIn("lower garment", prompt)
        self.assertIn("student-left footwear", prompt)
        self.assertIn("student-right footwear", prompt)
        self.assertIn("same bottom-center anchor", prompt)
        self.assertIn("no chroma-green fringe", prompt)
        self.assertIn("background color must never appear", prompt)

    def test_chroma_cleanup_removes_green_spill_without_recoloring_the_interior(self):
        cell = Image.new("RGBA", (32, 32), (0, 255, 0, 255))
        pixels = cell.load()

        # A deliberately green-contaminated one-pixel contour around a brown actor.
        for y in range(7, 25):
            for x in range(7, 25):
                pixels[x, y] = (48, 154, 18, 255)
        for y in range(8, 24):
            for x in range(8, 24):
                pixels[x, y] = (102, 58, 28, 255)

        # An interior green garment patch must not be globally desaturated.
        for y in range(13, 19):
            for x in range(12, 20):
                pixels[x, y] = (22, 178, 42, 255)
        pixels[10, 10] = (*backend_main.GARMENT_AI_BACKGROUND, 255)

        cleaned = backend_main.remove_connected_cell_background(cell)
        cleaned_pixels = cleaned.load()

        self.assertEqual(cleaned_pixels[0, 0], (0, 0, 0, 0))
        self.assertEqual(cleaned_pixels[15, 15][:3], (22, 178, 42))
        self.assertNotEqual(cleaned_pixels[10, 10][:3], backend_main.GARMENT_AI_BACKGROUND)

        visible_edge_pixels = []
        for y in range(cleaned.height):
            for x in range(cleaned.width):
                red, green, blue, alpha = cleaned_pixels[x, y]
                if 0 < alpha < 255:
                    visible_edge_pixels.append((red, green, blue, alpha))

        self.assertTrue(visible_edge_pixels)
        self.assertFalse(any(
            green > max(red, blue) + backend_main.CHROMA_SPILL_TOLERANCE
            for red, green, blue, _ in visible_edge_pixels
        ))

    def test_atlas_qa_rejects_a_remaining_green_fringe(self):
        atlas = backend_main.normalize_master_locked_atlas(
            backend_main.master_reference_for_ai(),
        )
        first_cell = atlas.crop((0, 0, 360, 360))
        bbox = first_cell.getchannel("A").getbbox()
        self.assertIsNotNone(bbox)
        atlas.putpixel((bbox[0], round((bbox[1] + bbox[3]) / 2)), (0, 255, 0, 255))

        report = backend_main.analyze_garment_atlas_pixels(atlas)

        self.assertEqual(report["status"], "failed")
        self.assertIn("chroma_spill", report["frames"][0]["issues"])
        self.assertGreater(report["frames"][0]["chroma_spill_pixels"], 0)

    def test_normalizer_removes_a_detached_model_shadow(self):
        generated = Image.open(io.BytesIO(backend_main.master_reference_for_ai())).convert("RGBA")
        draw = ImageDraw.Draw(generated)
        draw.ellipse((172, 366, 196, 376), fill=(92, 54, 30, 255))

        normalized = backend_main.normalize_master_locked_atlas(generated)
        report = backend_main.analyze_garment_atlas_pixels(normalized)

        self.assertEqual(report["frames"][0]["alpha_component_count"], 1)
        self.assertEqual(report["frames"][0]["detached_alpha_pixels"], 0)
        self.assertNotIn("detached_alpha_component", report["frames"][0]["issues"])

    def test_atlas_qa_rejects_a_detached_alpha_artifact(self):
        atlas = backend_main.normalize_master_locked_atlas(
            backend_main.master_reference_for_ai(),
        )
        ImageDraw.Draw(atlas).ellipse((170, 342, 188, 350), fill=(92, 54, 30, 255))

        report = backend_main.analyze_garment_atlas_pixels(atlas)

        self.assertEqual(report["status"], "failed")
        self.assertIn("detached_alpha_component", report["frames"][0]["issues"])
        self.assertGreaterEqual(report["frames"][0]["detached_alpha_pixels"], 8)

    def test_master_locked_request_sends_master_first_and_omits_gpt_image_2_fidelity(self):
        generated = backend_main.master_reference_for_ai()
        expected = backend_main.SHOWCASE_MASTER_PATH.read_bytes()
        recorded = {}
        progress = []

        class FakeResponse:
            status_code = 200

            @staticmethod
            def json():
                return {
                    "data": [{
                        "b64_json": backend_main.base64.b64encode(generated).decode("ascii"),
                    }],
                }

        class FakeClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, traceback):
                return None

            async def post(self, url, *, headers, data, files):
                recorded.update({
                    "url": url,
                    "headers": headers,
                    "data": data,
                    "files": files,
                })
                return FakeResponse()

        with (
            patch.dict("os.environ", {"OPENAI_API_KEY": "sk-test-key"}),
            patch("backend.ai_generation.httpx.AsyncClient", return_value=FakeClient()),
            patch(
                "backend.ai_generation.normalize_master_locked_atlas",
                return_value=Image.open(io.BytesIO(expected)).convert("RGBA"),
            ),
        ):
            actual = asyncio.run(backend_main.request_master_locked_garment_atlas(
                b"corrected-student-peter",
                filename="team-1-corrected.png",
                on_progress=progress.append,
            ))

        with Image.open(io.BytesIO(actual)) as atlas:
            self.assertEqual(atlas.size, (backend_main.GARMENT_ATLAS_WIDTH, backend_main.GARMENT_ATLAS_HEIGHT))
        self.assertEqual(recorded["url"], backend_main.OPENAI_IMAGE_API_URL)
        self.assertEqual(recorded["data"]["model"], "gpt-image-2")
        self.assertEqual(recorded["data"]["size"], "3072x1536")
        self.assertEqual(recorded["data"]["quality"], "high")
        self.assertEqual(recorded["data"]["background"], "opaque")
        self.assertNotIn("input_fidelity", recorded["data"])
        self.assertEqual(recorded["files"][0][1][0], "fixed-peter-master-8x4-v7.png")
        self.assertEqual(recorded["files"][1], (
            "image[]",
            ("team-1-corrected.png", b"corrected-student-peter", "image/png"),
        ))
        self.assertEqual(progress, ["composing"])

    def test_openai_sprite_request_sends_reference_and_fixed_contract(self):
        expected_sprite = make_png_header(1536, 1152)
        recorded = {}

        class FakeResponse:
            status_code = 200

            @staticmethod
            def json():
                return {
                    "data": [{
                        "b64_json": backend_main.base64.b64encode(expected_sprite).decode("ascii"),
                    }],
                }

        class FakeClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, traceback):
                return None

            async def post(self, url, *, headers, data, files):
                recorded.update({
                    "url": url,
                    "headers": headers,
                    "data": data,
                    "files": files,
                })
                return FakeResponse()

        with (
            patch.dict("os.environ", {"OPENAI_API_KEY": "sk-test-key"}),
            patch("backend.ai_generation.httpx.AsyncClient", return_value=FakeClient()),
        ):
            actual = asyncio.run(
                backend_main.request_showcase_sprite(
                    b"student-character",
                    "image/png",
                    "team-1-peter.png",
                )
            )

        self.assertEqual(actual, expected_sprite)
        self.assertEqual(recorded["url"], backend_main.OPENAI_IMAGE_API_URL)
        self.assertEqual(recorded["data"]["size"], "1536x1152")
        self.assertEqual(recorded["data"]["model"], "gpt-image-2")
        self.assertEqual(recorded["data"]["quality"], "high")
        self.assertNotIn("input_fidelity", recorded["data"])
        self.assertEqual(
            recorded["files"][0],
            ("image[]", ("team-1-peter.png", b"student-character", "image/png")),
        )
        self.assertEqual(recorded["files"][1][0], "image[]")
        self.assertEqual(recorded["files"][1][1][0], "fixed-peter-master.png")

    def test_pixel_quality_check_rejects_a_clipped_animation_frame(self):
        safe = backend_main.analyze_showcase_sprite_pixels(make_sprite_atlas())
        clipped = backend_main.analyze_showcase_sprite_pixels(
            make_sprite_atlas(clipped_frame=6),
        )

        self.assertEqual(safe["status"], "passed")
        self.assertTrue(safe["can_approve"])
        self.assertEqual(clipped["status"], "failed")
        self.assertFalse(clipped["can_approve"])
        self.assertEqual(clipped["frames"][5]["frame"], 6)
        self.assertIn("위쪽 여백 부족", clipped["frames"][5]["issues"])

    def test_openai_sprite_request_keeps_fidelity_for_gpt_image_1(self):
        expected_sprite = make_png_header(1536, 1152)
        recorded = {}

        class FakeResponse:
            status_code = 200

            @staticmethod
            def json():
                return {
                    "data": [{
                        "b64_json": backend_main.base64.b64encode(expected_sprite).decode("ascii"),
                    }],
                }

        class FakeClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, traceback):
                return None

            async def post(self, url, *, headers, data, files):
                recorded["data"] = data
                return FakeResponse()

        with (
            patch.dict("os.environ", {"OPENAI_API_KEY": "sk-test-key"}),
            patch.object(config, "OPENAI_IMAGE_MODEL", "gpt-image-1"),
            patch("backend.ai_generation.httpx.AsyncClient", return_value=FakeClient()),
        ):
            asyncio.run(
                backend_main.request_showcase_sprite(
                    b"student-character",
                    "image/png",
                    "team-1-peter.png",
                )
            )

        self.assertEqual(recorded["data"]["input_fidelity"], "high")

    def test_ai_sprite_review_compares_render_sheet_with_master_at_high_detail(self):
        recorded = {}
        review = {
            "status": "passed",
            "summary": "전신이 모두 보입니다.",
            "issues": [],
            "frames": [],
        }

        class FakeResponse:
            status_code = 200

            @staticmethod
            def json():
                return {
                    "output": [{
                        "type": "message",
                        "content": [{
                            "type": "output_text",
                            "text": json.dumps(review),
                        }],
                    }],
                }

        class FakeClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, traceback):
                return None

            async def post(self, url, *, headers, json):
                recorded.update({"url": url, "headers": headers, "body": json})
                return FakeResponse()

        with (
            patch.dict("os.environ", {"OPENAI_API_KEY": "sk-test-key"}),
            patch("backend.ai_review.httpx.AsyncClient", return_value=FakeClient()),
        ):
            actual = asyncio.run(backend_main.request_showcase_sprite_ai_review(
                make_sprite_atlas(),
                {"status": "passed", "summary": "안전", "frames": []},
            ))

        self.assertEqual(actual["status"], "passed")
        self.assertEqual(recorded["url"], backend_main.OPENAI_RESPONSES_API_URL)
        content = recorded["body"]["input"][0]["content"]
        self.assertEqual(len(content), 3)
        self.assertTrue(all(item["detail"] == "high" for item in content[1:]))
        self.assertTrue(recorded["body"]["text"]["format"]["strict"])




    def test_growth_updates_stats_talents_and_title(self):
        result = asyncio.run(
            backend_main.add_growth(
                1,
                backend_main.GrowthCreate(
                    source="협동 게임",
                    talent_delta=40,
                    stats={"courage": 20, "love": 10},
                ),
            )
        )
        self.assertEqual(result["talents"], 40)
        self.assertEqual(result["courage"], 30)
        self.assertEqual(result["love"], 20)
        self.assertEqual(result["title"], "물 위에 발을 내딛는 자")

    def test_cannot_spend_more_talents_than_team_has(self):
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(
                backend_main.add_growth(
                    1,
                    backend_main.GrowthCreate(source="성품 투자", talent_delta=-10),
                )
            )
        self.assertEqual(caught.exception.status_code, 409)

    def test_rejects_unknown_stat(self):
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(
                backend_main.add_growth(
                    1,
                    backend_main.GrowthCreate(source="잘못된 입력", stats={"power": 10}),
                )
            )
        self.assertEqual(caught.exception.status_code, 422)

    def test_world_and_admin_serve_the_react_index(self):
        world = asyncio.run(backend_main.world_page())
        admin = asyncio.run(backend_main.admin_page())
        legacy_world = asyncio.run(backend_main.legacy_world_page())
        retreat_display = asyncio.run(backend_main.retreat_display_page())
        expected = config.FRONTEND_DIST / "index.html"
        self.assertEqual(world.path, expected)
        self.assertEqual(admin.path, expected)
        self.assertEqual(legacy_world.path, expected)
        self.assertEqual(retreat_display.path, expected)
        registered_paths = {route.path for route in backend_main.app.routes}
        self.assertTrue(
            {
                "/stand",
                "/back",
                "/campfire",
                "/display/stand",
                "/display/back",
                "/display/campfire",
                "/editor/stand",
                "/editor/back",
                "/editor/campfire",
                "/walk",
                "/display/walk",
                "/page-3",
                "/display/all-characters",
                "/showcase",
                "/print-template",
                "/admin/seating",
                "/api/retreat-scenes/{scene}",
                "/api/retreat-scenes/{scene}/layout",
                "/api/retreat-scenes/{scene}/media",
                "/api/retreat-scenes/{scene}/media/{media_id}",
            }.issubset(registered_paths)
        )

    def test_character_image_upload_updates_only_the_showcase_image(self):
        previous_image = "/uploads/team-1-3d-source.png"
        previous_model = "/static/models/team-1/model.glb"
        with backend_main.connect_db() as db:
            db.execute(
                """
                UPDATE teams
                SET image_url = ?, model_url = ?, conversion_status = 'done'
                WHERE id = 1
                """,
                (previous_image, previous_model),
            )
        upload = backend_main.UploadFile(
            filename="paper-peter.png",
            file=io.BytesIO(b"\x89PNG\r\n\x1a\nshowcase-image"),
            headers=Headers({"content-type": "image/png"}),
        )

        updated = asyncio.run(backend_main.upload_team_image(1, upload))

        self.assertTrue(updated["showcase_image_url"].startswith("/uploads/team-1-showcase-"))
        self.assertEqual(updated["image_url"], previous_image)
        self.assertEqual(updated["model_url"], previous_model)
        self.assertEqual(updated["conversion_status"], "done")
        self.assertEqual(updated["showcase_sprite_status"], "empty")
        self.assertIsNone(updated["showcase_sprite_url"])
        stored_path = config.UPLOADS_DIR / Path(updated["showcase_image_url"]).name
        self.assertEqual(stored_path.read_bytes(), b"\x89PNG\r\n\x1a\nshowcase-image")

    def test_showcase_sprite_generation_persists_the_ai_atlas(self):
        with backend_main.connect_db() as db:
            db.execute(
                "UPDATE teams SET showcase_image_url = ? WHERE id = 1",
                ("/uploads/team-1-showcase-source.png",),
            )
        reference = backend_main.UploadFile(
            filename="peter-reference.png",
            file=io.BytesIO(b"\x89PNG\r\n\x1a\nreference"),
            headers=Headers({"content-type": "image/png"}),
        )
        sprite = b"\x89PNG\r\n\x1a\nai-sprite-atlas"
        quality = {
            "status": "passed",
            "can_approve": True,
            "summary": "자동 검수를 통과했습니다.",
            "deterministic": {
                "status": "passed",
                "summary": "안전",
                "frames": [],
                "issues": [],
            },
            "ai": {
                "status": "passed",
                "summary": "안전",
                "frames": [],
                "issues": [],
                "model": backend_main.OPENAI_SPRITE_QA_MODEL,
            },
        }

        with (
            patch(
                "backend.ai_generation.request_showcase_sprite",
                new=AsyncMock(return_value=sprite),
            ) as request,
            patch(
                "backend.ai_review.inspect_showcase_sprite_quality",
                new=AsyncMock(return_value=quality),
            ),
        ):
            updated = asyncio.run(backend_main.generate_showcase_sprite(1, reference))

        request.assert_awaited_once()
        self.assertEqual(updated["showcase_sprite_status"], "review")
        self.assertEqual(updated["showcase_sprite_model"], backend_main.OPENAI_IMAGE_MODEL)
        self.assertEqual(updated["showcase_sprite_quality_status"], "passed")
        self.assertTrue(updated["showcase_sprite_quality"]["can_approve"])
        self.assertTrue(updated["showcase_sprite_url"].startswith("/uploads/team-1-sprite-"))
        stored_path = config.UPLOADS_DIR / Path(updated["showcase_sprite_url"]).name
        self.assertEqual(stored_path.read_bytes(), sprite)

        approved = asyncio.run(backend_main.approve_showcase_sprite(1))
        self.assertEqual(approved["showcase_sprite_status"], "ready")
        self.assertEqual(
            approved["showcase_sprite_active_url"],
            approved["showcase_sprite_url"],
        )

    def test_capture_v3_process_compose_approve_and_restore_version(self):
        quality = {
            "status": "passed",
            "can_process": True,
            "summary": "usable worksheet",
            "page_corners": {
                "top_left": [0, 0],
                "top_right": [1, 0],
                "bottom_right": [1, 1],
                "bottom_left": [0, 1],
            },
            "checks": {
                "blur": "sharp",
                "glare": "none",
                "shadow": "minor",
                "crop": "complete",
                "perspective": "correctable",
            },
            "issues": [],
            "model": backend_main.OPENAI_SPRITE_QA_MODEL,
        }
        reference = backend_main.UploadFile(
            filename="capture.png",
            file=io.BytesIO(make_garment_capture()),
            headers=Headers({"content-type": "image/png"}),
        )

        with patch(
            "backend.ai_generation.request_capture_quality_review",
            new=AsyncMock(return_value=quality),
        ) as review:
            processed = asyncio.run(backend_main.process_showcase_capture(1, reference))

        review.assert_awaited_once()
        self.assertEqual(processed["status"], "reference_ready")
        self.assertEqual(
            processed["version"]["contract"]["id"],
            backend_main.GARMENT_TRANSFER_CONTRACT,
        )
        self.assertEqual(processed["version"]["status"], "reference_ready")
        self.assertEqual(processed["reference"]["mode"], "full-body-master-edit")
        self.assertEqual(processed["reference"]["template_size"], list(backend_main.GARMENT_TEMPLATE_SIZE))
        self.assertEqual(processed["reference"]["regions"], list(backend_main.GARMENT_PARTS))
        self.assertIsNone(processed["team"]["showcase_garment_parts"])
        self.assertTrue(processed["team"]["showcase_capture_source_url"].startswith("/uploads/"))
        self.assertTrue(processed["team"]["showcase_capture_corrected_url"].startswith("/uploads/"))

        with self.assertRaises(HTTPException) as caught:
            asyncio.run(backend_main.retry_showcase_capture_part(1, "lower"))
        self.assertEqual(caught.exception.status_code, 410)

        atlas = backend_main._image_to_png_bytes(
            backend_main.normalize_master_locked_atlas(
                backend_main.master_reference_for_ai(),
            ),
        )
        atlas_quality = {
            "status": "passed",
            "can_approve": True,
            "summary": "마스터 고정 32컷 검수 통과",
            "deterministic": backend_main.analyze_garment_atlas_pixels(atlas),
            "ai": {
                "status": "passed",
                "summary": "의상 영역과 마스터 정체성 통과",
                "frames": [],
                "issues": [],
                "model": backend_main.OPENAI_SPRITE_QA_MODEL,
            },
        }
        with (
            patch(
                "backend.ai_generation.request_master_locked_garment_atlas",
                new=AsyncMock(return_value=atlas),
            ) as generate,
            patch(
                "backend.ai_review.inspect_garment_atlas_quality",
                new=AsyncMock(return_value=atlas_quality),
            ) as inspect,
        ):
            started = asyncio.run(backend_main.start_showcase_capture_compose(1))
            generated = asyncio.run(backend_main.generate_showcase_capture_atlas(1))
            composed = asyncio.run(backend_main.review_showcase_capture_atlas(1))

        generate.assert_awaited_once()
        inspect.assert_awaited_once()
        self.assertTrue(generate.await_args.args[0].startswith(b"\x89PNG"))
        self.assertEqual(generate.await_args.kwargs["filename"], "team-1-corrected-peter.png")
        self.assertTrue(callable(generate.await_args.kwargs["on_progress"]))

        self.assertEqual(started["next_action"], "generate")
        self.assertEqual(generated["status"], "generated")
        self.assertEqual(generated["next_action"], "review")
        self.assertEqual(generated["atlas_url"], composed["atlas_url"])
        self.assertEqual(composed["status"], "review")
        self.assertEqual(composed["next_action"], "complete")
        self.assertEqual(composed["contract"], backend_main.GARMENT_TRANSFER_CONTRACT)
        self.assertEqual(
            composed["team"]["showcase_sprite_contract"]["id"],
            backend_main.GARMENT_TRANSFER_CONTRACT,
        )
        self.assertEqual(composed["team"]["showcase_sprite_status"], "review")
        self.assertEqual(composed["team"]["showcase_sprite_quality"]["deterministic"]["status"], "passed")
        atlas_path = config.UPLOADS_DIR / Path(composed["atlas_url"]).name
        with Image.open(atlas_path) as atlas:
            self.assertEqual(atlas.size, (backend_main.GARMENT_ATLAS_WIDTH, backend_main.GARMENT_ATLAS_HEIGHT))

        approved = asyncio.run(backend_main.approve_showcase_sprite(1))
        self.assertEqual(approved["showcase_sprite_status"], "ready")
        self.assertEqual(approved["showcase_sprite_active_url"], composed["atlas_url"])
        self.assertEqual(approved["showcase_sprite_active_version_id"], composed["version"]["id"])

        listed = asyncio.run(backend_main.list_sprite_versions(1))
        self.assertEqual(listed["active_version_id"], composed["version"]["id"])
        self.assertEqual(len(listed["versions"]), 1)

        restored = asyncio.run(backend_main.restore_sprite_version(1, composed["version"]["id"]))
        self.assertEqual(restored["status"], "ready")
        self.assertEqual(restored["team"]["showcase_sprite_active_url"], composed["atlas_url"])

    def test_compose_generation_timeout_is_queued_for_automatic_retry(self):
        reference = backend_main.UploadFile(
            filename="capture.png",
            file=io.BytesIO(make_garment_capture()),
            headers=Headers({"content-type": "image/png"}),
        )
        with patch(
            "backend.ai_generation.request_capture_quality_review",
            new=AsyncMock(return_value={
                "status": "passed",
                "can_process": True,
                "summary": "통과",
                "page_corners": {
                    "top_left": [0.0, 0.0],
                    "top_right": [1.0, 0.0],
                    "bottom_right": [1.0, 1.0],
                    "bottom_left": [0.0, 1.0],
                },
                "checks": {},
                "issues": [],
            }),
        ):
            asyncio.run(backend_main.process_showcase_capture(1, reference))

        asyncio.run(backend_main.start_showcase_capture_compose(1))
        with patch(
            "backend.ai_generation.request_master_locked_garment_atlas",
            new=AsyncMock(side_effect=HTTPException(status_code=504, detail="AI 응답 지연")),
        ):
            retry = asyncio.run(backend_main.generate_showcase_capture_atlas(1))

        self.assertEqual(retry["next_action"], "retry")
        self.assertEqual(retry["status"], "queued")
        self.assertEqual(
            retry["retry_after_seconds"],
            backend_main.COMPOSE_RETRY_AFTER_SECONDS,
        )
        self.assertEqual(retry["team"]["showcase_sprite_status"], "generating")
        self.assertIn("자동 재시도", retry["team"]["showcase_sprite_error"])

    def test_problem_frame_patch_preserves_other_cells_and_creates_a_new_version(self):
        atlas = backend_main.normalize_master_locked_atlas(
            backend_main.master_reference_for_ai(),
        )
        atlas_bytes = backend_main._image_to_png_bytes(atlas)
        atlas_name = "source-atlas.png"
        corrected_name = "corrected-reference.png"
        (config.UPLOADS_DIR / atlas_name).write_bytes(atlas_bytes)
        (config.UPLOADS_DIR / corrected_name).write_bytes(make_garment_capture())

        deterministic = backend_main.analyze_garment_atlas_pixels(atlas_bytes)
        deterministic["status"] = "failed"
        deterministic["can_approve"] = False
        deterministic["summary"] = "2 frames failed alpha bbox QA."
        for frame_index, issue in ((2, "unsafe_margin"), (6, "master_anchor_mismatch")):
            deterministic["frames"][frame_index]["status"] = "failed"
            deterministic["frames"][frame_index]["issues"] = [issue]
        deterministic["issues"] = [
            "3컷: unsafe_margin",
            "7컷: master_anchor_mismatch",
        ]
        failed_qa = {
            "status": "failed",
            "can_approve": False,
            "summary": "3·7컷 재생성 필요",
            "deterministic": deterministic,
            "ai": {
                "status": "passed",
                "summary": "나머지 컷 통과",
                "issues": [],
                "frames": [],
                "model": backend_main.OPENAI_SPRITE_QA_MODEL,
            },
        }
        timestamp = backend_main.now_iso()
        with backend_main.connect_db() as db:
            db.execute(
                """
                INSERT INTO sprite_versions (
                    id, team_id, contract, status, source_url, corrected_url,
                    atlas_url, parts_json, qa_json, model, created_at, updated_at
                ) VALUES (?, 1, ?, 'review', ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "source-version",
                    backend_main.GARMENT_TRANSFER_CONTRACT,
                    f"/uploads/{corrected_name}",
                    f"/uploads/{corrected_name}",
                    f"/uploads/{atlas_name}",
                    "{}",
                    json.dumps(failed_qa),
                    backend_main.OPENAI_IMAGE_MODEL,
                    timestamp,
                    timestamp,
                ),
            )
            db.execute(
                """
                UPDATE teams
                SET showcase_capture_corrected_url = ?,
                    showcase_sprite_url = ?,
                    showcase_sprite_active_url = ?,
                    showcase_sprite_status = 'review',
                    showcase_sprite_contract = ?,
                    showcase_sprite_version_id = ?,
                    showcase_sprite_active_version_id = ?,
                    showcase_sprite_quality_status = 'failed',
                    showcase_sprite_quality_json = ?,
                    showcase_sprite_updated_at = ?,
                    updated_at = ?
                WHERE id = 1
                """,
                (
                    f"/uploads/{corrected_name}",
                    f"/uploads/{atlas_name}",
                    f"/uploads/{atlas_name}",
                    backend_main.GARMENT_TRANSFER_CONTRACT,
                    "source-version",
                    "source-version",
                    json.dumps(failed_qa),
                    timestamp,
                    timestamp,
                ),
            )

        payload = backend_main.SpriteFramePatchPayload(frames=[7, 3])
        started = asyncio.run(backend_main.start_showcase_frame_patch(1, payload))
        resumed = asyncio.run(backend_main.start_showcase_frame_patch(1, payload))
        self.assertEqual(started["version"]["id"], resumed["version"]["id"])
        self.assertNotEqual(started["version"]["id"], "source-version")
        self.assertEqual(started["next_action"], "patch")
        self.assertEqual(started["frame_patch"]["remaining_frames"], [3, 7])

        replacement = Image.new(
            "RGBA",
            (backend_main.GARMENT_ATLAS_CELL_SIZE, backend_main.GARMENT_ATLAS_CELL_SIZE),
            (0, 0, 0, 0),
        )
        ImageDraw.Draw(replacement).rectangle((120, 80, 240, 330), fill=(220, 35, 60, 255))
        replacement_bytes = backend_main._image_to_png_bytes(replacement)
        passed_qa = {
            **failed_qa,
            "status": "passed",
            "can_approve": True,
            "summary": "교체 후 전체 QA 통과",
            "deterministic": {
                **deterministic,
                "status": "passed",
                "can_approve": True,
                "summary": "32-frame alpha bbox QA passed.",
                "issues": [],
                "frames": [
                    {**frame, "status": "passed", "issues": []}
                    for frame in deterministic["frames"]
                ],
            },
        }
        with (
            patch(
                "backend.ai_generation.request_master_locked_garment_frame",
                new=AsyncMock(side_effect=[
                    HTTPException(status_code=504, detail="3컷 응답 지연"),
                    replacement_bytes,
                    replacement_bytes,
                ]),
            ) as regenerate,
            patch(
                "backend.ai_review.inspect_garment_atlas_quality",
                new=AsyncMock(return_value=passed_qa),
            ),
        ):
            retry = asyncio.run(backend_main.regenerate_showcase_frame_patch(1))
            first_patch = asyncio.run(backend_main.regenerate_showcase_frame_patch(1))
            patched = asyncio.run(backend_main.regenerate_showcase_frame_patch(1))
            reviewed = asyncio.run(backend_main.review_showcase_capture_atlas(1))

        self.assertEqual(retry["next_action"], "retry")
        self.assertEqual(retry["frame_patch"]["remaining_frames"], [3, 7])
        self.assertEqual(regenerate.await_count, 3)
        self.assertEqual(regenerate.await_args_list[1].args[2], 3)
        self.assertIn("unsafe_margin", regenerate.await_args_list[1].kwargs["correction"])
        self.assertEqual(regenerate.await_args_list[2].args[2], 7)
        self.assertIn("master_anchor_mismatch", regenerate.await_args_list[2].kwargs["correction"])
        self.assertEqual(first_patch["next_action"], "patch")
        self.assertEqual(first_patch["frame_patch"]["completed_frames"], [3])
        self.assertEqual(first_patch["frame_patch"]["remaining_frames"], [7])
        self.assertEqual(patched["next_action"], "review")
        self.assertEqual(patched["frame_patch"]["completed_frames"], [3, 7])
        self.assertEqual(reviewed["next_action"], "complete")
        self.assertTrue(reviewed["team"]["showcase_sprite_quality"]["can_approve"])

        patched_path = config.UPLOADS_DIR / Path(patched["atlas_url"]).name
        with Image.open(io.BytesIO(atlas_bytes)) as original, Image.open(patched_path) as updated:
            for frame in range(1, 26):
                box = backend_main.garment_atlas_frame_box(frame)
                if frame in {3, 7}:
                    self.assertNotEqual(original.crop(box).tobytes(), updated.crop(box).tobytes())
                else:
                    self.assertEqual(original.crop(box).tobytes(), updated.crop(box).tobytes())

        versions = asyncio.run(backend_main.list_sprite_versions(1))
        self.assertEqual(len(versions["versions"]), 2)
        self.assertEqual(versions["active_version_id"], "source-version")
        self.assertEqual(versions["candidate_version_id"], patched["version"]["id"])

    def test_compose_deterministic_failure_stops_retrying(self):
        reference = backend_main.UploadFile(
            filename="capture.png",
            file=io.BytesIO(make_garment_capture()),
            headers=Headers({"content-type": "image/png"}),
        )
        with patch(
            "backend.ai_generation.request_capture_quality_review",
            new=AsyncMock(return_value={
                "status": "passed",
                "can_process": True,
                "summary": "통과",
                "page_corners": {
                    "top_left": [0.0, 0.0],
                    "top_right": [1.0, 0.0],
                    "bottom_right": [1.0, 1.0],
                    "bottom_left": [0.0, 1.0],
                },
                "checks": {},
                "issues": [],
            }),
        ):
            asyncio.run(backend_main.process_showcase_capture(1, reference))

        asyncio.run(backend_main.start_showcase_capture_compose(1))
        with (
            patch(
                "backend.ai_generation.request_master_locked_garment_atlas",
                new=AsyncMock(side_effect=HTTPException(
                    status_code=502,
                    detail="AI 32컷 응답 형식이 올바르지 않습니다",
                )),
            ),
            self.assertRaises(HTTPException),
        ):
            asyncio.run(backend_main.generate_showcase_capture_atlas(1))

        status = asyncio.run(backend_main.get_showcase_compose_status(1))
        self.assertEqual(status["next_action"], "failed")
        self.assertEqual(status["team"]["showcase_sprite_status"], "failed")

    def test_new_capture_is_blocked_while_compose_is_active(self):
        first_reference = backend_main.UploadFile(
            filename="capture.png",
            file=io.BytesIO(make_garment_capture()),
            headers=Headers({"content-type": "image/png"}),
        )
        quality = {
            "status": "passed",
            "can_process": True,
            "summary": "통과",
            "page_corners": {
                "top_left": [0.0, 0.0],
                "top_right": [1.0, 0.0],
                "bottom_right": [1.0, 1.0],
                "bottom_left": [0.0, 1.0],
            },
            "checks": {},
            "issues": [],
        }
        with patch(
            "backend.ai_generation.request_capture_quality_review",
            new=AsyncMock(return_value=quality),
        ):
            asyncio.run(backend_main.process_showcase_capture(1, first_reference))
        asyncio.run(backend_main.start_showcase_capture_compose(1))

        second_reference = backend_main.UploadFile(
            filename="capture-2.png",
            file=io.BytesIO(make_garment_capture()),
            headers=Headers({"content-type": "image/png"}),
        )
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(backend_main.process_showcase_capture(1, second_reference))

        self.assertEqual(caught.exception.status_code, 409)
        self.assertIn("생성이 진행 중", str(caught.exception.detail))

    def test_generated_compose_step_is_idempotent(self):
        reference = backend_main.UploadFile(
            filename="capture.png",
            file=io.BytesIO(make_garment_capture()),
            headers=Headers({"content-type": "image/png"}),
        )
        with patch(
            "backend.ai_generation.request_capture_quality_review",
            new=AsyncMock(return_value={
                "status": "passed",
                "can_process": True,
                "summary": "통과",
                "page_corners": {
                    "top_left": [0.0, 0.0],
                    "top_right": [1.0, 0.0],
                    "bottom_right": [1.0, 1.0],
                    "bottom_left": [0.0, 1.0],
                },
                "checks": {},
                "issues": [],
            }),
        ):
            asyncio.run(backend_main.process_showcase_capture(1, reference))

        atlas = backend_main._image_to_png_bytes(
            backend_main.normalize_master_locked_atlas(
                backend_main.master_reference_for_ai(),
            ),
        )
        asyncio.run(backend_main.start_showcase_capture_compose(1))
        with patch(
            "backend.ai_generation.request_master_locked_garment_atlas",
            new=AsyncMock(return_value=atlas),
        ) as generate:
            first = asyncio.run(backend_main.generate_showcase_capture_atlas(1))
            resumed = asyncio.run(backend_main.generate_showcase_capture_atlas(1))

        generate.assert_awaited_once()
        self.assertEqual(first["next_action"], "review")
        self.assertEqual(resumed["next_action"], "review")
        self.assertEqual(first["atlas_url"], resumed["atlas_url"])

    def test_master_locked_normalization_matches_shared_actor_scale_and_baseline(self):
        source = backend_main.load_garment_master_atlas()
        master_cell = source.crop((0, 0, 360, 360))
        master_bbox = master_cell.getchannel("A").getbbox()
        self.assertIsNotNone(master_bbox)
        target_bbox = backend_main.master_display_target_bbox(master_bbox)

        normalized = backend_main.normalize_master_locked_atlas(
            backend_main.master_reference_for_ai(),
        )
        report = backend_main.analyze_garment_atlas_pixels(normalized)
        normalized_bbox = normalized.crop((0, 0, 360, 360)).getchannel("A").getbbox()

        self.assertEqual(normalized.size, (backend_main.GARMENT_ATLAS_WIDTH, backend_main.GARMENT_ATLAS_HEIGHT))
        self.assertEqual(report["status"], "passed")
        self.assertIsNotNone(normalized_bbox)
        self.assertGreaterEqual(
            normalized_bbox[3] - normalized_bbox[1],
            (master_bbox[3] - master_bbox[1]) * 0.99,
        )
        self.assertEqual(normalized_bbox[3] - normalized_bbox[1], target_bbox[3] - target_bbox[1])
        for frame in report["frames"]:
            self.assertLessEqual(abs(frame["anchor_delta"]["center_x"]), 1)
            self.assertLessEqual(abs(frame["anchor_delta"]["baseline"]), 1)
            self.assertGreaterEqual(frame["size_ratio"]["height"], 0.99)

    def test_sprite_contract_scales_existing_small_atlases_only(self):
        previous = backend_main.public_sprite_contract(
            backend_main.PREVIOUS_GARMENT_TRANSFER_CONTRACT,
        )
        pre_campfire = backend_main.public_sprite_contract(
            backend_main.PRE_CAMPFIRE_GARMENT_TRANSFER_CONTRACT,
        )
        current = backend_main.public_sprite_contract(backend_main.GARMENT_TRANSFER_CONTRACT)
        v5 = backend_main.public_sprite_contract(backend_main.V5_GARMENT_TRANSFER_CONTRACT)

        self.assertEqual(previous["version"], 3)
        self.assertEqual(previous["display_scale"], backend_main.GARMENT_DISPLAY_SCALE)
        self.assertEqual(pre_campfire["version"], 4)
        self.assertEqual(pre_campfire["display_scale"], 1.0)
        self.assertEqual(v5["version"], 5)
        self.assertEqual(v5["layout"], "5x5")
        self.assertEqual(v5["frame_count"], 25)
        self.assertEqual(current["version"], 7)
        self.assertEqual(current["layout"], "8x4")
        self.assertEqual(current["frame_count"], 32)
        self.assertEqual(current["display_scale"], 1.0)

    def test_master_atlas_quality_rejects_a_character_shrunk_inside_its_cell(self):
        atlas = backend_main.load_garment_master_atlas()
        cell = atlas.crop((0, 0, 360, 360))
        bbox = cell.getchannel("A").getbbox()
        self.assertIsNotNone(bbox)
        character = cell.crop(bbox).resize(
            (
                round((bbox[2] - bbox[0]) * 0.62),
                round((bbox[3] - bbox[1]) * 0.62),
            ),
            Image.Resampling.LANCZOS,
        )
        atlas.paste((0, 0, 0, 0), (0, 0, 360, 360))
        x = round(((bbox[0] + bbox[2]) - character.width) / 2)
        y = bbox[3] - character.height
        atlas.alpha_composite(character, (x, y))

        report = backend_main.analyze_garment_atlas_pixels(atlas)

        self.assertEqual(report["status"], "failed")
        self.assertIn("character_too_small", report["frames"][0]["issues"])

    def test_capture_correction_keeps_phone_photo_corner_orientation(self):
        source = Image.new("RGB", (100, 100), "white")
        pixels = source.load()
        patches = (
            ((10, 10, 35, 35), (240, 20, 20)),
            ((65, 10, 90, 35), (20, 220, 20)),
            ((10, 65, 35, 90), (20, 20, 240)),
            ((65, 65, 90, 90), (230, 210, 20)),
        )
        for (left, top, right, bottom), color in patches:
            for y in range(top, bottom):
                for x in range(left, right):
                    pixels[x, y] = color
        buffer = io.BytesIO()
        source.save(buffer, format="PNG")
        quality = backend_main.default_capture_quality()
        corrected = backend_main.correct_capture_image(buffer.getvalue(), quality)
        width, height = corrected.size
        samples = [
            corrected.getpixel((round(width * 0.22), round(height * 0.22))),
            corrected.getpixel((round(width * 0.78), round(height * 0.22))),
            corrected.getpixel((round(width * 0.22), round(height * 0.78))),
            corrected.getpixel((round(width * 0.78), round(height * 0.78))),
        ]
        self.assertGreater(samples[0][0], max(samples[0][1:]))
        self.assertGreater(samples[1][1], max(samples[1][0], samples[1][2]))
        self.assertGreater(samples[2][2], max(samples[2][:2]))
        self.assertGreater(samples[3][0], samples[3][2])
        self.assertGreater(samples[3][1], samples[3][2])

    def test_master_loader_keeps_all_32_poses_inside_cell_margins(self):
        expected_path = (
            backend_main.SHOWCASE_EXPANDED_MASTER_PATH
            if backend_main.SHOWCASE_EXPANDED_MASTER_PATH.is_file()
            else backend_main.SHOWCASE_SAFE_MASTER_PATH
        )
        self.assertEqual(backend_main.SHOWCASE_MASTER_PATH, expected_path)
        master = backend_main.load_garment_master_atlas()
        self.assertEqual(master.size, (backend_main.GARMENT_ATLAS_WIDTH, backend_main.GARMENT_ATLAS_HEIGHT))
        for frame in range(1, backend_main.GARMENT_FRAME_COUNT + 1):
            bbox = master.crop(backend_main.garment_atlas_frame_box(frame)).getchannel("A").getbbox()
            self.assertIsNotNone(bbox)
            self.assertGreaterEqual(min(
                bbox[0],
                bbox[1],
                360 - bbox[2],
                360 - bbox[3],
            ), 18)
        normalized = backend_main.normalize_master_locked_atlas(
            backend_main.master_reference_for_ai(),
        )
        report = backend_main.analyze_garment_atlas_pixels(normalized)
        self.assertEqual(report["status"], "passed")
        self.assertEqual(len(report["frames"]), backend_main.GARMENT_FRAME_COUNT)
        for frame in report["frames"]:
            self.assertGreaterEqual(min(frame["margins"].values()), 14)

    def test_showcase_sprite_approval_blocks_failed_qa_without_force(self):
        quality = {
            "status": "failed",
            "can_approve": False,
            "summary": "6컷 머리 잘림",
        }
        with backend_main.connect_db() as db:
            db.execute(
                """
                UPDATE teams
                SET showcase_sprite_url = ?, showcase_sprite_status = 'review',
                    showcase_sprite_quality_status = 'failed',
                    showcase_sprite_quality_json = ?
                WHERE id = 1
                """,
                ("/uploads/failed-atlas.png", json.dumps(quality)),
            )

        with self.assertRaises(HTTPException) as caught:
            asyncio.run(backend_main.approve_showcase_sprite(1))

        self.assertEqual(caught.exception.status_code, 409)
        approved = asyncio.run(backend_main.approve_showcase_sprite(
            1,
            backend_main.SpriteApprovalPayload(force=True),
        ))
        self.assertEqual(approved["showcase_sprite_status"], "ready")
        self.assertEqual(approved["showcase_sprite_active_url"], "/uploads/failed-atlas.png")

    def test_showcase_sprite_approval_requires_a_generated_sheet(self):
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(backend_main.approve_showcase_sprite(1))

        self.assertEqual(caught.exception.status_code, 409)

    def test_showcase_sprite_generation_requires_a_registered_character(self):
        reference = backend_main.UploadFile(
            filename="peter-reference.png",
            file=io.BytesIO(b"\x89PNG\r\n\x1a\nreference"),
            headers=Headers({"content-type": "image/png"}),
        )

        with self.assertRaises(HTTPException) as caught:
            asyncio.run(backend_main.generate_showcase_sprite(1, reference))

        self.assertEqual(caught.exception.status_code, 409)

    def test_showcase_sprite_generation_records_api_failure(self):
        with backend_main.connect_db() as db:
            db.execute(
                "UPDATE teams SET showcase_image_url = ? WHERE id = 1",
                ("/uploads/team-1-showcase-source.png",),
            )
        reference = backend_main.UploadFile(
            filename="peter-reference.png",
            file=io.BytesIO(b"\x89PNG\r\n\x1a\nreference"),
            headers=Headers({"content-type": "image/png"}),
        )
        failure = HTTPException(status_code=429, detail="이미지 생성 한도에 도달했습니다")

        with patch(
            "backend.ai_generation.request_showcase_sprite",
            new=AsyncMock(side_effect=failure),
        ):
            with self.assertRaises(HTTPException) as caught:
                asyncio.run(backend_main.generate_showcase_sprite(1, reference))

        self.assertEqual(caught.exception.status_code, 429)
        with backend_main.connect_db() as db:
            updated = dict(backend_main.get_team_or_404(db, 1))
        self.assertEqual(updated["showcase_sprite_status"], "failed")
        self.assertEqual(updated["showcase_sprite_error"], "이미지 생성 한도에 도달했습니다")
        self.assertIsNotNone(updated["showcase_sprite_updated_at"])

    def test_frontend_route_explains_a_missing_build(self):
        config.FRONTEND_DIST = Path(self.tempdir.name) / "missing-dist"
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(backend_main.world_page())
        self.assertEqual(caught.exception.status_code, 503)
        self.assertIn("npm run build", caught.exception.detail)


    def test_health_reports_local_storage_backends(self):
        result = asyncio.run(backend_main.health())
        self.assertEqual(result["database"], "sqlite")
        self.assertEqual(result["object_storage"], "local")
        self.assertIn("openai_configured", result)
        self.assertEqual(result["openai_image_model"], backend_main.OPENAI_IMAGE_MODEL)
        self.assertEqual(result["openai_image_quality"], "high")
        self.assertTrue(result["fixed_peter_master_available"])
        self.assertEqual(result["fixed_peter_master_frames"], backend_main.GARMENT_FRAME_COUNT)

    def test_fixed_peter_master_endpoint_serves_configured_master_atlas(self):
        response = asyncio.run(backend_main.fixed_peter_master())
        self.assertEqual(Path(response.path), backend_main.SHOWCASE_MASTER_PATH)
        self.assertEqual(response.media_type, "image/png")
        self.assertEqual(response.headers["cache-control"], "public, max-age=3600")

    def test_vercel_function_bundle_includes_fixed_peter_master(self):
        config = json.loads((backend_main.ROOT / "vercel.json").read_text())
        function = config["functions"]["api/index.py"]
        self.assertEqual(function["includeFiles"], "runtime-assets/**")
        self.assertTrue(backend_main.SHOWCASE_SAFE_MASTER_PATH.is_file())



    def test_one_model_asset_can_be_applied_to_multiple_teams(self):
        timestamp = backend_main.now_iso()
        with backend_main.connect_db() as db:
            db.execute(
                """
                INSERT INTO model_assets (
                    id, name, glb_url, created_at, updated_at
                ) VALUES ('reusable', '재사용 모델', 'https://assets.example/reusable.glb', ?, ?)
                """,
                (timestamp, timestamp),
            )

        result = asyncio.run(backend_main.apply_model_asset(
            "reusable",
            backend_main.ModelAssetApply(team_ids=[4, 7, 4]),
        ))

        self.assertEqual(result["applied_count"], 2)
        with backend_main.connect_db() as db:
            teams = db.execute(
                "SELECT id, model_url, model_asset_id FROM teams WHERE id IN (4, 7) ORDER BY id"
            ).fetchall()
            untouched = db.execute("SELECT model_url FROM teams WHERE id = 8").fetchone()
        self.assertEqual([row["id"] for row in teams], [4, 7])
        self.assertTrue(all(row["model_asset_id"] == "reusable" for row in teams))
        self.assertTrue(all(row["model_url"].endswith("reusable.glb") for row in teams))
        self.assertIsNone(untouched["model_url"])

    def test_existing_glb_can_be_uploaded_to_the_model_library(self):
        contents = make_glb({
            "asset": {"version": "2.0"},
            "accessors": [{"count": 60000}],
            "meshes": [{"primitives": [{"indices": 0}]}],
            "skins": [{"joints": [0]}],
            "animations": [{"channels": [{"sampler": 0, "target": {"node": 0}}]}],
        })
        upload = backend_main.UploadFile(
            filename="existing-peter.glb",
            file=io.BytesIO(contents),
            headers=Headers({"content-type": "model/gltf-binary"}),
        )

        with patch(
            "backend.routes.model_assets.persist_uploaded_glb",
            return_value="https://assets.example/uploaded.glb",
        ):
            asset = asyncio.run(backend_main.upload_model_asset(upload, "기존 베드로"))

        self.assertEqual(asset["name"], "기존 베드로")
        self.assertEqual(asset["pipeline_profile"], "uploaded_glb")
        self.assertEqual(asset["glb_triangles"], 20000)
        self.assertEqual(asset["glb_animations"], 1)
        self.assertEqual(asset["team_ids"], [])

    def test_existing_glb_upload_rejects_a_static_model(self):
        contents = make_glb({
            "asset": {"version": "2.0"},
            "accessors": [{"count": 3000}],
            "meshes": [{"primitives": [{"indices": 0}]}],
        })
        upload = backend_main.UploadFile(
            filename="static.glb",
            file=io.BytesIO(contents),
            headers=Headers({"content-type": "model/gltf-binary"}),
        )

        with self.assertRaises(HTTPException) as caught:
            asyncio.run(backend_main.upload_model_asset(upload, "정적 모델"))

        self.assertEqual(caught.exception.status_code, 422)
        self.assertIn("리깅", caught.exception.detail)

    def test_accepts_a_bounded_rigged_animated_glb(self):
        contents = make_glb({
            "asset": {"version": "2.0"},
            "buffers": [{}],
            "accessors": [{"count": 60000}],
            "meshes": [{"primitives": [{"indices": 0}]}],
            "skins": [{"joints": [0]}],
            "animations": [{"channels": [{"sampler": 0, "target": {"node": 0}}]}],
        })

        result = backend_main.inspect_animated_glb(contents)

        self.assertEqual(result["triangles"], 20000)
        self.assertEqual(result["animations"], 1)
        self.assertEqual(result["skins"], 1)

    def test_production_validation_requires_idle_and_walk_outputs(self):
        contents = make_glb({
            "asset": {"version": "2.0"},
            "accessors": [{"count": 3000}],
            "meshes": [{"primitives": [{"indices": 0}]}],
            "skins": [{"joints": [0]}],
            "animations": [{"channels": [{"sampler": 0, "target": {"node": 0}}]}],
        })

        with self.assertRaisesRegex(ValueError, "필요: 2개"):
            backend_main.inspect_animated_glb(contents, minimum_animations=2)




    def test_rejects_a_glb_without_walk_animation_channels(self):
        contents = make_glb({
            "asset": {"version": "2.0"},
            "accessors": [{"count": 3000}],
            "meshes": [{"primitives": [{"indices": 0}]}],
            "skins": [{"joints": [0]}],
            "animations": [{"channels": []}],
        })

        with self.assertRaisesRegex(ValueError, "애니메이션"):
            backend_main.inspect_animated_glb(contents)

    def test_rejects_a_glb_over_the_triangle_budget(self):
        contents = make_glb({
            "asset": {"version": "2.0"},
            "accessors": [{"count": (backend_main.MAX_GLB_TRIANGLES + 1) * 3}],
            "meshes": [{"primitives": [{"indices": 0}]}],
            "skins": [{"joints": [0]}],
            "animations": [{"channels": [{"sampler": 0, "target": {"node": 0}}]}],
        })

        with self.assertRaisesRegex(ValueError, "너무 복잡"):
            backend_main.inspect_animated_glb(contents)

if __name__ == "__main__":
    unittest.main()
