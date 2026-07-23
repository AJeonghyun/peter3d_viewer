import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"


class ObsTransparencyTests(unittest.TestCase):
    def test_display_mode_supports_obs_and_explicit_transparent_queries(self):
        source = (FRONTEND / "src" / "retreat" / "displayMode.ts").read_text()
        self.assertIn("params.get('obs') === '1'", source)
        self.assertIn("'transparent'", source)
        self.assertIn("params.has('background')", source)

    def test_legacy_transparency_setting_remains_available_for_existing_scenes(self):
        types = (FRONTEND / "src" / "retreat" / "types.ts").read_text()
        defaults = (FRONTEND / "src" / "retreat" / "defaults.ts").read_text()
        display_mode = (FRONTEND / "src" / "retreat" / "displayMode.ts").read_text()
        self.assertIn("transparentBackground: boolean", types)
        self.assertIn("transparentBackground: false", defaults)
        self.assertIn("transparentBackground: boolean", display_mode)

    def test_display_page_background_layers_are_removed_in_transparent_mode(self):
        world_css = (FRONTEND / "src" / "styles" / "retreat-world.css").read_text()

        self.assertIn('html[data-background-mode="transparent"]', world_css)
        self.assertIn("background: transparent !important", world_css)
        self.assertIn("display: none", world_css)
        self.assertIn(".retreat-parade__sand", world_css)
        self.assertIn(":root", world_css)
        self.assertIn("background: transparent", world_css)

    def test_provider_applies_mode_to_the_document_root(self):
        provider = (FRONTEND / "src" / "retreat" / "RetreatProvider.tsx").read_text()
        base_css = (FRONTEND / "src" / "styles" / "retreat.css").read_text()
        self.assertIn("root.dataset.backgroundMode", provider)
        self.assertIn("root.dataset.obs", provider)
        self.assertIn('html[data-background-mode="transparent"] #root', base_css)

        source = (FRONTEND / "src" / "pages" / "AllCharactersPage.tsx").read_text()
        self.assertIn('data-obs="true"', source)
        self.assertIn('data-background-mode="transparent"', source)
        self.assertNotIn('className="retreat-parade__sky"', source)
        self.assertNotIn('className="retreat-parade__sea"', source)
        self.assertNotIn('className="retreat-parade__sand"', source)


if __name__ == "__main__":
    unittest.main()
