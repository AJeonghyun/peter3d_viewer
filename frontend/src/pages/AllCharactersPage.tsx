import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { AnimationName } from '../spriteLab/types';
import { RetreatCharacter } from '../retreat/RetreatCharacter';
import { useRetreat } from '../retreat/RetreatProvider';
import type { RetreatGroup } from '../retreat/types';
import '../styles/retreat-world.css';

interface AllCharactersPageProps {
  preview?: boolean;
}

type ParadeScene =
  | { type: 'walk'; duration: number; groupStart: number; groupCount: number }
  | { type: 'boat'; duration: number; groupStart: number; groupCount: number }
  | { type: 'wipe'; duration: number };

interface LocatedScene {
  scene: ParadeScene;
  elapsed: number;
  index: number;
  startedAt: number;
}

const WALK_DURATION = 12_000;
const WALK_STAGGER = 3_000;
const WALK_SCENE_DURATION = WALK_STAGGER * 6 + WALK_DURATION + 1_200;
const WIPE_DURATION = 1_400;
const BOAT_DURATION = 10_500;
const START_OFFSET = 2_400;
const ACTIONS = ['wave', 'pray', 'jump', 'point'] as const satisfies readonly AnimationName[];

const PARADE_SCENES: readonly ParadeScene[] = [
  { type: 'walk', duration: WALK_SCENE_DURATION, groupStart: 0, groupCount: 7 },
  { type: 'wipe', duration: WIPE_DURATION },
  { type: 'boat', duration: BOAT_DURATION, groupStart: 7, groupCount: 3 },
  { type: 'wipe', duration: WIPE_DURATION },
  { type: 'walk', duration: WALK_SCENE_DURATION, groupStart: 10, groupCount: 7 },
  { type: 'wipe', duration: WIPE_DURATION },
  { type: 'boat', duration: BOAT_DURATION, groupStart: 17, groupCount: 4 },
  { type: 'wipe', duration: WIPE_DURATION },
];

const CYCLE_DURATION = PARADE_SCENES.reduce((total, scene) => total + scene.duration, 0);

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(value: number) {
  const next = clamp(value);
  return next * next * (3 - 2 * next);
}

function locateScene(time: number): LocatedScene {
  let cursor = 0;
  for (let index = 0; index < PARADE_SCENES.length; index += 1) {
    const scene = PARADE_SCENES[index];
    if (time < cursor + scene.duration) {
      return {
        scene,
        elapsed: time - cursor,
        index,
        startedAt: cursor,
      };
    }
    cursor += scene.duration;
  }
  return {
    scene: PARADE_SCENES[0],
    elapsed: 0,
    index: 0,
    startedAt: 0,
  };
}

function useLoopClock(playing: boolean) {
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
        setTime((current) => (current + step) % CYCLE_DURATION);
      }
      frameRef.current = window.requestAnimationFrame(tick);
    };

    frameRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    };
  }, [playing]);

  return time;
}

function paradeX(progress: number) {
  if (progress < 0.42) {
    return -10 + smoothstep(progress / 0.42) * 56;
  }
  if (progress < 0.58) {
    return 46 + smoothstep((progress - 0.42) / 0.16) * 4;
  }
  return 50 + smoothstep((progress - 0.58) / 0.42) * 62;
}

function eventFor(group: RetreatGroup) {
  return ACTIONS[(group.groupNumber - 1) % ACTIONS.length];
}

function nicknameFor(group: RetreatGroup) {
  const nickname = group.groupName.trim();
  return nickname || `${group.groupNumber}조`;
}

