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
        self.assertIn("url.searchParams.set('obs', '1')", source)

    def test_transparency_is_saved_as_an_editor_setting_but_defaults_off(self):
        types = (FRONTEND / "src" / "retreat" / "types.ts").read_text()
        defaults = (FRONTEND / "src" / "retreat" / "defaults.ts").read_text()
        editor = (FRONTEND / "src" / "pages" / "EditorPage.tsx").read_text()
        self.assertIn("transparentBackground: boolean", types)
        self.assertIn("transparentBackground: false", defaults)
        self.assertIn("모든 송출 페이지 배경 투명", editor)
        self.assertGreaterEqual(editor.count("OBS URL 복사"), 1)
        self.assertIn("buildObsDisplayUrl", editor)

    def test_all_three_page_background_layers_are_removed_in_transparent_mode(self):
        group_css = (FRONTEND / "src" / "styles" / "retreat-group.css").read_text()
        notice_css = (FRONTEND / "src" / "styles" / "retreat-notice.css").read_text()
        world_css = (FRONTEND / "src" / "styles" / "retreat-world.css").read_text()

        for stylesheet in (group_css, notice_css, world_css):
            self.assertIn('html[data-background-mode="transparent"]', stylesheet)
            self.assertIn("background: transparent !important", stylesheet)
            self.assertIn("display: none", stylesheet)

        self.assertIn(".retreat-group-stage__shore", group_css)
        self.assertIn(".retreat-notice-scene__shore", notice_css)
        self.assertIn(".retreat-parade__sand", world_css)

    def test_provider_applies_mode_to_the_document_root(self):
        provider = (FRONTEND / "src" / "retreat" / "RetreatProvider.tsx").read_text()
        shell = (FRONTEND / "src" / "retreat" / "RetreatDisplay.tsx").read_text()
        base_css = (FRONTEND / "src" / "styles" / "retreat.css").read_text()
        self.assertIn("root.dataset.backgroundMode", provider)
        self.assertIn("root.dataset.obs", provider)
        self.assertIn("data-background-mode={displayMode.backgroundMode}", shell)
        self.assertIn('html[data-background-mode="transparent"] #root', base_css)

        for page in ("GroupLayoutPage.tsx", "NoticePage.tsx", "AllCharactersPage.tsx"):
            source = (FRONTEND / "src" / "pages" / page).read_text()
            self.assertIn("data-obs={backgroundDisplayMode.obsMode", source)
            self.assertIn(
                "data-background-mode={backgroundDisplayMode.backgroundMode}",
                source,
            )


if __name__ == "__main__":
    unittest.main()
