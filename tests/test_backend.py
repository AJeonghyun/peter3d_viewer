import asyncio
import json
import struct
import tempfile
import unittest
from pathlib import Path

from fastapi import HTTPException

import backend_main


def make_glb(document: dict) -> bytes:
    payload = json.dumps(document, separators=(",", ":")).encode("utf-8")
    payload += b" " * ((4 - len(payload) % 4) % 4)
    chunk = struct.pack("<II", len(payload), 0x4E4F534A) + payload
    return struct.pack("<4sII", b"glTF", 2, 12 + len(chunk)) + chunk


class Peter3DBackendTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.original_db_path = backend_main.DB_PATH
        self.original_models_dir = backend_main.MODELS_DIR
        self.original_frontend_dist = backend_main.FRONTEND_DIST
        backend_main.DB_PATH = Path(self.tempdir.name) / "test.db"
        backend_main.MODELS_DIR = Path(self.tempdir.name) / "models"
        backend_main.FRONTEND_DIST = Path(self.tempdir.name) / "frontend" / "dist"
        backend_main.MODELS_DIR.mkdir()
        backend_main.FRONTEND_DIST.mkdir(parents=True)
        (backend_main.FRONTEND_DIST / "index.html").write_text(
            '<!doctype html><div id="root"></div>',
            encoding="utf-8",
        )
        backend_main.init_db()

    def tearDown(self):
        backend_main.DB_PATH = self.original_db_path
        backend_main.MODELS_DIR = self.original_models_dir
        backend_main.FRONTEND_DIST = self.original_frontend_dist
        self.tempdir.cleanup()

    def test_initializes_exactly_25_teams(self):
        with backend_main.connect_db() as db:
            count = db.execute("SELECT COUNT(*) FROM teams").fetchone()[0]
        self.assertEqual(count, 25)

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
        expected = backend_main.FRONTEND_DIST / "index.html"
        self.assertEqual(world.path, expected)
        self.assertEqual(admin.path, expected)

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
