import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent as ReactChangeEvent,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { AnimationName } from '../spriteLab/types';
import { RetreatCharacter } from '../retreat/RetreatCharacter';
import { useRetreat } from '../retreat/RetreatProvider';
import {
  RETREAT_POSES,
  defaultPoseForPage,
  isRetreatPoseId,
  poseForCampfireFrame,
  poseOptionsForPage,
  type RetreatPoseId,
} from '../retreat/scenePoses';
import { STAGE_UNIT_X, STAGE_UNIT_Y } from '../retreat/displayMode';
import {
  deleteReferenceBackground,
  loadReferenceBackground,
  saveReferenceBackground,
} from '../retreat/persistence';
import type { RetreatGroup, RetreatPage } from '../retreat/types';
import '../styles/retreat-world.css';

interface AllCharactersPageProps {
  preview?: boolean;
  scene?: RetreatPage;
}

type DisplayMode = RetreatPage;

interface GroupTimelineScene {
  duration: number;
  groupStart: number;
  groupCount: number;
}

const GROUP_SCENE_DURATION = 14_000;
const GROUPS_PER_SCENE = 7;
const START_OFFSET = 2_400;
const TEAM_COUNT = 21;
const REACTION_ACTIONS = ['wave'] as const satisfies readonly AnimationName[];
const REACTION_HOLD_MS = 950;
const REACTION_MIN_GAP_MS = 1_600;
const REACTION_MAX_GAP_MS = 3_400;
const STAND_LAYOUT_STORAGE_KEY = 'peter-page3-stand-layout-v3';
const BACK_LAYOUT_STORAGE_KEY = 'peter-page3-back-layout-v2';
const CAMPFIRE_LAYOUT_STORAGE_KEY = 'peter-page3-campfire-layout-v1';
const DISPLAY_MODE_STORAGE_KEY = 'peter-page3-display-mode-v1';
const MAX_REFERENCE_BACKGROUND_BYTES = 30 * 1024 * 1024;

const GROUP_SCENES: readonly GroupTimelineScene[] = [
  { duration: GROUP_SCENE_DURATION, groupStart: 0, groupCount: GROUPS_PER_SCENE },
  { duration: GROUP_SCENE_DURATION, groupStart: 7, groupCount: GROUPS_PER_SCENE },
  { duration: GROUP_SCENE_DURATION, groupStart: 14, groupCount: GROUPS_PER_SCENE },
];

const CAMPFIRE_SEATS = [
  { x: 40, bottom: 32, scale: 0.84, fixedFrame: 21, flipX: false, depth: 'rear' },
  { x: 60, bottom: 32, scale: 0.84, fixedFrame: 21, flipX: true, depth: 'rear' },
  { x: 31, bottom: 20, scale: 0.92, fixedFrame: 23, flipX: false, depth: 'middle' },
  { x: 69, bottom: 20, scale: 0.92, fixedFrame: 23, flipX: true, depth: 'middle' },
  { x: 38, bottom: 5, scale: 1.02, fixedFrame: 19, flipX: false, depth: 'front' },
  { x: 50, bottom: 3, scale: 1.06, fixedFrame: 19, flipX: false, depth: 'front' },
  { x: 62, bottom: 5, scale: 1.02, fixedFrame: 19, flipX: true, depth: 'front' },
] as const;

interface ScenePosition {
  x: number;
  bottom: number;
  scale: number;
  flipX: boolean;
  visible: boolean;
  poseId: RetreatPoseId;
}

type SceneLayout = Record<string, ScenePosition>;

interface DragState {
  key: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startPosition: ScenePosition;
}

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

// Stand/back scenes show one seven-group cohort at a time. Every cohort shares
// the same eight slots so all three rounds have a balanced, readable lineup.
function defaultLineupLayout(mode: 'stand' | 'back' = 'stand'): SceneLayout {
  const lineupSlots = GROUPS_PER_SCENE + 1;
  const jesusSlot = 4;
  const xForSlot = (slot: number) => 6 + (slot / (lineupSlots - 1)) * 88;
  const layout: SceneLayout = {
    jesus: {
      x: xForSlot(jesusSlot),
      bottom: 2.5,
      scale: 1,
      flipX: false,
      visible: true,
      poseId: defaultPoseForPage(mode),
    },
  };
  for (let groupNumber = 1; groupNumber <= TEAM_COUNT; groupNumber += 1) {
    const cohortIndex = (groupNumber - 1) % GROUPS_PER_SCENE;
    const slot = cohortIndex < jesusSlot ? cohortIndex : cohortIndex + 1;
    layout[`group-${groupNumber}`] = {
      x: xForSlot(slot),
      bottom: 2.5,
      scale: 1,
      flipX: false,
      visible: true,
      poseId: defaultPoseForPage(mode),
    };
  }
  return layout;
}

