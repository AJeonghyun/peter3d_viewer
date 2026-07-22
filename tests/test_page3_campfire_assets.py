import json
import unittest
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
CELL_SIZE = 360
SEATED_FRAME_INDEXES = {19, 21, 23}


class Page3CampfireAssetTests(unittest.TestCase):
    def test_new_jesus_assets_are_transparent_and_complete(self):
        asset_dir = FRONTEND / "public" / "assets" / "campfire"
        for filename in (
            "jesus-standing-front.png",
            "jesus-standing-back.png",
            "jesus-seated.png",
        ):
            with self.subTest(filename=filename), Image.open(asset_dir / filename) as source:
                image = source.convert("RGBA")
                bounds = image.getchannel("A").getbbox()
                self.assertIsNotNone(bounds)
                assert bounds is not None
                self.assertGreater(bounds[2] - bounds[0], 400)
                self.assertGreater(bounds[3] - bounds[1], 1_000)
                for point in (
                    (0, 0),
                    (image.width - 1, 0),
                    (0, image.height - 1),
                    (image.width - 1, image.height - 1),
                ):
                    self.assertEqual(image.getpixel(point)[3], 0)

    def test_retreat_live_master_contains_only_the_seven_scene_poses(self):
        asset_dir = FRONTEND / "public" / "assets" / "retreat"
        manifest = json.loads((asset_dir / "peter-retreat-master.json").read_text())
        self.assertEqual(manifest["id"], "retreat-live-master-v1")
        self.assertEqual(manifest["layout"], "7x1")
        self.assertEqual(manifest["frame_count"], 7)
        self.assertEqual(
            [frame["id"] for frame in manifest["frames"]],
            [
                "idle-a",
                "idle-b",
                "wave",
                "listen-front",
                "listen-rear",
                "listen-side",
                "back",
            ],
        )
        with Image.open(asset_dir / "peter-retreat-master.png") as source:
            master = source.convert("RGBA")
            self.assertEqual(master.size, (CELL_SIZE * 7, CELL_SIZE))
            for index in range(7):
                cell = master.crop((
                    index * CELL_SIZE,
                    0,
                    (index + 1) * CELL_SIZE,
                    CELL_SIZE,
                ))
                self.assertIsNotNone(cell.getchannel("A").getbbox())
                self.assertEqual(cell.getpixel((0, 0))[3], 0)

        for filename in ("peter-seated-front.png", "peter-standing-back.png"):
            with self.subTest(filename=filename), Image.open(asset_dir / "poses" / filename) as pose:
                rgba = pose.convert("RGBA")
                self.assertIsNotNone(rgba.getchannel("A").getbbox())
                self.assertEqual(rgba.getpixel((0, 0))[3], 0)

    def test_v7_master_contains_only_editor_poses_and_animated_reactions(self):
        runtime_dir = ROOT / "runtime-assets"
        manifest = json.loads(
            (runtime_dir / "peter-retreat-master-expanded-v7.json").read_text()
        )
        self.assertEqual(manifest["id"], "fixed-peter-master-edit-v7")
        self.assertEqual(manifest["layout"], "8x4")
        self.assertEqual(manifest["frame_count"], 32)
        frame_ids = [frame["id"] for frame in manifest["frames"]]
        self.assertEqual(frame_ids[:2], ["idle-a", "idle-b"])
        self.assertEqual(frame_ids[2:13], [f"wave-{index}" for index in range(1, 12)])
        self.assertEqual(frame_ids[13:24], [f"joy-jump-{index}" for index in range(1, 12)])
        self.assertEqual(frame_ids[-2:], ["listen-back", "back"])
        self.assertFalse(any("walk" in frame_id or "run" in frame_id for frame_id in frame_ids))
        with Image.open(runtime_dir / "peter-retreat-master-expanded-v7.png") as source:
            master = source.convert("RGBA")
            self.assertEqual(master.size, (CELL_SIZE * 8, CELL_SIZE * 4))
            for index in range(32):
                cell = master.crop((
                    (index % 8) * CELL_SIZE,
                    (index // 8) * CELL_SIZE,
                    (index % 8 + 1) * CELL_SIZE,
                    (index // 8 + 1) * CELL_SIZE,
                ))
                self.assertIsNotNone(cell.getchannel("A").getbbox())

    def test_jesus_master_matches_the_same_32_pose_contract(self):
        asset_dir = FRONTEND / "public" / "assets" / "retreat"
        manifest = json.loads((asset_dir / "jesus-retreat-master-v1.json").read_text())
        self.assertEqual(manifest["id"], "fixed-jesus-master-edit-v1")
        self.assertEqual(manifest["frame_count"], 32)
        self.assertEqual(manifest["editor_poses"]["listen-back"], 30)
        with Image.open(asset_dir / "jesus-retreat-master-v1.png") as source:
            self.assertEqual(source.size, (CELL_SIZE * 8, CELL_SIZE * 4))
            self.assertEqual(source.getpixel((0, 0))[3], 0)

    def test_campfire_sheet_has_eight_transparent_nonempty_frames(self):
        path = FRONTEND / "public" / "assets" / "campfire" / "campfire-sheet.png"
        with Image.open(path) as sheet:
            rgba = sheet.convert("RGBA")
            self.assertEqual(rgba.size, (CELL_SIZE * 8, CELL_SIZE))
            for index in range(8):
                frame = rgba.crop((
                    index * CELL_SIZE,
                    0,
                    (index + 1) * CELL_SIZE,
                    CELL_SIZE,
                ))
                bounds = frame.getchannel("A").getbbox()
                self.assertIsNotNone(bounds)
                assert bounds is not None
                self.assertGreaterEqual(bounds[0], 12)
                self.assertGreaterEqual(bounds[1], 12)
                self.assertLessEqual(bounds[2], CELL_SIZE - 12)
                self.assertLessEqual(bounds[3], CELL_SIZE - 12)
                self.assertEqual(frame.getpixel((0, 0))[3], 0)
                self.assertEqual(frame.getpixel((CELL_SIZE - 1, 0))[3], 0)

    def test_official_master_contains_three_nonempty_seated_pose_cells(self):
        public_path = (
            FRONTEND / "public" / "assets" / "peter-sober" / "peter-sober-master.png"
        )
        runtime_path = ROOT / "runtime-assets" / "peter-sober-master-safe.png"
        self.assertEqual(public_path.read_bytes(), runtime_path.read_bytes())
        with Image.open(public_path) as master_source:
            master = master_source.convert("RGBA")
            self.assertEqual(master.size, (CELL_SIZE * 5, CELL_SIZE * 5))
            for index in SEATED_FRAME_INDEXES:
                box = (
                    (index % 5) * CELL_SIZE,
                    (index // 5) * CELL_SIZE,
                    (index % 5 + 1) * CELL_SIZE,
                    (index // 5 + 1) * CELL_SIZE,
                )
                cell = master.crop(box)
                bounds = cell.getchannel("A").getbbox()
                self.assertIsNotNone(bounds)
                assert bounds is not None
                self.assertGreater(bounds[2] - bounds[0], 120)
                self.assertGreater(bounds[3] - bounds[1], 120)

    def test_display_has_front_back_and_campfire_scenes_without_nameplates(self):
        source = (FRONTEND / "src" / "pages" / "AllCharactersPage.tsx").read_text()
        styles = (FRONTEND / "src" / "styles" / "retreat-world.css").read_text()
        self.assertNotIn("type: 'boat'", source)
        self.assertNotIn("retreat-parade__boat", source)
        self.assertEqual(
            source.count("{ duration: GROUP_SCENE_DURATION, groupStart:"),
            3,
        )
        self.assertIn("peter-page3-display-mode-v1", source)
        self.assertIn("GROUP_SCENES", source)
        self.assertIn("GROUPS_PER_SCENE = 7", source)
        self.assertIn("groupsForScene(groups, activeGroupScene)", source)
        self.assertIn("data-group-range", source)
        self.assertIn("get('scene')", source)
        self.assertIn("CAMPFIRE_SEATS", source)
        self.assertIn("campfire-sheet.png", source)
        self.assertIn("JesusCharacter", source)
        self.assertIn("aria-label=\"예수님 포즈\"", source)
        self.assertIn("poseId={poseId}", source)
        self.assertNotIn("retreat-parade__nameplate", source)
        self.assertNotIn("retreat-parade__nameplate", styles)
        self.assertNotIn("retreat-parade__scene-label", styles)

    def test_page_three_layout_editor_persists_each_group_and_prop(self):
        source = (FRONTEND / "src" / "pages" / "AllCharactersPage.tsx").read_text()
        self.assertIn("peter-page3-stand-layout-v3", source)
        self.assertIn("peter-page3-back-layout-v2", source)
        self.assertIn("peter-page3-campfire-layout-v1", source)
        self.assertIn("data-layout-edit", source)
        self.assertIn("group-${group.groupNumber}", source)
        self.assertIn("campfireLayout.jesus", source)
        self.assertIn("campfireLayout.fire", source)
        self.assertIn("flipX: seat.flipX", source)
        self.assertIn("flipX: !current.flipX", source)
        self.assertIn("좌우 반전 (F)", source)
        self.assertIn("flipX={position.flipX}", source)
        self.assertIn("setElementVisibility", source)
        self.assertIn("setElementPose", source)
        self.assertIn("장면 요소 목록", source)
        self.assertIn("+ 추가", source)
        self.assertIn("빼기", source)
        self.assertIn("poseOptionsForPage", source)
        self.assertIn("참조 슬라이드", source)
        self.assertIn("PPT 슬라이드는 ⌘V로 붙여넣고", source)
        self.assertIn("referenceBackgroundVisible", source)
        self.assertIn("참조 숨기기", source)
        self.assertIn("기본 캔버스는 투명함", source)
        self.assertIn("saveReferenceBackground", source)
        self.assertIn("deleteReferenceBackground", source)
        self.assertIn("window.localStorage.setItem", source)

        poses = (FRONTEND / "src" / "retreat" / "scenePoses.ts").read_text()
        self.assertIn("ALL_POSE_IDS", poses)
        self.assertIn("'back',", poses)
        self.assertNotIn("POSES_BY_PAGE", poses)

    def test_every_scene_uses_three_exact_seven_group_rounds(self):
        source = (FRONTEND / "src" / "pages" / "AllCharactersPage.tsx").read_text()
        self.assertIn(
            "const activeSceneGroups = groupsForScene(groups, activeGroupScene);",
            source,
        )
        self.assertIn(
            "const lineupGroups = displayMode === 'campfire' ? [] : activeSceneGroups;",
            source,
        )
        self.assertIn(
            "const campfireGroups = displayMode === 'campfire' ? activeSceneGroups : [];",
            source,
        )
        self.assertIn("GROUP_SCENES.map(({ groupStart, groupCount })", source)
        self.assertIn("group.groupNumber >= firstGroupNumber", source)
        self.assertIn("group.groupNumber <= lastGroupNumber", source)
        self.assertIn("(groupNumber - 1) % GROUPS_PER_SCENE", source)

    def test_legacy_atlas_falls_back_while_v6_and_v7_keep_their_frame_maps(self):
        source = (FRONTEND / "src" / "retreat" / "RetreatCharacter.tsx").read_text()
        self.assertIn("fixed-peter-master-edit-v5", source)
        self.assertIn("fixed-peter-master-edit-v6", source)
        self.assertIn("fixed-peter-master-edit-v7", source)
        self.assertIn("supportsCampfirePoses", source)
        self.assertIn("supportsExpandedMaster", source)
        self.assertIn("needsCampfireFrames", source)
        self.assertIn("EXPANDED_MASTER_URL", source)
        self.assertIn("pose.currentFrames", source)
        self.assertIn("pose.expandedFrames", source)


if __name__ == "__main__":
    unittest.main()
