import asyncio
import io
import json
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from starlette.datastructures import Headers

import backend_main


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


class Peter3DBackendTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.original_db_path = backend_main.DB_PATH
        self.original_models_dir = backend_main.MODELS_DIR
        self.original_uploads_dir = backend_main.UPLOADS_DIR
        self.original_frontend_dist = backend_main.FRONTEND_DIST
        backend_main.DB_PATH = Path(self.tempdir.name) / "test.db"
        backend_main.MODELS_DIR = Path(self.tempdir.name) / "models"
        backend_main.UPLOADS_DIR = Path(self.tempdir.name) / "uploads"
        backend_main.FRONTEND_DIST = Path(self.tempdir.name) / "frontend" / "dist"
        backend_main.MODELS_DIR.mkdir()
        backend_main.UPLOADS_DIR.mkdir()
        backend_main.FRONTEND_DIST.mkdir(parents=True)
        (backend_main.FRONTEND_DIST / "index.html").write_text(
            '<!doctype html><div id="root"></div>',
            encoding="utf-8",
        )
        backend_main.init_db()

    def tearDown(self):
        backend_main.DB_PATH = self.original_db_path
        backend_main.MODELS_DIR = self.original_models_dir
        backend_main.UPLOADS_DIR = self.original_uploads_dir
        backend_main.FRONTEND_DIST = self.original_frontend_dist
        self.tempdir.cleanup()

    def test_initializes_exactly_21_teams(self):
        with backend_main.connect_db() as db:
            count = db.execute("SELECT COUNT(*) FROM teams").fetchone()[0]
        self.assertEqual(count, 21)

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
        self.assertIn("model_asset_id", team_columns)
        self.assertIn("showcase_image_url", team_columns)
        self.assertTrue({
            "showcase_sprite_url",
            "showcase_sprite_status",
            "showcase_sprite_error",
            "showcase_sprite_model",
            "showcase_sprite_updated_at",
        }.issubset(team_columns))
        self.assertIsNotNone(asset_table)

    def test_generation_profiles_keep_provider_face_limits_valid(self):
        h3 = backend_main.image_model_options("h3_smart")
        p1 = backend_main.image_model_options("p1")

        self.assertTrue(h3["enable_image_autofix"])
        self.assertEqual(h3["model_version"], "v3.1-20260211")
        self.assertEqual(h3["face_limit"], 40_000)
        self.assertNotIn("smart_low_poly", h3)
        self.assertTrue(p1["enable_image_autofix"])
        self.assertEqual(p1["model_version"], "P1-20260311")
        self.assertEqual(p1["face_limit"], 20_000)
        self.assertNotIn("smart_low_poly", p1)
        self.assertNotIn("geometry_quality", p1)
        self.assertNotIn("texture_quality", p1)
        self.assertNotIn("compress", p1)

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

    def test_showcase_sprite_prompt_preserves_the_complete_student_drawing(self):
        prompt = backend_main.SHOWCASE_SPRITE_PROMPT
        self.assertIn("sole visual source of truth", prompt)
        self.assertIn("clothing colors", prompt)
        self.assertIn("handmade texture", prompt)
        self.assertIn("strict 90-degree side-profile walking-right", prompt)

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
            patch("backend_main.httpx.AsyncClient", return_value=FakeClient()),
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
            patch.object(backend_main, "OPENAI_IMAGE_MODEL", "gpt-image-1"),
            patch("backend_main.httpx.AsyncClient", return_value=FakeClient()),
        ):
            asyncio.run(
                backend_main.request_showcase_sprite(
                    b"student-character",
                    "image/png",
                    "team-1-peter.png",
                )
            )

        self.assertEqual(recorded["data"]["input_fidelity"], "high")

    def test_multiview_fallback_reuses_generated_views(self):
        payload = backend_main.multiview_model_payload("h3_smart", "views-task")

        self.assertEqual(payload["type"], "multiview_to_model")
        self.assertEqual(payload["original_task_id"], "views-task")
        self.assertEqual(payload["face_limit"], 40_000)
        self.assertNotIn("smart_low_poly", payload)

    def test_task_failure_message_keeps_provider_error_code(self):
        task = type("FailedTask", (), {"error_code": 1004, "error_msg": None})()

        self.assertEqual(
            backend_main.task_failure_message(task, "모델링 실패"),
            "모델링 실패 (Tripo 오류 코드: 1004)",
        )

    def test_rig_and_animation_tasks_use_biped_v1_and_two_clips(self):
        class FakeClient:
            def __init__(self):
                self.rig_kwargs = None
                self.animation_kwargs = None

            async def rig_model(self, **kwargs):
                self.rig_kwargs = kwargs
                return "rig-task"

            async def retarget_animation(self, **kwargs):
                self.animation_kwargs = kwargs
                return "animation-task"

        client = FakeClient()
        rig_id = asyncio.run(backend_main.create_rig_task(client, "model-task"))
        animation_id = asyncio.run(backend_main.create_animation_task(client, rig_id))

        self.assertEqual(client.rig_kwargs["model_version"], "v1.0-20240301")
        self.assertEqual(
            client.animation_kwargs["animation"],
            [
                "preset:biped:standing_relax",
                "preset:biped:walk",
            ],
        )
        self.assertEqual(animation_id, "animation-task")

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
        expected = backend_main.FRONTEND_DIST / "index.html"
        self.assertEqual(world.path, expected)
        self.assertEqual(admin.path, expected)
        self.assertEqual(legacy_world.path, expected)

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
        stored_path = backend_main.UPLOADS_DIR / Path(updated["showcase_image_url"]).name
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

        with patch(
            "backend_main.request_showcase_sprite",
            new=AsyncMock(return_value=sprite),
        ) as request:
            updated = asyncio.run(backend_main.generate_showcase_sprite(1, reference))

        request.assert_awaited_once()
        self.assertEqual(updated["showcase_sprite_status"], "review")
        self.assertEqual(updated["showcase_sprite_model"], backend_main.OPENAI_IMAGE_MODEL)
        self.assertTrue(updated["showcase_sprite_url"].startswith("/uploads/team-1-sprite-"))
        stored_path = backend_main.UPLOADS_DIR / Path(updated["showcase_sprite_url"]).name
        self.assertEqual(stored_path.read_bytes(), sprite)

        approved = asyncio.run(backend_main.approve_showcase_sprite(1))
        self.assertEqual(approved["showcase_sprite_status"], "ready")

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
            "backend_main.request_showcase_sprite",
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
        backend_main.FRONTEND_DIST = Path(self.tempdir.name) / "missing-dist"
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(backend_main.world_page())
        self.assertEqual(caught.exception.status_code, 503)
        self.assertIn("npm run build", caught.exception.detail)

    def test_serverless_runtime_rejects_conversion_before_writing_files(self):
        original = backend_main.SERVERLESS_RUNTIME
        backend_main.SERVERLESS_RUNTIME = True
        try:
            with self.assertRaises(HTTPException) as caught:
                asyncio.run(backend_main.convert_team(1, None))
        finally:
            backend_main.SERVERLESS_RUNTIME = original
        self.assertEqual(caught.exception.status_code, 503)
        self.assertIn("Neon", caught.exception.detail)

    def test_health_reports_local_storage_backends(self):
        result = asyncio.run(backend_main.health())
        self.assertEqual(result["database"], "sqlite")
        self.assertEqual(result["object_storage"], "local")
        self.assertIn("openai_configured", result)
        self.assertEqual(result["openai_image_model"], backend_main.OPENAI_IMAGE_MODEL)
        self.assertEqual(result["openai_image_quality"], "high")

    def test_public_job_hides_internal_paths_and_provider_task_ids(self):
        with backend_main.connect_db() as db:
            timestamp = backend_main.now_iso()
            db.execute(
                """
                INSERT INTO conversion_jobs (
                    id, team_id, status, image_path, model_task_id, created_at, updated_at
                ) VALUES (?, 1, 'modeling', ?, ?, ?, ?)
                """,
                ("safe-job", "/private/local/image.png", "provider-task", timestamp, timestamp),
            )
            row = db.execute("SELECT * FROM conversion_jobs WHERE id = ?", ("safe-job",)).fetchone()

        result = backend_main.public_job(row)
        self.assertNotIn("image_path", result)
        self.assertNotIn("model_task_id", result)
        self.assertEqual(result["id"], "safe-job")

    def test_asset_generation_finishes_without_changing_a_team(self):
        timestamp = backend_main.now_iso()
        with backend_main.connect_db() as db:
            db.execute(
                """
                INSERT INTO conversion_jobs (
                    id, team_id, status, image_path, asset_only, asset_name,
                    source_image_url, created_at, updated_at
                ) VALUES ('shared-model', 1, 'animating', 'source.png', 1,
                    '공용 베드로', '/uploads/source.png', ?, ?)
                """,
                (timestamp, timestamp),
            )
            job = dict(db.execute(
                "SELECT * FROM conversion_jobs WHERE id = 'shared-model'"
            ).fetchone())

        asyncio.run(backend_main.activate_generated_model(
            job,
            "https://assets.example/shared.glb",
            {"bytes": 1024, "triangles": 20000, "animations": 2},
        ))

        with backend_main.connect_db() as db:
            team = db.execute("SELECT * FROM teams WHERE id = 1").fetchone()
            asset = db.execute(
                "SELECT * FROM model_assets WHERE id = 'shared-model'"
            ).fetchone()
            completed_job = db.execute(
                "SELECT * FROM conversion_jobs WHERE id = 'shared-model'"
            ).fetchone()
        self.assertIsNone(team["model_url"])
        self.assertEqual(team["conversion_status"], "empty")
        self.assertEqual(asset["name"], "공용 베드로")
        self.assertEqual(completed_job["status"], "done")
        self.assertIsNone(backend_main.public_job(completed_job)["team_id"])

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

        with patch.object(
            backend_main,
            "persist_uploaded_glb",
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

    def test_serverless_queue_does_not_start_beyond_worker_limit(self):
        timestamp = backend_main.now_iso()
        with backend_main.connect_db() as db:
            for index in range(backend_main.WORKER_COUNT):
                db.execute(
                    """
                    INSERT INTO conversion_jobs (
                        id, team_id, status, image_path, created_at, updated_at
                    ) VALUES (?, ?, 'modeling', ?, ?, ?)
                    """,
                    (f"active-{index}", index + 1, f"active-{index}.png", timestamp, timestamp),
                )
            db.execute(
                """
                INSERT INTO conversion_jobs (
                    id, team_id, status, image_path, created_at, updated_at
                ) VALUES ('queued-job', 21, 'queued', 'queued.png', ?, ?)
                """,
                (timestamp, timestamp),
            )

        with patch.object(backend_main, "TripoClient") as client:
            asyncio.run(backend_main.advance_serverless_job("queued-job"))

        client.assert_not_called()
        with backend_main.connect_db() as db:
            row = db.execute(
                "SELECT status, lease_token FROM conversion_jobs WHERE id = 'queued-job'"
            ).fetchone()
        self.assertEqual(row["status"], "queued")
        self.assertIsNone(row["lease_token"])

    def test_serverless_queue_counts_a_leased_queued_job_as_active(self):
        timestamp = backend_main.now_iso()
        lease_until = "2999-01-01T00:00:00+00:00"
        with backend_main.connect_db() as db:
            db.execute(
                """
                INSERT INTO conversion_jobs (
                    id, team_id, status, image_path, lease_token, lease_until,
                    created_at, updated_at
                ) VALUES ('leased-job', 1, 'queued', 'leased.png', 'lease', ?, ?, ?)
                """,
                (lease_until, timestamp, timestamp),
            )
            db.execute(
                """
                INSERT INTO conversion_jobs (
                    id, team_id, status, image_path, created_at, updated_at
                ) VALUES ('waiting-job', 2, 'queued', 'waiting.png', ?, ?)
                """,
                (timestamp, timestamp),
            )

        original_workers = backend_main.WORKER_COUNT
        backend_main.WORKER_COUNT = 1
        try:
            with patch.object(backend_main, "TripoClient") as client:
                asyncio.run(backend_main.advance_serverless_job("waiting-job"))
            client.assert_not_called()
        finally:
            backend_main.WORKER_COUNT = original_workers

    def test_multiview_slot_allows_only_one_starting_job(self):
        timestamp = backend_main.now_iso()
        with backend_main.connect_db() as db:
            for team_id in (1, 2):
                db.execute(
                    """
                    INSERT INTO conversion_jobs (
                        id, team_id, status, image_path, created_at, updated_at
                    ) VALUES (?, ?, 'rig_check', ?, ?, ?)
                    """,
                    (f"rig-{team_id}", team_id, f"rig-{team_id}.png", timestamp, timestamp),
                )

        self.assertTrue(backend_main.reserve_multiview_slot("rig-1"))
        self.assertFalse(backend_main.reserve_multiview_slot("rig-2"))
        with backend_main.connect_db() as db:
            first = db.execute(
                "SELECT status, fallback_used FROM conversion_jobs WHERE id = 'rig-1'"
            ).fetchone()
            second = db.execute(
                "SELECT status, fallback_used FROM conversion_jobs WHERE id = 'rig-2'"
            ).fetchone()
        self.assertEqual(first["status"], "multiview_starting")
        self.assertEqual(first["fallback_used"], 1)
        self.assertEqual(second["status"], "rig_check")
        self.assertEqual(second["fallback_used"], 0)

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
