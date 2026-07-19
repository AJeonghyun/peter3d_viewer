import { PixelMotion } from '@ga1az/react-pixel-motion';
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useVisibilityPause } from './useVisibilityPause';
import { useReducedMotion } from './useReducedMotion';
import type { AnimationName, CharacterDefinition } from './types';

interface SpriteAnimatorProps {
  character: CharacterDefinition;
  animation: AnimationName;
  width?: number | string;
  speedMultiplier?: number;
  flipX?: boolean;
  playing?: boolean;
  respectReducedMotion?: boolean;
  onAnimationEnd?: () => void;
}

function SpriteAnimatorComponent({
  character,
  animation,
  width = '100%',
  speedMultiplier = 1,
  flipX = false,
  playing = true,
  respectReducedMotion = true,
  onAnimationEnd,
}: SpriteAnimatorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const visible = useVisibilityPause(rootRef);
  const reducedMotion = useReducedMotion();
  const definition = character.animations[animation];
  const [failed, setFailed] = useState(false);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => setFailed(false);
    image.onerror = () => {
      console.warn(`스프라이트 시트를 불러오지 못했습니다: ${definition.sprite}`);
      setFailed(true);
    };
    image.src = definition.sprite;
    return () => {
      image.onload = null;
      image.onerror = null;
    };
  }, [definition.sprite]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const updateScale = () => {
      const { width: availableWidth, height: availableHeight } = root.getBoundingClientRect();
      const nextScale = Math.min(
        availableWidth / definition.frameWidth,
        availableHeight / definition.frameHeight,
      );
      setScale(Number.isFinite(nextScale) && nextScale > 0 ? nextScale : 1);
    };
    updateScale();

    const observer = new ResizeObserver(updateScale);
    observer.observe(root);
    return () => observer.disconnect();
  }, [definition.frameHeight, definition.frameWidth]);

  const staticOneShot = !definition.loop && definition.frameCount === 1;
  useEffect(() => {
    if (!staticOneShot || !playing || !visible || !onAnimationEnd) return undefined;
    const timeout = window.setTimeout(
      onAnimationEnd,
      (definition.durationMs ?? 1_000) / Math.max(0.1, speedMultiplier),
    );
    return () => window.clearTimeout(timeout);
  }, [
    animation,
    definition.durationMs,
    onAnimationEnd,
    playing,
    speedMultiplier,
    staticOneShot,
    visible,
  ]);

  const style = {
    width,
    '--sprite-flip': flipX ? -1 : 1,
  } as CSSProperties;
  const shouldAnimate = playing
    && visible
    && (!respectReducedMotion || !reducedMotion)
    && definition.frameCount > 1;

  return (
    <div
      ref={rootRef}
      className="sprite-animator"
      style={style}
      data-animation={animation}
    >
      {failed ? (
        <div className="sprite-animator__fallback" role="img" aria-label={`${character.name} 이미지 없음`}>
          <span>이미지 없음</span>
        </div>
      ) : (
        <div className="sprite-animator__motion" aria-hidden="true">
          <PixelMotion
            key={animation}
            sprite={definition.sprite}
            width={definition.frameWidth}
            height={definition.frameHeight}
            frameCount={definition.frameCount}
            fps={definition.fps * Math.max(0.1, speedMultiplier)}
            scale={scale}
            direction="horizontal"
            shouldAnimate={shouldAnimate}
            loop={definition.loop}
            imageRendering={false}
            onAnimationEnd={staticOneShot ? undefined : onAnimationEnd}
          />
        </div>
      )}
    </div>
  );
}

export const SpriteAnimator = memo(SpriteAnimatorComponent);
