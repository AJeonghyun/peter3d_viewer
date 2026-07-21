import unittest
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
CELL_SIZE = 360
SEATED_FRAME_INDEXES = {19, 21, 23}


class Page3CampfireAssetTests(unittest.TestCase):
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

    def test_page_three_replaces_boats_with_user_selected_scene_loops(self):
        source = (FRONTEND / "src" / "pages" / "AllCharactersPage.tsx").read_text()
        styles = (FRONTEND / "src" / "styles" / "retreat-world.css").read_text()
        self.assertNotIn("type: 'boat'", source)
        self.assertNotIn("retreat-parade__boat", source)
        self.assertEqual(
            source.count("{ type: 'campfire', duration: CAMPFIRE_DURATION, groupStart:"),
            3,
        )
        self.assertIn("peter-page3-display-mode-v1", source)
        self.assertIn("WALK_SCENES", source)
        self.assertIn("CAMPFIRE_SCENES", source)
        self.assertNotIn("PARADE_SCENES", source)
        self.assertIn("걷기만 보여주기", source)
        self.assertIn("모닥불만 보여주기", source)
        self.assertIn("get('scene')", source)
        self.assertIn("CAMPFIRE_SEATS", source)
        self.assertIn("campfire-sheet.png", source)
        self.assertNotIn("말씀을 듣는 밤", source)
        self.assertNotIn("retreat-parade__scene-label", styles)
        self.assertNotIn("type: 'wipe'", source)
        self.assertNotIn("retreat-parade__wipe", source)
        self.assertNotIn("retreat-wave-wipe", styles)

    def test_page_three_layout_editor_persists_each_group_and_prop(self):
        source = (FRONTEND / "src" / "pages" / "AllCharactersPage.tsx").read_text()
        self.assertIn("peter-page3-campfire-layout-v1", source)
        self.assertIn("data-layout-edit", source)
        self.assertIn("group-${group.groupNumber}", source)
        self.assertIn("campfireLayout.jesus", source)
        self.assertIn("campfireLayout.fire", source)
        self.assertIn("flipX: seat.flipX", source)
        self.assertIn("flipX: !current.flipX", source)
        self.assertIn("좌우 반전 (F)", source)
        self.assertIn("flipX={position.flipX}", source)
        self.assertIn("window.localStorage.setItem", source)

    def test_legacy_custom_atlas_falls_back_to_the_new_campfire_master(self):
        source = (FRONTEND / "src" / "retreat" / "RetreatCharacter.tsx").read_text()
        self.assertIn("fixed-peter-master-edit-v5", source)
        self.assertIn("supportsCampfirePoses", source)
        self.assertIn("fixedFrame === undefined", source)
        self.assertIn("FIXED_MASTER_URL", source)


if __name__ == "__main__":
    unittest.main()
