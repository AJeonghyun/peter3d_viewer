"""OBS's embedded Chromium predates container-query units, dvh, and the
individual translate/scale properties. Every display-page declaration that
uses those features must keep a viewport-unit (or transform) fallback so the
projector output renders identically inside an OBS browser source."""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STYLES = ROOT / "frontend" / "src" / "styles"
DISPLAY_SHEETS = (
    STYLES / "retreat-group.css",
    STYLES / "retreat-notice.css",
    STYLES / "retreat-world.css",
)

DECLARATION = re.compile(
    r"(?P<indent>[ \t]*)(?P<prop>[a-z][a-z-]*)(?P<sep>\s*:\s*)"
    r"(?P<value>[^;{}]*?(?:cqw|cqh|dvh)[^;{}]*?);",
    re.DOTALL,
)


def viewport_fallback(value: str) -> str:
    return value.replace("cqw", "vw").replace("cqh", "vh").replace("dvh", "vh")


class ObsCssFallbackTests(unittest.TestCase):
    def test_every_container_unit_declaration_keeps_a_viewport_fallback(self):
        for sheet in DISPLAY_SHEETS:
            source = sheet.read_text(encoding="utf-8")
            for match in DECLARATION.finditer(source):
                fallback = (
                    f"{match.group('prop')}{match.group('sep')}"
                    f"{viewport_fallback(match.group('value'))};"
                )
                self.assertIn(
                    fallback,
                    source,
                    f"{sheet.name}: `{match.group('prop')}: "
                    f"{match.group('value')}`에 vw/vh 폴백이 없습니다",
                )

    def test_group_stage_box_keeps_a_vh_fallback(self):
        source = (STYLES / "retreat-group.css").read_text(encoding="utf-8")
        self.assertIn("min(100%, calc(100vh * 16 / 9))", source)

    def test_atlas_sprite_frame_avoids_translate_and_scale_properties(self):
        source = (STYLES / "retreat.css").read_text(encoding="utf-8")
        self.assertNotRegex(source, r"^\s*translate\s*:", "translate 속성은 CEF 미지원")
        self.assertNotRegex(source, r"^\s*scale\s*:")
        self.assertIn(
            "transform: translateX(-50%) scale(var(--atlas-display-scale, 1));",
            source,
        )
        self.assertIn("aspect-ratio: 1 / 1;", source)

    def test_world_sheet_avoids_individual_scale_and_translate_properties(self):
        source = (STYLES / "retreat-world.css").read_text(encoding="utf-8")
        self.assertNotRegex(source, r"(?m)^\s*scale\s*:")
        self.assertNotRegex(source, r"(?m)^\s*translate\s*:")

    def test_page3_inline_styles_use_stage_unit_helpers(self):
        page = (ROOT / "frontend" / "src" / "pages" / "AllCharactersPage.tsx").read_text(
            encoding="utf-8"
        )
        self.assertNotIn("cqw`", page)
        self.assertNotIn("cqh`", page)
        self.assertIn("STAGE_UNIT_X", page)
        self.assertIn("STAGE_UNIT_Y", page)


if __name__ == "__main__":
    unittest.main()
