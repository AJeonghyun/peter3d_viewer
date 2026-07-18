import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { RetreatCharacter } from '../retreat/RetreatCharacter';
import { useRetreat } from '../retreat/RetreatProvider';
import type { RetreatGroup, NoticeCharacterRotationSettings } from '../retreat/types';
import '../styles/retreat-notice.css';

interface NoticePageProps {
  preview?: boolean;
}

const SLOT_CLASSES = ['slot-a', 'slot-b', 'slot-c', 'slot-d'] as const;
const NOTICE_START_X = [20, 35, 65, 80] as const;

interface NoticeActorMotion {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  direction: 1 | -1;
  moving: boolean;
  waitUntil: number;
  speed: number;
}

function clampVisibleCount(value: number) {
  return Math.max(1, Math.min(4, Math.round(value || 1)));
}

function chooseRandomGroups(groups: RetreatGroup[], count: number, seed: number) {
  const keyed = groups.map((group, index) => {
    const groupSeed = Array.from(group.id).reduce((total, char) => total + char.charCodeAt(0), 0);
    const score = Math.sin((seed + 1) * (groupSeed + 17) * 12.9898 + index * 78.233);
    return { group, score: score - Math.floor(score) };
  });
  return keyed
    .sort((left, right) => left.score - right.score)
    .slice(0, count)
    .map(({ group }) => group);
}

function rotateGroups(
  groups: RetreatGroup[],
  rotation: NoticeCharacterRotationSettings,
  tick: number,
) {
  if (!groups.length) return [];

  const count = Math.min(clampVisibleCount(rotation.maxVisibleCharacters), groups.length);
  if (rotation.order === 'selected') return groups.slice(0, count);
  if (rotation.order === 'random') return chooseRandomGroups(groups, count, tick);

  return Array.from({ length: count }, (_, offset) => groups[(tick + offset) % groups.length]);
}

function textScaleFor(body: string) {
  const length = body.trim().length;
  if (length > 220) return 0.5;
  if (length > 150) return 0.62;
  if (length > 95) return 0.76;
  return 1;
}

function nextNoticeTarget(
  current: NoticeActorMotion,
  others: NoticeActorMotion[],
) {
  const leftSide = current.x < 50;
  const min = leftSide ? 13 : 60;
  const max = leftSide ? 40 : 87;
  let targetX = min + Math.random() * (max - min);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (others.every((other) => Math.abs(other.targetX - targetX) >= 11)) break;
    targetX = min + Math.random() * (max - min);
  }
  return {
    targetX,
    targetY: Math.random() * 4.5,
  };
}

