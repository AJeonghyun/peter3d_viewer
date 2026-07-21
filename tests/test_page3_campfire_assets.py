import unittest
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
CELL_SIZE = 360
SEATED_FRAME_INDEXES = {19, 21, 23}


class Page3CampfireAssetTests(unittest.TestCase):
    def test_standing_jesus_front_and_back_assets_are_transparent_and_complete(self):
        asset_dir = FRONTEND / "public" / "assets" / "campfire"
        for filename in ("jesus-standing-front.png", "jesus-standing-back.png"):
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
            source.count("{ duration: CAMPFIRE_DURATION, groupStart:"),
            3,
        )
        self.assertIn("peter-page3-display-mode-v1", source)
        self.assertIn("CAMPFIRE_SCENES", source)
        self.assertIn("get('scene')", source)
        self.assertIn("CAMPFIRE_SEATS", source)
        self.assertIn("campfire-sheet.png", source)
        self.assertIn("jesus-standing-front.png", source)
        self.assertIn("jesus-standing-back.png", source)
        self.assertIn("view={displayMode === 'back' ? 'back' : 'front'}", source)
        self.assertNotIn("retreat-parade__nameplate", source)
        self.assertNotIn("retreat-parade__nameplate", styles)
        self.assertNotIn("retreat-parade__scene-label", styles)

    def test_page_three_layout_editor_persists_each_group_and_prop(self):
        source = (FRONTEND / "src" / "pages" / "AllCharactersPage.tsx").read_text()
        self.assertIn("peter-page3-stand-layout-v2", source)
        self.assertIn("peter-page3-back-layout-v1", source)
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