export function AllCharactersWorld({ preview = false }: AllCharactersPageProps) {
  const { settings } = useRetreat();
  const [localPaused, setLocalPaused] = useState(false);
  const playing = !localPaused;
  const clock = useLoopClock(playing);
  const timelineTime = clock;
  const located = locateScene(timelineTime);
  const groups = useMemo(
    () => [...settings.groups]
      .filter((group) => group.enabled)
      .sort((first, second) => first.groupNumber - second.groupNumber)
      .slice(0, 21),
    [settings.groups],
  );

  useEffect(() => {
    document.title = '페이지 3 | 베드로 퍼레이드';
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
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
  }, []);

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

  const walkingActors = located.scene.type === 'walk'
    ? groups
      .slice(located.scene.groupStart, located.scene.groupStart + located.scene.groupCount)
      .map((group, index) => {
        const localTime = located.elapsed - index * WALK_STAGGER;
        const progress = localTime / WALK_DURATION;
        if (progress < 0 || progress > 1) return null;
        const event = eventFor(group);
        const eventActive = progress >= 0.42 && progress < 0.58;
        const entranceOpacity = clamp(progress / 0.045);
        const exitOpacity = clamp((1 - progress) / 0.055);
        return {
          group,
          event,
          eventActive,
          animation: (eventActive ? event : 'walk') as AnimationName,
          x: paradeX(progress),
          opacity: Math.min(entranceOpacity, exitOpacity),
          progress,
        };
      })
      .filter((actor): actor is NonNullable<typeof actor> => actor !== null)
    : [];

  const boatGroups = located.scene.type === 'boat'
    ? groups.slice(located.scene.groupStart, located.scene.groupStart + located.scene.groupCount)
    : [];
  const boatProgress = located.scene.type === 'boat'
    ? clamp(located.elapsed / located.scene.duration)
    : 0;
  const boatX = -28 + smoothstep(boatProgress) * 156;
  const wipeActive = located.scene.type === 'wipe';

  return (
    <main
      className="retreat-parade"
      data-display-page="all-characters"
      data-preview={preview ? 'true' : 'false'}
      data-paused={playing ? 'false' : 'true'}
      data-scene={located.scene.type}
      aria-label="스물한 조 베드로가 해변을 지나가는 모션그래픽"
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

      <section className="retreat-parade__walkers" aria-label="순서대로 입장하는 조 캐릭터">
        {walkingActors.map((actor) => (
          <article
            key={actor.group.id}
            className="retreat-parade__actor"
            data-action={actor.eventActive ? actor.event : 'walk'}
            style={{
              '--actor-x': `${actor.x}cqw`,
              '--actor-opacity': actor.opacity,
              '--actor-lift': actor.eventActive && actor.event === 'jump' ? '-4.6cqh' : '0px',
              '--actor-scale': 0.96 + Math.min(actor.progress, 0.15) * 0.26,
            } as CSSProperties}
          >
            <span className="retreat-parade__action-accent" aria-hidden="true" />
            <RetreatCharacter
              group={actor.group}
              animation={actor.animation}
              playing={playing}
              respectReducedMotion={false}
              flipX={false}
              className="retreat-parade__character"
            />
            <span className="retreat-parade__nameplate">{nicknameFor(actor.group)}</span>
          </article>
        ))}
      </section>

      {located.scene.type === 'boat' ? (
        <section
          className="retreat-parade__boat"
          style={{
            '--boat-x': `${boatX}cqw`,
            '--boat-rock': `${Math.sin(boatProgress * Math.PI * 8) * 1.4}deg`,
          } as CSSProperties}
          aria-label="배를 타고 지나가는 조 캐릭터"
        >
          <span className="retreat-parade__boat-wake" aria-hidden="true" />
          <span className="retreat-parade__mast" aria-hidden="true">
            <span className="retreat-parade__sail retreat-parade__sail--main" />
            <span className="retreat-parade__sail retreat-parade__sail--small" />
          </span>
          <div className="retreat-parade__passengers">
            {boatGroups.map((group, index) => {
              const actionWindow = boatProgress > 0.3 && boatProgress < 0.72;
              const animation: AnimationName = actionWindow
                ? index % 3 === 0 ? 'wave' : index % 3 === 1 ? 'point' : 'idle'
                : 'idle';
              return (
                <article className="retreat-parade__passenger" key={group.id}>
                  <RetreatCharacter
                    group={group}
                    animation={animation}
                    playing={playing}
                    respectReducedMotion={false}
                    className="retreat-parade__passenger-character"
                  />
                  <span className="retreat-parade__nameplate">{nicknameFor(group)}</span>
                </article>
              );
            })}
          </div>
          <span className="retreat-parade__hull" aria-hidden="true">
            <span />
          </span>
        </section>
      ) : null}

      {wipeActive ? (
        <div
          key={located.startedAt}
          className="retreat-parade__wipe"
          data-wipe-index={located.index}
          aria-hidden="true"
        />
      ) : null}
    </main>
  );
}

export default AllCharactersWorld;