export default function NoticePage({ preview = false }: NoticePageProps) {
  const { settings } = useRetreat();
  const { notice } = settings;
  const [tick, setTick] = useState(0);
  const motionRef = useRef<Record<string, NoticeActorMotion>>({});
  const [actorMotion, setActorMotion] = useState<Record<string, NoticeActorMotion>>({});

  useEffect(() => {
    const duration = Math.max(1_800, notice.rotation.stayDurationMs || 7_000);
    if (!settings.animationPlaying || notice.rotation.order === 'selected') return undefined;
    const interval = window.setInterval(() => setTick((current) => current + 1), duration);
    return () => window.clearInterval(interval);
  }, [notice.rotation.order, notice.rotation.stayDurationMs, settings.animationPlaying]);

  const title = notice.title.trim();
  const subtitle = notice.subtitle.trim();
  const body = notice.body.trim();
  const emphasis = notice.emphasis.trim();
  const footer = notice.footer.trim();

  const eligibleGroups = useMemo(() => {
    const enabledIds = new Set(notice.rotation.enabledGroupIds);
    const selected = settings.groups.filter((group) => group.enabled && enabledIds.has(group.id));
    return selected.length ? selected : settings.groups.filter((group) => group.enabled);
  }, [notice.rotation.enabledGroupIds, settings.groups]);

  const visibleGroups = useMemo(
    () => rotateGroups(eligibleGroups, notice.rotation, tick),
    [eligibleGroups, notice.rotation, tick],
  );

  useEffect(() => {
    const next: Record<string, NoticeActorMotion> = Object.fromEntries(visibleGroups.map((group, index) => {
      const x = NOTICE_START_X[index] ?? 50;
      return [group.id, {
        x,
        y: index % 2 ? 3 : 0,
        targetX: x,
        targetY: index % 2 ? 3 : 0,
        direction: (index < 2 ? 1 : -1) as 1 | -1,
        moving: false,
        waitUntil: performance.now() + 900 + index * 520,
        speed: 2.8 + Math.random() * 1.5,
      }];
    }));
    motionRef.current = next;
    setActorMotion(next);
  }, [visibleGroups]);

  useEffect(() => {
    if (!settings.animationPlaying || !visibleGroups.length) return undefined;
    const calmMultiplier = notice.scene === 'calm-lake' || notice.scene === 'fire-circle-seated'
      ? 0.62
      : notice.scene === 'follow-me'
        ? 1.12
        : 0.86;
    const interval = window.setInterval(() => {
      const now = performance.now();
      const currentActors = Object.values(motionRef.current);
      const next = Object.fromEntries(Object.entries(motionRef.current).map(([id, actor]) => {
        if (!actor.moving && now >= actor.waitUntil) {
          const target = nextNoticeTarget(actor, currentActors.filter((candidate) => candidate !== actor));
          const direction: 1 | -1 = target.targetX >= actor.x ? 1 : -1;
          return [id, {
            ...actor,
            ...target,
            direction,
            moving: true,
          }];
        }
        if (!actor.moving) return [id, actor];
        const dx = actor.targetX - actor.x;
        const dy = actor.targetY - actor.y;
        const step = actor.speed * calmMultiplier * 0.075;
        if (Math.abs(dx) <= step) {
          return [id, {
            ...actor,
            x: actor.targetX,
            y: actor.targetY,
            moving: false,
            waitUntil: now + 1_900 + Math.random() * 3_800,
          }];
        }
        let nextX = actor.x + Math.sign(dx) * step;
        currentActors.forEach((other) => {
          if (other === actor || Math.abs(other.y - actor.y) > 3) return;
          if (Math.abs(other.x - nextX) < 9) {
            nextX = actor.x;
          }
        });
        return [id, {
          ...actor,
          x: nextX,
          y: actor.y + Math.sign(dy) * Math.min(Math.abs(dy), step * 0.3),
        }];
      }));
      motionRef.current = next;
      setActorMotion(next);
    }, 75);
    return () => window.clearInterval(interval);
  }, [notice.scene, settings.animationPlaying, visibleGroups.length]);

  const textStyle = {
    '--notice-align': notice.textAlign,
    '--notice-color': notice.textColor,
    '--notice-emphasis': notice.emphasisColor,
    '--notice-font-size': `${notice.fontSize}px`,
    '--notice-line-height': String(notice.lineHeight),
    '--notice-body-scale': String(textScaleFor(body)),
  } as CSSProperties;

  return (
    <main
      className="retreat-notice-page"
      data-display-page="notice"
      data-preview={preview ? 'true' : 'false'}
      data-scene={notice.scene}
      data-enter-mode={notice.rotation.enterMode}
      data-exit-mode={notice.rotation.exitMode}
    >
      <section
        className="retreat-notice-copy"
        style={textStyle}
        data-align={notice.textAlign}
        aria-live="polite"
      >
        {title ? <h1>{title}</h1> : null}
        {subtitle ? <p className="retreat-notice-copy__subtitle">{subtitle}</p> : null}
        {body ? <p className="retreat-notice-copy__body">{body}</p> : null}
        {emphasis ? <p className="retreat-notice-copy__emphasis">{emphasis}</p> : null}
        {footer ? <p className="retreat-notice-copy__footer">{footer}</p> : null}
      </section>

      <section className="retreat-notice-scene" aria-hidden="true">
        <div className="retreat-notice-scene__sky" />
        <div className="retreat-notice-scene__hills retreat-notice-scene__hills--back" />
        <div className="retreat-notice-scene__hills retreat-notice-scene__hills--front" />
        <div className="retreat-notice-scene__lake" />
        <div className="retreat-notice-scene__shore" />
        <div className="notice-jesus" data-motion={settings.animationPlaying ? 'play' : 'pause'}>
          <span className="notice-jesus__halo" />
          <span className="notice-jesus__head" />
          <span className="notice-jesus__robe" />
          <span className="notice-jesus__sash" />
          <span className="notice-jesus__arm notice-jesus__arm--left" />
          <span className="notice-jesus__arm notice-jesus__arm--right" />
        </div>
        <div className="notice-campfire" data-motion={settings.animationPlaying ? 'play' : 'pause'}>
          <span className="notice-campfire__glow" />
          <span className="notice-campfire__flame notice-campfire__flame--back" />
          <span className="notice-campfire__flame notice-campfire__flame--front" />
          <span className="notice-campfire__log notice-campfire__log--left" />
          <span className="notice-campfire__log notice-campfire__log--right" />
        </div>

        <div className="notice-character-row">
          {visibleGroups.map((group, index) => {
            const motion = actorMotion[group.id];
            return (
              <div
                className={`notice-character ${SLOT_CLASSES[index]}`}
                data-motion={settings.animationPlaying ? 'play' : 'pause'}
                data-behavior={motion?.moving ? 'walk' : 'idle'}
                style={{
                  '--motion-index': index,
                  left: `${motion?.x ?? NOTICE_START_X[index] ?? 50}%`,
                  right: 'auto',
                  bottom: `${motion?.y ?? 0}%`,
                } as CSSProperties}
                key={`${group.id}-${notice.rotation.order === 'selected' ? 'selected' : tick}`}
              >
                <RetreatCharacter
                  group={group}
                  animation={motion?.moving ? 'walk' : index % 3 === 0 ? 'wave' : 'idle'}
                  playing={settings.animationPlaying}
                  flipX={(motion?.direction ?? (index < 2 ? 1 : -1)) < 0}
                  className="notice-character__sprite"
                />
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
