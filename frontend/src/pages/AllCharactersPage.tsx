import { useEffect, useMemo, useRef, useState } from 'react';
import { RetreatCharacter } from '../retreat/RetreatCharacter';
import { useRetreat } from '../retreat/RetreatProvider';
import {
  RetreatPhysicsWorld,
  createRetreatPlatforms,
  createRetreatRopes,
  type RetreatPhysicsWorldSnapshot,
} from '../retreat/physicsWorld';
import type { RetreatGroup } from '../retreat/types';
import '../styles/retreat-world.css';

interface AllCharactersPageProps {
  preview?: boolean;
}

const EMPTY_SNAPSHOT: RetreatPhysicsWorldSnapshot = {
  actors: [],
  platforms: [],
  ropes: [],
};

function useStageSize() {
  const ref = useRef<HTMLElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const update = () => {
      const bounds = node.getBoundingClientRect();
      setSize({
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { ref, size };
}

export function AllCharactersWorld({ preview = false }: AllCharactersPageProps) {
  const { settings, updateSettings } = useRetreat();
  const { ref, size } = useStageSize();
  const worldRef = useRef<RetreatPhysicsWorld | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [localPaused, setLocalPaused] = useState(false);
  const [snapshot, setSnapshot] = useState<RetreatPhysicsWorldSnapshot>(EMPTY_SNAPSHOT);

  const enabledGroups = useMemo(
    () => settings.groups.filter((group) => group.enabled).slice(0, 21),
    [settings.groups],
  );
  const groupsById = useMemo(
    () => new Map(enabledGroups.map((group) => [group.id, group])),
    [enabledGroups],
  );
  const platforms = useMemo(
    () => size.width > 0 && size.height > 0
      ? createRetreatPlatforms(size.width, size.height, settings.world.safeZoneHeight)
      : [],
    [settings.world.safeZoneHeight, size.height, size.width],
  );
  const ropes = useMemo(() => createRetreatRopes(platforms), [platforms]);
  const playing = settings.animationPlaying
    && settings.world.physicsEnabled
    && !localPaused
    && enabledGroups.length > 0;

  useEffect(() => {
    document.title = '페이지 3 | 전체 조 물리 월드';
  }, []);

  useEffect(() => {
    if (!size.width || !size.height || !platforms.length) return undefined;
    worldRef.current?.dispose();
    const world = new RetreatPhysicsWorld(enabledGroups, platforms, ropes, settings.world);
    worldRef.current = world;
    setSnapshot(world.snapshot());
    return () => {
      world.dispose();
      if (worldRef.current === world) worldRef.current = null;
    };
  }, [enabledGroups, platforms, ropes, size.height, size.width]);

  useEffect(() => {
    worldRef.current?.setSettings(settings.world);
  }, [settings.world]);

  useEffect(() => {
    const prepareCapture = (event: Event) => {
      const mode = (event as CustomEvent<{ mode?: 'paused' | 'balanced' }>).detail?.mode;
      if (mode) worldRef.current?.prepareCapture(mode);
      if (worldRef.current) setSnapshot(worldRef.current.snapshot());
    };
    const restoreCapture = () => {
      worldRef.current?.restoreAfterCapture();
      if (worldRef.current) setSnapshot(worldRef.current.snapshot());
    };
    window.addEventListener('retreat:prepare-capture', prepareCapture);
    window.addEventListener('retreat:restore-capture', restoreCapture);
    return () => {
      window.removeEventListener('retreat:prepare-capture', prepareCapture);
      window.removeEventListener('retreat:restore-capture', restoreCapture);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        event.preventDefault();
        setLocalPaused((current) => !current);
        return;
      }
      if (event.key.toLowerCase() === 'p') {
        updateSettings((current) => ({
          ...current,
          animationPlaying: !current.animationPlaying,
        }));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [updateSettings]);

  useEffect(() => {
    const tick = (timestamp: number) => {
      const world = worldRef.current;
      if (world) {
        world.step(timestamp, playing);
        setSnapshot(world.snapshot());
      }
      animationFrameRef.current = window.requestAnimationFrame(tick);
    };
    animationFrameRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [playing]);

  return (
    <main
      ref={ref}
      className="retreat-world"
      data-display-page="all-characters"
      data-preview={preview ? 'true' : 'false'}
      data-paused={playing ? 'false' : 'true'}
      aria-label="스물한 조 베드로 전체 캐릭터 물리 월드"
    >
      <div
        className="retreat-world__safe-zone"
        style={{ height: `${settings.world.safeZoneHeight}%` }}
        aria-hidden="true"
      />
      <header className="retreat-world__title">
        <p>{settings.world.verse}</p>
        <h1>{settings.world.title}</h1>
        {settings.world.caption ? <strong>{settings.world.caption}</strong> : null}
      </header>
      <div className="retreat-world__sky" aria-hidden="true" />
      <div className="retreat-world__ropes" aria-hidden="true">
        {snapshot.ropes.map((rope) => (
          <span
            key={rope.id}
            className="retreat-world__rope"
            style={{
              left: rope.x,
              top: rope.yTop,
              height: Math.max(0, rope.yBottom - rope.yTop),
            }}
          />
        ))}
      </div>
      <div className="retreat-world__platforms" aria-hidden="true">
        {snapshot.platforms.map((platform) => (
          <div
            key={platform.id}
            className="retreat-world__platform"
            data-platform={platform.id}
            style={{
              left: platform.xStart,
              top: platform.y,
              width: platform.xEnd - platform.xStart,
              height: platform.thickness,
            }}
          >
            {platform.holeZones.map((hole) => (
              <span
                key={hole.id}
                className="retreat-world__hole"
                style={{
                  left: hole.xStart - platform.xStart,
                  width: hole.xEnd - hole.xStart,
                }}
              />
            ))}
          </div>
        ))}
      </div>
      <section className="retreat-world__actors" aria-label="플랫폼 위 전체 조 캐릭터">
        {snapshot.actors.map((actor) => {
          const group = groupsById.get(actor.groupId) as RetreatGroup | undefined;
          if (!group) return null;
          return (
            <div
              key={actor.id}
              className="retreat-world__actor"
              data-state={actor.state}
              data-platform={actor.platformId}
              style={{
                left: actor.x,
                top: actor.y,
                zIndex: actor.zIndex,
                transform: `translate3d(-50%, -100%, 0) rotate(${actor.rotation}rad)`,
                '--group-accent': group.accentColor,
              } as React.CSSProperties}
            >
              <RetreatCharacter
                group={group}
                animation={actor.animation}
                playing={playing}
                flipX={actor.flipX}
                className="retreat-world__character"
              />
              <span className="retreat-world__badge">{actor.groupNumber}</span>
            </div>
          );
        })}
      </section>
    </main>
  );
}

export default AllCharactersWorld;
