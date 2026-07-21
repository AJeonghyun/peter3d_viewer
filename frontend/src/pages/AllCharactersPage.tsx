import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { AnimationName } from '../spriteLab/types';
import { RetreatCharacter } from '../retreat/RetreatCharacter';
import { useRetreat } from '../retreat/RetreatProvider';
import { STAGE_UNIT_X, STAGE_UNIT_Y, getEffectiveDisplayMode } from '../retreat/displayMode';
import type { RetreatGroup, RetreatPage } from '../retreat/types';
import '../styles/retreat-world.css';

interface AllCharactersPageProps {
  preview?: boolean;
  scene?: RetreatPage;
}

type DisplayMode = RetreatPage;

interface CampfireTimelineScene {
  duration: number;
  groupStart: number;
  groupCount: number;
}

const CAMPFIRE_DURATION = 14_000;
const START_OFFSET = 2_400;
const TEAM_COUNT = 21;
const REACTION_ACTIONS = ['wave'] as const satisfies readonly AnimationName[];
const REACTION_HOLD_MS = 950;
const REACTION_MIN_GAP_MS = 1_600;
const REACTION_MAX_GAP_MS = 3_400;
const STAND_LAYOUT_STORAGE_KEY = 'peter-page3-stand-layout-v2';
const BACK_LAYOUT_STORAGE_KEY = 'peter-page3-back-layout-v1';
const CAMPFIRE_LAYOUT_STORAGE_KEY = 'peter-page3-campfire-layout-v1';
const DISPLAY_MODE_STORAGE_KEY = 'peter-page3-display-mode-v1';

