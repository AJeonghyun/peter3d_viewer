import json
import math
import unittest
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
CELL_SIZE = 360
SEATED_FRAME_INDEXES = {19, 21, 23}


def is_skin_pixel(pixel: tuple[int, int, int, int]) -> bool:
    red, green, blue, alpha = pixel
    return (
        alpha > 100
        and red > 190
        and red > green * 1.12
        and green > 70
        and blue > 60
    )


def significant_alpha_components(image: Image.Image) -> list[int]:
    alpha = image.getchannel("A")
    pixels = alpha.load()
    width, height = image.size
    seen = bytearray(width * height)
    sizes: list[int] = []
    for y in range(height):
        for x in range(width):
            offset = y * width + x
            if seen[offset] or pixels[x, y] <= 80:
                continue
            stack = [(x, y)]
            seen[offset] = 1
            size = 0
            while stack:
                current_x, current_y = stack.pop()
                size += 1
                for next_x, next_y in (
                    (current_x - 1, current_y),
                    (current_x + 1, current_y),
                    (current_x, current_y - 1),
                    (current_x, current_y + 1),
                ):
                    if not (0 <= next_x < width and 0 <= next_y < height):
                        continue
                    next_offset = next_y * width + next_x
                    if seen[next_offset] or pixels[next_x, next_y] <= 80:
                        continue
                    seen[next_offset] = 1
                    stack.append((next_x, next_y))
            if size > 1_000:
                sizes.append(size)
    return sizes


def upper_skin_components(image: Image.Image) -> list[tuple[int, float, float]]:
    width = image.width
    height = min(190, image.height)
    pixels = image.load()
    seen = bytearray(width * height)
    components: list[tuple[int, float, float]] = []
    for y in range(height):
        for x in range(width):
            offset = y * width + x
            if seen[offset] or not is_skin_pixel(pixels[x, y]):
                continue
            stack = [(x, y)]
            seen[offset] = 1
            points: list[tuple[int, int]] = []
            while stack:
                current_x, current_y = stack.pop()
                points.append((current_x, current_y))
                for next_x, next_y in (
                    (current_x - 1, current_y),
                    (current_x + 1, current_y),
                    (current_x, current_y - 1),
                    (current_x, current_y + 1),
                ):
                    if not (0 <= next_x < width and 0 <= next_y < height):
                        continue
                    next_offset = next_y * width + next_x
                    if seen[next_offset] or not is_skin_pixel(pixels[next_x, next_y]):
                        continue
                    seen[next_offset] = 1
                    stack.append((next_x, next_y))
            if len(points) > 100:
                components.append((
                    len(points),
                    sum(point_x for point_x, _ in points) / len(points),
                    sum(point_y for _, point_y in points) / len(points),
                ))
    return components


def raised_sleeve_angle(image: Image.Image) -> float:
    """Estimate the raised sleeve axis without depending on character scale."""
    pixels = image.load()
    points: list[tuple[float, float]] = []
    for y in range(round(image.height * 0.64)):
        for x in range(round(image.width * 0.54), image.width):
            red, green, blue, alpha = pixels[x, y]
            if alpha > 200 and red > 225 and green > 225 and blue > 225:
                points.append((float(x), float(-y)))
    if len(points) < 500:
        raise AssertionError("raised sleeve could not be measured")
    mean_x = sum(x for x, _ in points) / len(points)
    mean_y = sum(y for _, y in points) / len(points)
    variance_x = sum((x - mean_x) ** 2 for x, _ in points) / len(points)
    variance_y = sum((y - mean_y) ** 2 for _, y in points) / len(points)
    covariance = sum(
        (x - mean_x) * (y - mean_y) for x, y in points
    ) / len(points)
    angle = math.degrees(
        0.5 * math.atan2(2 * covariance, variance_x - variance_y)
    )
    return angle + 180 if angle < 0 else angle


