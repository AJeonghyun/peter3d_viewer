import { memo, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useSpriteAnimation } from './useSpriteAnimation';
import { useVisibilityPause } from './useVisibilityPause';
import type { AnimationName, CharacterDefinition } from './types';

interface SpriteAnimatorProps {
  character: CharacterDefinition;
  animation: AnimationName;
  width?: number | string;
  speedMultiplier?: number;
  flipX?: boolean;
  playing?: boolean;
  onAnimationEnd?: () => void;
}

function SpriteAnimatorComponent({
  character,
  animation,
  width = '100%',
  speedMultiplier = 1,
  flipX = false,
  playing = true,
  onAnimationEnd,
}: SpriteAnimatorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const visible = useVisibilityPause(rootRef);
  const definition = character.animations[animation];
  const [failed, setFailed] = useState(false);
  const frameIndex = useSpriteAnimation({
    definition,
    animationKey: animation,
    playing,
    visible,
    speedMultiplier,
    onAnimationEnd,
  });

  useEffect(() => {
    definition.frames.forEach((source) => {
      const image = new Image();
      image.decoding = 'async';
      image.src = source;
    });
  }, [definition.frames]);

  useEffect(() => {
    setFailed(false);
  }, [animation]);

  const style = {
    width,
    '--sprite-flip': flipX ? -1 : 1,
  } as CSSProperties;

  return (
    <div
      ref={rootRef}
      className="sprite-animator"
      style={style}
      data-animation={animation}
      data-frame={frameIndex}
    >
      {failed ? (
        <div className="sprite-animator__fallback" role="img" aria-label={`${character.name} 이미지 없음`}>
          <span>이미지 없음</span>
        </div>
      ) : (
        <img
          key={`${animation}-${frameIndex}`}
          src={definition.frames[frameIndex]}
          alt=""
          draggable={false}
          onError={() => {
            console.warn(`스프라이트 프레임을 불러오지 못했습니다: ${definition.frames[frameIndex]}`);
            setFailed(true);
          }}
        />
      )}
    </div>
  );
}

export const SpriteAnimator = memo(SpriteAnimatorComponent);