function defaultCampfireLayout(): SceneLayout {
  const layout: SceneLayout = {
    jesus: {
      x: 50,
      bottom: 31,
      scale: 1,
      flipX: false,
      visible: true,
      poseId: 'listen-front',
    },
    fire: {
      x: 50,
      bottom: 18,
      scale: 1,
      flipX: false,
      visible: true,
      poseId: 'listen-front',
    },
  };
  for (let groupNumber = 1; groupNumber <= TEAM_COUNT; groupNumber += 1) {
    const seat = CAMPFIRE_SEATS[(groupNumber - 1) % CAMPFIRE_SEATS.length];
    layout[`group-${groupNumber}`] = {
      x: seat.x,
      bottom: seat.bottom,
      scale: seat.scale,
      flipX: seat.flipX,
      visible: true,
      poseId: poseForCampfireFrame(seat.fixedFrame),
    };
  }
  return layout;
}

function defaultLayoutFor(mode: DisplayMode): SceneLayout {
  return mode === 'campfire' ? defaultCampfireLayout() : defaultLineupLayout(mode);
}

function layoutStorageKey(mode: DisplayMode): string {
  if (mode === 'campfire') return CAMPFIRE_LAYOUT_STORAGE_KEY;
  return mode === 'back' ? BACK_LAYOUT_STORAGE_KEY : STAND_LAYOUT_STORAGE_KEY;
}

function referenceBackgroundKey(mode: DisplayMode): string {
  return `scene-reference-${mode}-v1`;
}

function isSupportedReferenceImage(file: File): boolean {
  return ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type);
}

function readLayout(mode: DisplayMode): SceneLayout {
  const defaults = defaultLayoutFor(mode);
  if (typeof window === 'undefined') return defaults;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(layoutStorageKey(mode)) ?? '{}',
    ) as SceneLayout;
    for (const [key, value] of Object.entries(parsed)) {
      if (
        value
        && Number.isFinite(value.x)
        && Number.isFinite(value.bottom)
        && Number.isFinite(value.scale)
      ) {
        defaults[key] = {
          x: clamp(value.x, 2, 98),
          bottom: clamp(value.bottom, -4, 70),
          scale: clamp(value.scale, 0.35, 1.8),
          flipX: typeof value.flipX === 'boolean'
            ? value.flipX
            : defaults[key]?.flipX ?? false,
          visible: typeof value.visible === 'boolean'
            ? value.visible
            : defaults[key]?.visible ?? true,
          poseId: isRetreatPoseId(value.poseId)
            ? value.poseId
            : defaults[key]?.poseId ?? defaultPoseForPage(mode),
        };
      }
    }
  } catch {
    // Ignore malformed browser state and restore the safe defaults.
  }
  return defaults;
}

function readDisplayMode(): DisplayMode {
  if (typeof window === 'undefined') return 'stand';
  const pathname = window.location.pathname;
  if (
    pathname === '/display/campfire'
    || pathname === '/campfire'
    || pathname.startsWith('/editor/campfire')
  ) return 'campfire';
  if (
    pathname === '/display/back'
    || pathname === '/back'
    || pathname.startsWith('/editor/back')
  ) return 'back';
  if (
    pathname === '/display/stand'
    || pathname === '/stand'
    || pathname.startsWith('/editor/stand')
    // Legacy walk routes now resolve to the lineup scene.
    || pathname === '/display/walk'
    || pathname === '/walk'
  ) return 'stand';
  const requested = new URLSearchParams(window.location.search).get('scene');
  if (requested === 'stand' || requested === 'back' || requested === 'campfire') return requested;
  if (requested === 'walk') return 'stand';
  const saved = window.localStorage.getItem(DISPLAY_MODE_STORAGE_KEY);
  return saved === 'campfire' || saved === 'back' ? saved : 'stand';
}

function isLayoutRoute(): boolean {
  if (typeof window === 'undefined') return false;
  const pathname = window.location.pathname;
  return (
    pathname.startsWith('/editor/stand')
    || pathname.startsWith('/editor/back')
    || pathname.startsWith('/editor/campfire')
    || new URLSearchParams(window.location.search).get('layout') === '1'
  );
}

function editableLabel(key: string) {
  if (key === 'jesus') return '예수님';
  if (key === 'fire') return '모닥불';
  return `${key.replace('group-', '')}조 베드로`;
}

function locateGroupScene(time: number): GroupTimelineScene {
  let cursor = 0;
  for (const scene of GROUP_SCENES) {
    if (time < cursor + scene.duration) return scene;
    cursor += scene.duration;
  }
  return GROUP_SCENES[0];
}

function groupsForScene(groups: RetreatGroup[], scene: GroupTimelineScene): RetreatGroup[] {
  const firstGroupNumber = scene.groupStart + 1;
  const lastGroupNumber = scene.groupStart + scene.groupCount;
  return groups.filter((group) => (
    group.groupNumber >= firstGroupNumber && group.groupNumber <= lastGroupNumber
  ));
}