class Page3CampfireAssetTests(unittest.TestCase):
    def assert_wave_keeps_raised_hand_on_right(self, master: Image.Image):
        hand_centers: list[tuple[float, float]] = []
        for index in range(2, 13):
            frame = master.crop((
                (index % 8) * CELL_SIZE,
                (index // 8) * CELL_SIZE,
                (index % 8 + 1) * CELL_SIZE,
                (index // 8 + 1) * CELL_SIZE,
            ))
            self.assertEqual(
                len(significant_alpha_components(frame)),
                1,
                f"wave frame {index + 1} must be one connected character",
            )
            bounds = frame.getchannel("A").getbbox()
            self.assertIsNotNone(bounds)
            assert bounds is not None
            self.assertGreaterEqual(min(bounds[0], bounds[1]), 18)
            self.assertLessEqual(max(bounds[2], bounds[3]), CELL_SIZE - 18)
            raised_hand_size, raised_hand_x, raised_hand_y = max(
                upper_skin_components(frame),
                key=lambda component: component[1],
            )
            self.assertGreater(raised_hand_size, 300, f"wave frame {index + 1}")
            self.assertGreater(raised_hand_x, 200, f"wave frame {index + 1}")
            if index < 6:
                hand_centers.append((raised_hand_x, raised_hand_y))
        hand_travel = max(x for x, _ in hand_centers) - min(x for x, _ in hand_centers)
        self.assertGreater(hand_travel, 5)
        self.assertLess(hand_travel, 35)

    def test_wave_sources_keep_motion_within_fourteen_degrees(self):
        runtime_dir = ROOT / "runtime-assets"
        angle_deltas: list[float] = []
        for filename in (
            "peter-wave-one-hand-v9-14deg-transparent.png",
            "jesus-wave-one-hand-v5-14deg-transparent.png",
        ):
            with self.subTest(filename=filename), Image.open(runtime_dir / filename) as source:
                image = source.convert("RGBA")
                self.assertEqual(len(significant_alpha_components(image)), 2)
                midpoint = image.width // 2
                actors: list[Image.Image] = []
                for half in (
                    image.crop((0, 0, midpoint, image.height)),
                    image.crop((midpoint, 0, image.width, image.height)),
                ):
                    bounds = half.getchannel("A").getbbox()
                    self.assertIsNotNone(bounds)
                    assert bounds is not None
                    actors.append(half.crop(bounds))
                angles = tuple(raised_sleeve_angle(actor) for actor in actors)
                angle_delta = abs(angles[1] - angles[0])
                self.assertGreater(angle_delta, 3)
                self.assertLessEqual(angle_delta, 14)
                angle_deltas.append(angle_delta)
                partially_transparent = 0
                green_spill = 0
                for red, green, blue, alpha in image.getdata():
                    if 0 < alpha < 255:
                        partially_transparent += 1
                    if alpha > 0 and green > max(red, blue) + 8:
                        green_spill += 1
                self.assertLess(partially_transparent, 20_000)
                self.assertLess(green_spill, 900)
                for point in (
                    (0, 0),
                    (image.width - 1, 0),
                    (0, image.height - 1),
                    (image.width - 1, image.height - 1),
                ):
                    self.assertEqual(image.getpixel(point)[3], 0)

        self.assertLessEqual(abs(angle_deltas[0] - angle_deltas[1]), 4)

        builder = (ROOT / "scripts" / "build_expanded_retreat_master.py").read_text()
        self.assertNotIn(".rotate(", builder)
        self.assertNotIn("ImageDraw", builder)
        self.assertIn("wave_poses", builder)

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
        self.assertEqual(manifest["animations"]["wave"], [2, 3])
        self.assertFalse(any("walk" in frame_id or "run" in frame_id for frame_id in frame_ids))
        with Image.open(runtime_dir / "peter-retreat-master-expanded-v7.png") as source:
            master = source.convert("RGBA")
            self.assertEqual(master.size, (CELL_SIZE * 8, CELL_SIZE * 4))
            self.assert_wave_keeps_raised_hand_on_right(master)
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
        self.assertEqual(manifest["animations"]["wave"], [2, 3])
        self.assertEqual(manifest["editor_poses"]["listen-back"], 30)
        with Image.open(asset_dir / "jesus-retreat-master-v1.png") as source:
            master = source.convert("RGBA")
            self.assertEqual(master.size, (CELL_SIZE * 8, CELL_SIZE * 4))
            self.assertEqual(master.getpixel((0, 0))[3], 0)
            self.assert_wave_keeps_raised_hand_on_right(master)

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
        persistence = (FRONTEND / "src" / "retreat" / "persistence.ts").read_text()
        self.assertIn("peter-page3-stand-layout-v3", source)
        self.assertIn("peter-page3-back-layout-v2", source)
        self.assertIn("peter-page3-campfire-layout-v1", source)
        self.assertIn("peter-page3-seating-layout-v1", source)
        self.assertIn("defaultSeatingLayout", source)
        self.assertIn("retreat-parade__seating-chart", source)
        self.assertIn("const sidebarGroups = displayMode === 'awards'", source)
        self.assertIn("displayMode === 'seating'\n      ? groups", source)
        self.assertIn("오른쪽 회전 ↻", source)
        self.assertIn("왼쪽 회전 ↺", source)
        self.assertIn("rotation: normalizeRotation(next.rotation)", source)
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
        self.assertIn("이미지/GIF 오브젝트 추가", source)
        self.assertIn("accept=\"image/png,image/jpeg,image/webp,image/gif\"", source)
        self.assertIn("multiple", source)
        self.assertIn("uploadSharedSceneMedia", source)
        self.assertIn("deleteSharedSceneMedia", source)
        self.assertIn("loadSharedScene", source)
        self.assertIn("saveSharedSceneLayout", source)
        self.assertIn("window.setInterval(() => void syncScene(), 2_500)", source)
        self.assertIn("retreat-parade__scene-media-object", source)
        self.assertIn("setElementVisibility(mediaKey", source)
        self.assertIn("SCENE_MEDIA_STORE_NAME", persistence)
        self.assertIn("loadSceneMediaMetadata", persistence)
        self.assertIn("saveSceneMediaMetadata", persistence)
        self.assertIn("window.localStorage.setItem", source)

        sync = (FRONTEND / "src" / "retreat" / "sceneSync.ts").read_text()
        self.assertIn("/retreat-scenes/${scene}", sync)
        self.assertIn("method: 'PUT'", sync)
        self.assertIn("method: 'DELETE'", sync)

        poses = (FRONTEND / "src" / "retreat" / "scenePoses.ts").read_text()
        self.assertIn("ALL_POSE_IDS", poses)
        self.assertIn("'back',", poses)
        self.assertIn("currentFrames: [2, 3]", poses)
        self.assertNotIn("POSES_BY_PAGE", poses)

        animator = (FRONTEND / "src" / "retreat" / "AtlasSpriteAnimator.tsx").read_text()
        self.assertIn("wave: [2, 3]", animator)
        self.assertIn("if (animation === 'wave') return 340", animator)

        provider = (FRONTEND / "src" / "retreat" / "RetreatProvider.tsx").read_text()
        self.assertIn("candidate.currentPage === 'seating'", provider)

    def test_awards_scene_and_home_navigator_are_wired(self):
        app = (FRONTEND / "src" / "App.tsx").read_text()
        source = (FRONTEND / "src" / "pages" / "AllCharactersPage.tsx").read_text()
        styles = (FRONTEND / "src" / "styles" / "retreat-world.css").read_text()
        home = (FRONTEND / "src" / "pages" / "HomePage.tsx").read_text()
        home_styles = (FRONTEND / "src" / "styles" / "home.css").read_text()

        self.assertIn("/display/awards", app)
        self.assertNotIn("defaultAwardsLayout", source)
        self.assertNotIn("retreat-parade__awards-stage", source)
        self.assertNotIn("retreat-parade__award-recipient", styles)
        self.assertIn(
            "mode === 'awards' && key !== 'trophy' && !isSceneMediaKey(key)",
            source,
        )
        self.assertIn("setSceneMedia([]);", source)
        self.assertIn("setSceneMedia(snapshot.media)", source)
        self.assertNotIn("displayMode === 'awards' ? [] : sceneMedia", source)
        self.assertNotIn("displayMode !== 'awards' && sceneMedia.length > 0", source)
        self.assertIn("{sceneMedia.length > 0 ? (", source)
        self.assertIn("이미지/GIF 오브젝트 추가", source)
        self.assertIn("displayMode === 'awards' ? 'trophy' : 'group-1'", source)
        self.assertIn("PPT 위에 겹쳐 띄우는 회전 트로피", source)
        self.assertIn("사이드바 닫기", source)
        self.assertIn("/display/awards", home)
        self.assertIn("/editor/awards", home)
        self.assertIn("PPT 위에 회전 트로피만 투명하게", home)
        self.assertEqual(home.count("displayPath: '/display/"), 5)
        self.assertIn('aria-label="운영 도구"', home)
        self.assertIn("장면을 선택하세요.", home)
        self.assertNotIn("data-featured", home)
        self.assertIn("grid-template-columns: repeat(5, minmax(0, 1fr));", home_styles)

    def test_obsolete_editor_and_seating_admin_pages_are_removed(self):
        app = (FRONTEND / "src" / "App.tsx").read_text()
        home = (FRONTEND / "src" / "pages" / "HomePage.tsx").read_text()
        pages = {path.name for path in (FRONTEND / "src" / "pages").glob("*.tsx")}
        styles = {path.name for path in (FRONTEND / "src" / "styles").glob("*.css")}
        libraries = {path.name for path in (FRONTEND / "src" / "lib").glob("*.ts")}
        retreat_components = {
            path.name for path in (FRONTEND / "src" / "retreat").glob("*.tsx")
        }

        self.assertNotIn("'admin-seating'", app)
        self.assertNotIn("SeatingAdminPage", app)
        self.assertNotIn("EditorPage", app)
        self.assertNotIn('href="/editor"', home)
        self.assertNotIn('href="/admin/seating"', home)
        self.assertNotIn("EditorPage.tsx", pages)
        self.assertNotIn("SeatingAdminPage.tsx", pages)
        self.assertNotIn("retreat-editor.css", styles)
        self.assertNotIn("retreat-seating-admin.css", styles)
        self.assertNotIn("seatingPresets.ts", libraries)
        self.assertNotIn("RetreatDisplay.tsx", retreat_components)

        for scene in ("stand", "back", "campfire", "seating", "awards"):
            self.assertIn(f"/editor/{scene}", app)
            self.assertIn(f"/editor/{scene}", home)

    def test_performance_scenes_keep_rounds_while_seating_shows_all_groups(self):
        source = (FRONTEND / "src" / "pages" / "AllCharactersPage.tsx").read_text()
        self.assertIn(
            "? groups\n    : groupsForScene(groups, activeGroupScene);",
            source,
        )
        self.assertIn(
            "const lineupGroups = displayMode === 'stand' || displayMode === 'back' ? activeSceneGroups : [];",
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
        self.assertIn("const seatingGroups = displayMode === 'seating' ? groups : [];", source)

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
