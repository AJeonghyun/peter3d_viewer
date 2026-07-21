import importlib.util
import json
import sys
import unittest
from pathlib import Path

from PIL import Image, ImageChops


ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = ROOT / "scripts" / "apply_garment_design.py"
ASSET_ROOT = ROOT / "frontend" / "public" / "assets" / "peter-garment-demo"

SPEC = importlib.util.spec_from_file_location("apply_garment_design", SCRIPT_PATH)
assert SPEC and SPEC.loader
garment_transfer = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = garment_transfer
SPEC.loader.exec_module(garment_transfer)


class GarmentTransferTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.master = Image.open(ASSET_ROOT / "peter-master.png").convert("RGBA")
        cls.themed = Image.open(ASSET_ROOT / "themed-master.png").convert("RGBA")

    def test_transfer_preserves_master_silhouette(self):
        self.assertEqual(self.master.size, self.themed.size)
        self.assertIsNone(
            ImageChops.difference(
                self.master.getchannel("A"),
                self.themed.getchannel("A"),
            ).getbbox()
        )

    def test_transfer_changes_only_light_garment_pixels(self):
        changed = 0
        unexpected = 0
        for source, output in zip(self.master.getdata(), self.themed.getdata()):
            if source == output:
                continue
            changed += 1
            if garment_transfer.is_garment(source) <= 0:
                unexpected += 1
        self.assertGreater(changed, 50_000)
        self.assertEqual(unexpected, 0)

    def test_manifest_contains_all_master_frames_and_safe_margins(self):
        manifest = json.loads(
            (ASSET_ROOT / "frames" / "manifest.json").read_text(encoding="utf-8")
        )
        self.assertEqual(manifest["contract"], "fixed-peter-garment-transfer-v1")
        self.assertEqual(manifest["grid"], [5, 5])
        self.assertEqual(len(manifest["frames"]), 25)
        self.assertEqual(manifest["animations"]["walk"]["frameCount"], 8)
        self.assertEqual(manifest["animations"]["run"]["frameCount"], 8)
        for frame in manifest["frames"].values():
            left, top, right, bottom = frame["alphaBBox"]
            self.assertGreaterEqual(left, 0)
            self.assertGreaterEqual(top, 40)
            self.assertLessEqual(right, 300)
            self.assertLessEqual(bottom, 332)


if __name__ == "__main__":
    unittest.main()