function useLoopClock(playing: boolean, cycleDuration: number) {
  const [time, setTime] = useState(START_OFFSET);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) return undefined;
    let previous = performance.now();
    let accumulated = 0;

    const tick = (now: number) => {
      accumulated += Math.min(now - previous, 80);
      previous = now;
      if (accumulated >= 32) {
        const step = accumulated;
        accumulated = 0;
        setTime((current) => (current + step) % cycleDuration);
      }
      frameRef.current = window.requestAnimationFrame(tick);
    };

    frameRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    };
  }, [cycleDuration, playing]);

  return time;
}

function nicknameFor(group: RetreatGroup) {
  const nickname = group.groupName.trim();
  return nickname || `${group.groupNumber}조`;
}

export function AllCharactersWorld({ preview = false, scene }: AllCharactersPageProps) {
  const { settings } = useRetreat();
  const worldRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const referenceBackgroundUrlRef = useRef('');
  const referenceBackgroundRevisionRef = useRef(0);
  const [layoutMode] = useState(() => !preview && isLayoutRoute());
  const [layoutGroupStart, setLayoutGroupStart] = useState(0);
  const [standLayout, setStandLayout] = useState(() => readLayout('stand'));
  const [backLayout, setBackLayout] = useState(() => readLayout('back'));
  const [campfireLayout, setCampfireLayout] = useState(() => readLayout('campfire'));
  const [displayMode, setDisplayMode] = useState<DisplayMode>(() => scene ?? readDisplayMode());
  const [selectedLayoutKey, setSelectedLayoutKey] = useState('group-1');
  const [localPaused, setLocalPaused] = useState(false);
  const [reaction, setReaction] = useState<{ groupNumber: number; action: AnimationName } | null>(null);
  const [referenceBackgroundUrl, setReferenceBackgroundUrl] = useState('');
  const [referenceBackgroundName, setReferenceBackgroundName] = useState('');
  const [referenceBackgroundError, setReferenceBackgroundError] = useState('');
  const [referenceBackgroundVisible, setReferenceBackgroundVisible] = useState(false);

  const playing = settings.animationPlaying && !localPaused;
  const groupsRotating = !layoutMode && playing;
  const clock = useLoopClock(
    groupsRotating,
    GROUP_SCENES.length * GROUP_SCENE_DURATION,
  );

  const groups = useMemo(
    () => [...settings.groups]
      .filter((group) => group.enabled)
      .sort((first, second) => first.groupNumber - second.groupNumber)
      .slice(0, TEAM_COUNT),
    [settings.groups],
  );

  const activeLayout = displayMode === 'campfire'
    ? campfireLayout
    : displayMode === 'back'
      ? backLayout
      : standLayout;
  const setActiveLayout = displayMode === 'campfire'
    ? setCampfireLayout
    : displayMode === 'back'
      ? setBackLayout
      : setStandLayout;

  const activeGroupScene = layoutMode
    ? {
        duration: GROUP_SCENE_DURATION,
        groupStart: layoutGroupStart,
        groupCount: GROUPS_PER_SCENE,
      }
    : locateGroupScene(clock);
  const activeSceneGroups = groupsForScene(groups, activeGroupScene);
  const campfireGroups = displayMode === 'campfire' ? activeSceneGroups : [];
  const lineupGroups = displayMode === 'campfire' ? [] : activeSceneGroups;

  useEffect(() => {
    if (scene) setDisplayMode(scene);
  }, [scene]);

  useEffect(() => {
    document.title = displayMode === 'campfire'
      ? '갈릴리 모닥불'
      : displayMode === 'back'
        ? '예수님과 베드로 뒷모습 라인업'
        : '예수님과 베드로 정면 라인업';
  }, [displayMode]);

  useEffect(() => {
    window.localStorage.setItem(STAND_LAYOUT_STORAGE_KEY, JSON.stringify(standLayout));
  }, [standLayout]);

  useEffect(() => {
    window.localStorage.setItem(BACK_LAYOUT_STORAGE_KEY, JSON.stringify(backLayout));
  }, [backLayout]);

  useEffect(() => {
    window.localStorage.setItem(CAMPFIRE_LAYOUT_STORAGE_KEY, JSON.stringify(campfireLayout));
  }, [campfireLayout]);

  useEffect(() => {
    window.localStorage.setItem(DISPLAY_MODE_STORAGE_KEY, displayMode);
  }, [displayMode]);

  const replaceReferenceBackgroundUrl = useCallback((file: File | null) => {
    if (referenceBackgroundUrlRef.current) {
      URL.revokeObjectURL(referenceBackgroundUrlRef.current);
      referenceBackgroundUrlRef.current = '';
    }
    const nextUrl = file ? URL.createObjectURL(file) : '';
    referenceBackgroundUrlRef.current = nextUrl;
    setReferenceBackgroundUrl(nextUrl);
    setReferenceBackgroundName(file?.name ?? '');
  }, []);

  const applyReferenceBackground = useCallback(async (file: File) => {
    if (!isSupportedReferenceImage(file)) {
      setReferenceBackgroundError('PNG, JPG, WEBP, GIF 이미지를 선택하거나 PPT 슬라이드를 복사해 붙여넣으세요.');
      return;
    }
    if (file.size > MAX_REFERENCE_BACKGROUND_BYTES) {
      setReferenceBackgroundError('참조 이미지는 30MB 이하만 사용할 수 있습니다.');
      return;
    }
    try {
      referenceBackgroundRevisionRef.current += 1;
      await saveReferenceBackground(referenceBackgroundKey(displayMode), file);
      replaceReferenceBackgroundUrl(file);
      setReferenceBackgroundVisible(true);
      setReferenceBackgroundError('');
    } catch (error) {
      console.warn('참조 배경을 저장하지 못했습니다.', error);
      setReferenceBackgroundError('참조 배경을 저장하지 못했습니다. 다시 시도하세요.');
    }
  }, [displayMode, replaceReferenceBackgroundUrl]);

  useEffect(() => {
    if (!layoutMode) return undefined;
    let active = true;
    const revision = referenceBackgroundRevisionRef.current + 1;
    referenceBackgroundRevisionRef.current = revision;
    replaceReferenceBackgroundUrl(null);
    setReferenceBackgroundVisible(false);
    setReferenceBackgroundError('');
    void loadReferenceBackground(referenceBackgroundKey(displayMode)).then((file) => {
      if (active && revision === referenceBackgroundRevisionRef.current && file) {
        replaceReferenceBackgroundUrl(file);
      }
    }).catch((error: unknown) => {
      console.warn('참조 배경을 불러오지 못했습니다.', error);
      if (active) setReferenceBackgroundError('저장된 참조 배경을 불러오지 못했습니다.');
    });
    return () => {
      active = false;
    };
  }, [displayMode, layoutMode, replaceReferenceBackgroundUrl]);

  useEffect(() => {
    if (!layoutMode) return undefined;
    const handlePaste = (event: ClipboardEvent) => {
      const imageItem = Array.from(event.clipboardData?.items ?? [])
        .find((item) => item.type.startsWith('image/'));
      const pasted = imageItem?.getAsFile();
      if (!pasted) return;
      event.preventDefault();
      const extension = pasted.type === 'image/jpeg' ? 'jpg' : 'png';
      const file = new File(
        [pasted],
        `ppt-slide-${displayMode}-${Date.now()}.${extension}`,
        { type: pasted.type || 'image/png' },
      );
      void applyReferenceBackground(file);
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [applyReferenceBackground, displayMode, layoutMode]);

  useEffect(() => () => {
    if (referenceBackgroundUrlRef.current) {
      URL.revokeObjectURL(referenceBackgroundUrlRef.current);
    }
  }, []);

  // Keep the selection valid when switching scenes so the toolbar targets a
  // present element.
  useEffect(() => {
    setSelectedLayoutKey('group-1');
    setLayoutGroupStart(0);
    setReferenceBackgroundVisible(false);
  }, [displayMode]);

  // Front lineup: every few seconds one Peter waves.
  useEffect(() => {
    if (displayMode !== 'stand' || !playing || lineupGroups.length === 0) {
      setReaction(null);
      return undefined;
    }
    let holdTimer = 0;
    let nextTimer = 0;
    const scheduleNext = () => {
      const gap = REACTION_MIN_GAP_MS + Math.random() * (REACTION_MAX_GAP_MS - REACTION_MIN_GAP_MS);
      nextTimer = window.setTimeout(() => {
        const target = lineupGroups[Math.floor(Math.random() * lineupGroups.length)];
        const action = REACTION_ACTIONS[Math.floor(Math.random() * REACTION_ACTIONS.length)];
        setReaction({ groupNumber: target.groupNumber, action });
        holdTimer = window.setTimeout(() => {
          setReaction(null);
          scheduleNext();
        }, REACTION_HOLD_MS);
      }, gap);
    };
    scheduleNext();
    return () => {
      window.clearTimeout(nextTimer);
      window.clearTimeout(holdTimer);
    };
  }, [activeGroupScene.groupStart, displayMode, playing, lineupGroups.length]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (layoutMode) return;
      if (event.code === 'Space') {
        event.preventDefault();
        setLocalPaused((current) => !current);
        return;
      }
      if (event.key.toLowerCase() === 'p') {
        setLocalPaused((current) => !current);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [layoutMode]);

  useEffect(() => {
    const pauseForCapture = () => setLocalPaused(true);
    const resumeAfterCapture = () => setLocalPaused(false);
    window.addEventListener('retreat:prepare-capture', pauseForCapture);
    window.addEventListener('retreat:restore-capture', resumeAfterCapture);
    return () => {
      window.removeEventListener('retreat:prepare-capture', pauseForCapture);
      window.removeEventListener('retreat:restore-capture', resumeAfterCapture);
    };
  }, []);

  function updateLayoutPosition(
    key: string,
    update: (current: ScenePosition) => ScenePosition,
  ) {
    setActiveLayout((current) => {
      const fallback = defaultLayoutFor(displayMode)[key] ?? {
        x: 50,
        bottom: 0,
        scale: 1,
        flipX: false,
        visible: true,
        poseId: defaultPoseForPage(displayMode),
      };
      const next = update(current[key] ?? fallback);
      return {
        ...current,
        [key]: {
          x: clamp(next.x, 2, 98),
          bottom: clamp(next.bottom, -4, 70),
          scale: clamp(next.scale, 0.35, 1.8),
          flipX: next.flipX,
          visible: next.visible,
          poseId: next.poseId,
        },
      };
    });
  }

  function setElementVisibility(key: string, visible: boolean) {
    updateLayoutPosition(key, (current) => ({ ...current, visible }));
    if (visible) setSelectedLayoutKey(key);
  }

  function setElementPose(key: string, poseId: RetreatPoseId) {
    updateLayoutPosition(key, (current) => ({ ...current, poseId }));
    setSelectedLayoutKey(key);
  }

  function handlePointerDown(key: string, event: ReactPointerEvent<HTMLElement>) {
    if (!layoutMode) return;
    event.preventDefault();
    event.stopPropagation();
    const startPosition = activeLayout[key] ?? defaultLayoutFor(displayMode)[key];
    if (!startPosition) return;
    setSelectedLayoutKey(key);
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      key,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPosition,
    };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    const bounds = worldRef.current?.getBoundingClientRect();
    if (!drag || !bounds || drag.pointerId !== event.pointerId) return;
    const deltaX = ((event.clientX - drag.startClientX) / bounds.width) * 100;
    const deltaY = ((event.clientY - drag.startClientY) / bounds.height) * 100;
    updateLayoutPosition(drag.key, (current) => ({
      ...current,
      x: drag.startPosition.x + deltaX,
      bottom: drag.startPosition.bottom - deltaY,
    }));
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLElement>) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  }

  function handleEditableKeyDown(key: string, event: ReactKeyboardEvent<HTMLElement>) {
    if (!layoutMode) return;
    if (event.key.toLowerCase() === 'f' && key.startsWith('group-')) {
      event.preventDefault();
      updateLayoutPosition(key, (current) => ({ ...current, flipX: !current.flipX }));
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 1 : 0.25;
    updateLayoutPosition(key, (current) => ({
      ...current,
      x: current.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
      bottom: current.bottom + (event.key === 'ArrowDown' ? -step : event.key === 'ArrowUp' ? step : 0),
    }));
  }

  function resetSelectedPosition() {
    const initial = defaultLayoutFor(displayMode)[selectedLayoutKey];
    if (initial) {
      setActiveLayout((current) => ({ ...current, [selectedLayoutKey]: initial }));
    }
  }

  function flipSelectedPeter() {
    if (!selectedLayoutKey.startsWith('group-')) return;
    updateLayoutPosition(
      selectedLayoutKey,
      (current) => ({ ...current, flipX: !current.flipX }),
    );
  }

  function resetAllPositions() {
    setActiveLayout(defaultLayoutFor(displayMode));
    setSelectedLayoutKey('group-1');
  }

  function handleReferenceBackgroundChange(event: ReactChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void applyReferenceBackground(file);
  }

  async function removeReferenceBackground() {
    try {
      referenceBackgroundRevisionRef.current += 1;
      await deleteReferenceBackground(referenceBackgroundKey(displayMode));
      replaceReferenceBackgroundUrl(null);
      setReferenceBackgroundVisible(false);
      setReferenceBackgroundError('');
    } catch (error) {
      console.warn('참조 배경을 삭제하지 못했습니다.', error);
      setReferenceBackgroundError('참조 배경을 삭제하지 못했습니다. 다시 시도하세요.');
    }
  }

  const campfireJesusPosition = campfireLayout.jesus ?? defaultCampfireLayout().jesus;
  const firePosition = campfireLayout.fire ?? defaultCampfireLayout().fire;
  const lineupLayout = displayMode === 'back' ? backLayout : standLayout;
  const lineupJesusPosition = lineupLayout.jesus ?? defaultLineupLayout(
    displayMode === 'back' ? 'back' : 'stand',
  ).jesus;
  const displayPath = displayMode === 'campfire'
    ? '/display/campfire'
    : displayMode === 'back'
      ? '/display/back'
      : '/display/stand';
  const lineupDirection = displayMode === 'back' ? '뒷모습' : '정면';
  const sidebarGroups = activeSceneGroups;
  const poseOptions = poseOptionsForPage(displayMode);

  return (
    <main
      ref={worldRef}
      className="retreat-parade"
      data-display-page="all-characters"
      data-preview={preview ? 'true' : 'false'}
      data-obs="true"
      data-background-mode="transparent"
      data-paused={playing ? 'false' : 'true'}
      data-scene={displayMode}
      data-display-mode={displayMode}
      data-group-range={`${activeGroupScene.groupStart + 1}-${activeGroupScene.groupStart + activeGroupScene.groupCount}`}
      data-layout-edit={layoutMode ? 'true' : 'false'}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      aria-label={displayMode === 'campfire'
        ? '스물한 조 베드로가 나뉘어 예수님의 말씀을 듣는 모션그래픽'
        : `예수님과 스물한 조 베드로의 ${lineupDirection} 라인업 모션그래픽`}
    >
      {layoutMode && referenceBackgroundUrl && referenceBackgroundVisible ? (
        <div className="retreat-parade__reference-background" aria-hidden="true">
          <img src={referenceBackgroundUrl} alt="" />
        </div>
      ) : null}

      {layoutMode ? (
        <aside
          className="retreat-parade__layout-panel"
          aria-label={displayMode === 'campfire' ? '모닥불 배치 편집기' : `${lineupDirection} 라인업 배치 편집기`}
        >
          <div className="retreat-parade__layout-heading">
            <div>
              <span>SCENE OBJECTS</span>
              <strong>{displayMode === 'campfire' ? '모닥불 배치' : `${lineupDirection} 라인업`}</strong>
            </div>
            <a href={displayPath}>완료</a>
          </div>
          <div className="retreat-parade__layout-scenes" aria-label="편집 장면 전환">
            {([
              ['stand', '정면', '/editor/stand'],
              ['back', '뒷면', '/editor/back'],
              ['campfire', '모닥불', '/editor/campfire'],
            ] as const).map(([mode, label, path]) => (
              <a
                key={mode}
                className={displayMode === mode ? 'is-active' : undefined}
                href={path}
              >
                {label}
              </a>
            ))}
          </div>
          <section
            className="retreat-parade__reference-tools"
            data-has-reference={referenceBackgroundUrl ? 'true' : 'false'}
            aria-label="참조 슬라이드 배경"
          >
            <div>
              <strong>참조 슬라이드</strong>
              <small>
                {referenceBackgroundName
                  ? `${referenceBackgroundName} · ${referenceBackgroundVisible ? '표시 중' : '숨김'}`
                  : '기본 캔버스는 투명함'}
              </small>
            </div>
            <label className="retreat-parade__reference-upload">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={handleReferenceBackgroundChange}
              />
              {referenceBackgroundUrl ? '이미지 교체' : '이미지 첨부'}
            </label>
            {referenceBackgroundUrl ? (
              <button
                type="button"
                aria-pressed={referenceBackgroundVisible}
                onClick={() => setReferenceBackgroundVisible((current) => !current)}
              >
                {referenceBackgroundVisible ? '참조 숨기기' : '참조 보기'}
              </button>
            ) : null}
            {referenceBackgroundUrl ? (
              <button type="button" onClick={() => void removeReferenceBackground()}>파일 삭제</button>
            ) : null}
            <p>PPT 슬라이드는 ⌘V로 붙여넣고 필요할 때만 켜세요. 송출에는 포함되지 않습니다.</p>
            {referenceBackgroundError ? (
              <p className="retreat-parade__reference-error" role="status">
                {referenceBackgroundError}
              </p>
            ) : null}
          </section>
          <div className="retreat-parade__layout-groups" role="group" aria-label="편집할 조 회차 선택">
            {GROUP_SCENES.map(({ groupStart, groupCount }) => (
              <button
                type="button"
                key={groupStart}
                className={layoutGroupStart === groupStart ? 'is-active' : undefined}
                onClick={() => {
                  setLayoutGroupStart(groupStart);
                  setSelectedLayoutKey(`group-${groupStart + 1}`);
                }}
              >
                {groupStart + 1}–{groupStart + groupCount}조
              </button>
            ))}
          </div>

          <div className="retreat-parade__object-list" aria-label="장면 요소 목록">
            {(['jesus', ...(displayMode === 'campfire' ? ['fire'] : [])] as const).map((key) => {
              const item = activeLayout[key] ?? defaultLayoutFor(displayMode)[key];
              if (!item) return null;
              return (
                <div
                  className="retreat-parade__object-row retreat-parade__object-row--prop"
                  data-selected={selectedLayoutKey === key ? 'true' : 'false'}
                  data-visible={item.visible ? 'true' : 'false'}
                  key={key}
                >
                  <button
                    className="retreat-parade__object-main"
                    type="button"
                    onClick={() => setSelectedLayoutKey(key)}
                  >
                    <span className="retreat-parade__object-thumb" data-kind={key} aria-hidden="true">
                      {key === 'jesus' ? '예' : '불'}
                    </span>
                    <span>
                      <strong>{key === 'jesus' ? '예수님' : '모닥불'}</strong>
                      <small>{item.visible ? '장면에 표시 중' : '장면에서 빠짐'}</small>
                    </span>
                  </button>
                  <button
                    className="retreat-parade__object-toggle"
                    type="button"
                    onClick={() => setElementVisibility(key, !item.visible)}
                  >
                    {item.visible ? '빼기' : '+ 추가'}
                  </button>
                </div>
              );
            })}

            {sidebarGroups.map((group) => {
              const layoutKey = `group-${group.groupNumber}`;
              const item = activeLayout[layoutKey] ?? defaultLayoutFor(displayMode)[layoutKey];
              if (!item) return null;
              return (
                <div
                  className="retreat-parade__object-row"
                  data-selected={selectedLayoutKey === layoutKey ? 'true' : 'false'}
                  data-visible={item.visible ? 'true' : 'false'}
                  key={group.id}
                >
                  <button
                    className="retreat-parade__object-main"
                    type="button"
                    onClick={() => setSelectedLayoutKey(layoutKey)}
                  >
                    <span className="retreat-parade__object-thumb" aria-hidden="true">
                      {group.groupNumber}
                    </span>
                    <span>
                      <strong>{nicknameFor(group)}</strong>
                      <small>{RETREAT_POSES[item.poseId].shortLabel}</small>
                    </span>
                  </button>
                  <button
                    className="retreat-parade__object-toggle"
                    type="button"
                    onClick={() => setElementVisibility(layoutKey, !item.visible)}
                  >
                    {item.visible ? '빼기' : '+ 추가'}
                  </button>
                  <label className="retreat-parade__object-pose">
                    <span>포즈</span>
                    <select
                      aria-label={`${nicknameFor(group)} 포즈`}
                      value={item.poseId}
                      onChange={(event) => setElementPose(
                        layoutKey,
                        event.target.value as RetreatPoseId,
                      )}
                    >
                      {poseOptions.map((pose) => (
                        <option key={pose.id} value={pose.id}>{pose.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
              );
            })}
          </div>

          <div className="retreat-parade__layout-actions" role="toolbar" aria-label="선택 대상 조절">
            <div className="retreat-parade__layout-selected">
              <span>선택됨</span>
              <strong>{editableLabel(selectedLayoutKey)}</strong>
            </div>
            <button
              type="button"
              aria-label="선택 대상 축소"
              onClick={() => updateLayoutPosition(
                selectedLayoutKey,
                (current) => ({ ...current, scale: current.scale - 0.05 }),
              )}
            >
              작게 −
            </button>
            <button
              type="button"
              aria-label="선택 대상 확대"
              onClick={() => updateLayoutPosition(
                selectedLayoutKey,
                (current) => ({ ...current, scale: current.scale + 0.05 }),
              )}
            >
              크게 +
            </button>
            {selectedLayoutKey.startsWith('group-') ? (
              <button
                type="button"
                aria-label={`${editableLabel(selectedLayoutKey)} 좌우 방향 반전`}
                onClick={flipSelectedPeter}
              >
                좌우 반전 (F)
              </button>
            ) : null}
            <button type="button" onClick={resetSelectedPosition}>선택 초기화</button>
            <button type="button" onClick={resetAllPositions}>전체 초기화</button>
          </div>
          <p>요소를 선택하고 캔버스에서 드래그하세요. 추가·빼기와 포즈는 자동 저장됩니다.</p>
        </aside>
      ) : null}

      {displayMode !== 'campfire' ? (
        <section
          className="retreat-parade__lineup"
          aria-label={`해변에 나란히 선 예수님과 조 캐릭터 ${lineupDirection}`}
        >
          {lineupGroups.map((group) => {
            const layoutKey = `group-${group.groupNumber}`;
            const position = lineupLayout[layoutKey] ?? defaultLineupLayout(
              displayMode === 'back' ? 'back' : 'stand',
            )[layoutKey];
            if (!position?.visible) return null;
            const isReacting = displayMode === 'stand'
              && position.poseId === 'idle'
              && reaction?.groupNumber === group.groupNumber;
            const poseId: RetreatPoseId = isReacting ? 'wave' : position.poseId;
            return (
              <article
                className="retreat-parade__stander"
                data-reaction={isReacting ? reaction!.action : 'idle'}
                data-layout-selected={selectedLayoutKey === layoutKey ? 'true' : 'false'}
                key={group.id}
                role={layoutMode ? 'button' : undefined}
                tabIndex={layoutMode ? 0 : undefined}
                aria-label={layoutMode ? `${nicknameFor(group)} 베드로 위치 편집` : undefined}
                onPointerDown={(event) => handlePointerDown(layoutKey, event)}
                onKeyDown={(event) => handleEditableKeyDown(layoutKey, event)}
                style={{
                  '--stander-x': `${position.x}${STAGE_UNIT_X}`,
                  '--stander-bottom': `${position.bottom}${STAGE_UNIT_Y}`,
                  '--stander-scale': position.scale,
                } as CSSProperties}
              >
                <RetreatCharacter
                  group={group}
                  poseId={poseId}
                  playing={playing}
                  flipX={position.flipX}
                  respectReducedMotion={false}
                  className="retreat-parade__stander-character"
                />
              </article>
            );
          })}
          {lineupJesusPosition.visible ? (
            <article
              className="retreat-parade__stander retreat-parade__stander--jesus"
              data-layout-selected={selectedLayoutKey === 'jesus' ? 'true' : 'false'}
              role={layoutMode ? 'button' : undefined}
              tabIndex={layoutMode ? 0 : undefined}
              aria-label={layoutMode ? `예수님 ${lineupDirection} 위치 편집` : undefined}
              onPointerDown={(event) => handlePointerDown('jesus', event)}
              onKeyDown={(event) => handleEditableKeyDown('jesus', event)}
              style={{
                '--stander-x': `${lineupJesusPosition.x}${STAGE_UNIT_X}`,
                '--stander-bottom': `${lineupJesusPosition.bottom}${STAGE_UNIT_Y}`,
                '--stander-scale': lineupJesusPosition.scale,
              } as CSSProperties}
            >
              <img
                className="retreat-parade__standing-jesus"
                src={displayMode === 'back'
                  ? '/assets/campfire/jesus-standing-back.png'
                  : '/assets/campfire/jesus-standing-front.png'}
                alt={`예수님 ${lineupDirection}`}
                draggable={false}
              />
            </article>
          ) : null}
        </section>
      ) : null}

      {displayMode === 'campfire' ? (
        <section className="retreat-parade__campfire-gathering" aria-label="예수님의 말씀을 듣는 조 캐릭터">
          {firePosition.visible ? (
            <div
              className="retreat-parade__fire-glow"
              style={{
                '--fire-x': `${firePosition.x}${STAGE_UNIT_X}`,
                '--fire-bottom': `${firePosition.bottom}${STAGE_UNIT_Y}`,
                '--fire-scale': firePosition.scale,
              } as CSSProperties}
              aria-hidden="true"
            />
          ) : null}
          {campfireJesusPosition.visible ? (
            <img
              className="retreat-parade__jesus"
              src="/assets/campfire/jesus-seated.png"
              alt="모닥불 곁에서 말씀을 전하는 예수님"
              draggable={false}
              data-layout-selected={selectedLayoutKey === 'jesus' ? 'true' : 'false'}
              role={layoutMode ? 'button' : undefined}
              tabIndex={layoutMode ? 0 : undefined}
              aria-label={layoutMode ? '예수님 위치 편집' : undefined}
              onPointerDown={(event) => handlePointerDown('jesus', event)}
              onKeyDown={(event) => handleEditableKeyDown('jesus', event)}
              style={{
                '--jesus-x': `${campfireJesusPosition.x}${STAGE_UNIT_X}`,
                '--jesus-bottom': `${campfireJesusPosition.bottom}${STAGE_UNIT_Y}`,
                '--jesus-scale': campfireJesusPosition.scale,
              } as CSSProperties}
            />
          ) : null}
          {campfireGroups.map((group, index) => {
            const seat = CAMPFIRE_SEATS[index];
            const layoutKey = `group-${group.groupNumber}`;
            const position = campfireLayout[layoutKey] ?? defaultCampfireLayout()[layoutKey];
            if (!position?.visible) return null;
            return (
              <article
                className="retreat-parade__listener"
                data-depth={seat.depth}
                data-layout-selected={selectedLayoutKey === layoutKey ? 'true' : 'false'}
                key={group.id}
                role={layoutMode ? 'button' : undefined}
                tabIndex={layoutMode ? 0 : undefined}
                aria-label={layoutMode ? `${nicknameFor(group)} 베드로 위치 편집` : undefined}
                onPointerDown={(event) => handlePointerDown(layoutKey, event)}
                onKeyDown={(event) => handleEditableKeyDown(layoutKey, event)}
                style={{
                  '--listener-x': `${position.x}${STAGE_UNIT_X}`,
                  '--listener-bottom': `${position.bottom}${STAGE_UNIT_Y}`,
                  '--listener-scale': position.scale,
                } as CSSProperties}
              >
                <RetreatCharacter
                  group={group}
                  poseId={position.poseId}
                  playing={playing}
                  flipX={position.flipX}
                  respectReducedMotion={false}
                  className="retreat-parade__listener-character"
                />
              </article>
            );
          })}
          {firePosition.visible ? (
            <div
              className="retreat-parade__campfire"
              data-layout-selected={selectedLayoutKey === 'fire' ? 'true' : 'false'}
              role={layoutMode ? 'button' : undefined}
              tabIndex={layoutMode ? 0 : undefined}
              aria-hidden={layoutMode ? undefined : true}
              aria-label={layoutMode ? '모닥불 위치 편집' : undefined}
              onPointerDown={(event) => handlePointerDown('fire', event)}
              onKeyDown={(event) => handleEditableKeyDown('fire', event)}
              style={{
                '--fire-x': `${firePosition.x}${STAGE_UNIT_X}`,
                '--fire-bottom': `${firePosition.bottom}${STAGE_UNIT_Y}`,
                '--fire-scale': firePosition.scale,
              } as CSSProperties}
            >
              <img src="/assets/campfire/campfire-sheet.png" alt="" />
            </div>
          ) : null}
        </section>
      ) : null}

    </main>
  );
}

export default AllCharactersWorld;