const CAMPFIRE_SCENES: readonly CampfireTimelineScene[] = [
  { duration: CAMPFIRE_DURATION, groupStart: 0, groupCount: 7 },
  { duration: CAMPFIRE_DURATION, groupStart: 7, groupCount: 7 },
  { duration: CAMPFIRE_DURATION, groupStart: 14, groupCount: 7 },
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

// Stand scene: the whole roster lined up along the bottom band, ideal for
// laying a transparent OBS source over a slide without covering its content.
function defaultLineupLayout(): SceneLayout {
  const lineupSlots = TEAM_COUNT + 1;
  const jesusSlot = 11;
  const xForSlot = (slot: number) => 4 + (slot / (lineupSlots - 1)) * 92;
  const layout: SceneLayout = {
    jesus: {
      x: xForSlot(jesusSlot),
      bottom: 2.5,
      scale: 1,
      flipX: false,
    },
  };
  for (let groupNumber = 1; groupNumber <= TEAM_COUNT; groupNumber += 1) {
    const slot = groupNumber <= jesusSlot ? groupNumber - 1 : groupNumber;
    layout[`group-${groupNumber}`] = {
      x: xForSlot(slot),
      bottom: 2.5,
      scale: 1,
      flipX: false,
    };
  }
  return layout;
}

function defaultCampfireLayout(): SceneLayout {
  const layout: SceneLayout = {
    jesus: { x: 50, bottom: 31, scale: 1, flipX: false },
    fire: { x: 50, bottom: 18, scale: 1, flipX: false },
  };
  for (let groupNumber = 1; groupNumber <= TEAM_COUNT; groupNumber += 1) {
    const seat = CAMPFIRE_SEATS[(groupNumber - 1) % CAMPFIRE_SEATS.length];
    layout[`group-${groupNumber}`] = {
      x: seat.x,
      bottom: seat.bottom,
      scale: seat.scale,
      flipX: seat.flipX,
    };
  }
  return layout;
}

function defaultLayoutFor(mode: DisplayMode): SceneLayout {
  return mode === 'campfire' ? defaultCampfireLayout() : defaultLineupLayout();
}

function layoutStorageKey(mode: DisplayMode): string {
  if (mode === 'campfire') return CAMPFIRE_LAYOUT_STORAGE_KEY;
  return mode === 'back' ? BACK_LAYOUT_STORAGE_KEY : STAND_LAYOUT_STORAGE_KEY;
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

function locateCampfire(time: number): CampfireTimelineScene {
  let cursor = 0;
  for (const scene of CAMPFIRE_SCENES) {
    if (time < cursor + scene.duration) return scene;
    cursor += scene.duration;
  }
  return CAMPFIRE_SCENES[0];
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
  const backgroundDisplayMode = getEffectiveDisplayMode(settings.transparentBackground);
  const worldRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [layoutMode] = useState(() => !preview && isLayoutRoute());
  const [layoutGroupStart, setLayoutGroupStart] = useState(0);
  const [standLayout, setStandLayout] = useState(() => readLayout('stand'));
  const [backLayout, setBackLayout] = useState(() => readLayout('back'));
  const [campfireLayout, setCampfireLayout] = useState(() => readLayout('campfire'));
  const [displayMode, setDisplayMode] = useState<DisplayMode>(() => scene ?? readDisplayMode());
  const [selectedLayoutKey, setSelectedLayoutKey] = useState('group-1');
  const [localPaused, setLocalPaused] = useState(false);
  const [reaction, setReaction] = useState<{ groupNumber: number; action: AnimationName } | null>(null);

  const playing = !localPaused;
  const campfireRotating = displayMode === 'campfire' && !layoutMode && playing;
  const clock = useLoopClock(campfireRotating, CAMPFIRE_SCENES.length * CAMPFIRE_DURATION);

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

  const campfireSlice = layoutMode
    ? { groupStart: layoutGroupStart, groupCount: 7 }
    : locateCampfire(clock);
  const campfireGroups = displayMode === 'campfire'
    ? groups.slice(campfireSlice.groupStart, campfireSlice.groupStart + campfireSlice.groupCount)
    : [];
  const lineupGroups = displayMode === 'campfire' ? [] : groups;

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

  // Keep the selection valid when switching scenes so the toolbar targets a
  // present element.
  useEffect(() => {
    setSelectedLayoutKey('group-1');
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
  }, [displayMode, playing, lineupGroups.length]);

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
      };
      const next = update(current[key] ?? fallback);
      return {
        ...current,
        [key]: {
          x: clamp(next.x, 2, 98),
          bottom: clamp(next.bottom, -4, 70),
          scale: clamp(next.scale, 0.35, 1.8),
          flipX: next.flipX,
        },
      };
    });
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

  const campfireJesusPosition = campfireLayout.jesus ?? defaultCampfireLayout().jesus;
  const firePosition = campfireLayout.fire ?? defaultCampfireLayout().fire;
  const lineupLayout = displayMode === 'back' ? backLayout : standLayout;
  const lineupJesusPosition = lineupLayout.jesus ?? defaultLineupLayout().jesus;
  const displayPath = displayMode === 'campfire'
    ? '/display/campfire'
    : displayMode === 'back'
      ? '/display/back'
      : '/display/stand';
  const lineupDirection = displayMode === 'back' ? '뒷모습' : '정면';

  return (
    <main
      ref={worldRef}
      className="retreat-parade"
      data-display-page="all-characters"
      data-preview={preview ? 'true' : 'false'}
      data-obs={backgroundDisplayMode.obsMode ? 'true' : 'false'}
      data-background-mode={backgroundDisplayMode.backgroundMode}
      data-paused={playing ? 'false' : 'true'}
      data-scene={displayMode}
      data-display-mode={displayMode}
      data-layout-edit={layoutMode ? 'true' : 'false'}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      aria-label={displayMode === 'campfire'
        ? '스물한 조 베드로가 나뉘어 예수님의 말씀을 듣는 모션그래픽'
        : `예수님과 스물한 조 베드로의 ${lineupDirection} 라인업 모션그래픽`}
    >
      <div className="retreat-parade__sky" aria-hidden="true">
        <span className="retreat-parade__sun" />
        <span className="retreat-parade__cloud retreat-parade__cloud--one" />
        <span className="retreat-parade__cloud retreat-parade__cloud--two" />
        <span className="retreat-parade__cloud retreat-parade__cloud--three" />
        <span className="retreat-parade__birds retreat-parade__birds--one" />
        <span className="retreat-parade__birds retreat-parade__birds--two" />
      </div>
      <div className="retreat-parade__sea" aria-hidden="true">
        <span className="retreat-parade__sea-light retreat-parade__sea-light--one" />
        <span className="retreat-parade__sea-light retreat-parade__sea-light--two" />
        <span className="retreat-parade__island" />
      </div>
      <div className="retreat-parade__shoreline" aria-hidden="true" />
      <div className="retreat-parade__sand" aria-hidden="true">
        <span className="retreat-parade__shell retreat-parade__shell--one" />
        <span className="retreat-parade__shell retreat-parade__shell--two" />
        <span className="retreat-parade__grass retreat-parade__grass--one" />
        <span className="retreat-parade__grass retreat-parade__grass--two" />
      </div>

      {layoutMode ? (
        <aside
          className="retreat-parade__layout-panel"
          aria-label={displayMode === 'campfire' ? '모닥불 배치 편집기' : `${lineupDirection} 라인업 배치 편집기`}
        >
          <div className="retreat-parade__layout-heading">
            <strong>{displayMode === 'campfire' ? '모닥불 배치 편집' : `${lineupDirection} 라인업 배치 편집`}</strong>
            <span>대상을 드래그 · 방향키로 미세 이동</span>
          </div>
          {displayMode === 'campfire' ? (
            <div className="retreat-parade__layout-groups" role="group" aria-label="편집할 조 선택">
              {[0, 7, 14].map((groupStart) => (
                <button
                  type="button"
                  key={groupStart}
                  className={layoutGroupStart === groupStart ? 'is-active' : undefined}
                  onClick={() => {
                    setLayoutGroupStart(groupStart);
                    setSelectedLayoutKey(`group-${groupStart + 1}`);
                  }}
                >
                  {groupStart + 1}–{groupStart + 7}조
                </button>
              ))}
            </div>
          ) : (
            <p className="retreat-parade__layout-hint">
              캐릭터를 클릭해 선택한 뒤 아래 버튼으로 조절하세요.
            </p>
          )}
          <div className="retreat-parade__layout-actions" role="toolbar" aria-label="선택 대상 조절">
            <span className="retreat-parade__layout-selected">
              선택: {editableLabel(selectedLayoutKey)}
            </span>
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
          <div className="retreat-parade__layout-footer">
            <a href={displayPath}>
              편집 끝내기
            </a>
          </div>
          <p>
            배치는 이 브라우저에 자동 저장됩니다.
            송출 URL: <code>{displayPath}</code>
          </p>
        </aside>
      ) : null}

      {displayMode !== 'campfire' ? (
        <section
          className="retreat-parade__lineup"
          aria-label={`해변에 나란히 선 예수님과 조 캐릭터 ${lineupDirection}`}
        >
          {lineupGroups.map((group) => {
            const layoutKey = `group-${group.groupNumber}`;
            const position = lineupLayout[layoutKey] ?? defaultLineupLayout()[layoutKey];
            const isReacting = displayMode === 'stand'
              && reaction?.groupNumber === group.groupNumber;
            const animation: AnimationName = isReacting ? reaction!.action : 'idle';
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
                  animation={animation}
                  playing={playing}
                  flipX={position.flipX}
                  view={displayMode === 'back' ? 'back' : 'front'}
                  respectReducedMotion={false}
                  className="retreat-parade__stander-character"
                />
              </article>
            );
          })}
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
        </section>
      ) : null}

      {displayMode === 'campfire' ? (
        <section className="retreat-parade__campfire-gathering" aria-label="예수님의 말씀을 듣는 조 캐릭터">
          <div
            className="retreat-parade__fire-glow"
            style={{
              '--fire-x': `${firePosition.x}${STAGE_UNIT_X}`,
              '--fire-bottom': `${firePosition.bottom}${STAGE_UNIT_Y}`,
              '--fire-scale': firePosition.scale,
            } as CSSProperties}
            aria-hidden="true"
          />
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
          {campfireGroups.map((group, index) => {
            const seat = CAMPFIRE_SEATS[index];
            const layoutKey = `group-${group.groupNumber}`;
            const position = campfireLayout[layoutKey] ?? {
              x: seat.x,
              bottom: seat.bottom,
              scale: seat.scale,
              flipX: seat.flipX,
            };
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
                  animation="kneel"
                  fixedFrame={seat.fixedFrame}
                  playing={playing}
                  flipX={position.flipX}
                  respectReducedMotion={false}
                  className="retreat-parade__listener-character"
                />
              </article>
            );
          })}
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
        </section>
      ) : null}

    </main>
  );
}

export default AllCharactersWorld;
