import { memo, useEffect, useState, type CSSProperties } from 'react';
import { prepareSpriteAtlas } from '../showcase/spriteAtlas';
import type { AnimationName } from '../spriteLab/types';

interface AtlasSpriteAnimatorProps {
  spriteUrl: string;
  animation: AnimationName;
  playing?: boolean;
  flipX?: boolean;
  label: string;
  className?: string;
  prepared?: boolean;
}

function animationRow(animation: AnimationName) {
  if (animation === 'walk' || animation === 'run') return 1;
  if (animation === 'idle') return 0;
  return 2;
}

function AtlasSpriteAnimatorComponent({
  spriteUrl,
  animation,
  playing = true,
  flipX = false,
  label,
  className = '',
  prepared = false,
}: AtlasSpriteAnimatorProps) {
  const [preparedUrl, setPreparedUrl] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setFailed(false);
    setPreparedUrl('');
    if (prepared) {
      setPreparedUrl(spriteUrl);
      return () => {
        active = false;
      };
    }
    void prepareSpriteAtlas(spriteUrl).then((prepared) => {
      if (active) setPreparedUrl(prepared.url);
    }).catch((error: unknown) => {
      console.warn('AI 스프라이트 시트를 준비하지 못했습니다.', error);
      if (active) setFailed(true);
    });
    return () => {
      active = false;
    };
  }, [prepared, spriteUrl]);

  const style = {
    '--atlas-row': animationRow(animation),
    '--atlas-flip': flipX ? -1 : 1,
    '--atlas-image': preparedUrl ? `url(${JSON.stringify(preparedUrl)})` : 'none',
  } as CSSProperties;

  return (
    <div
      className={`atlas-sprite-animator ${className}`.trim()}
      data-animation={animation}
      data-playing={playing ? 'true' : 'false'}
      data-ready={preparedUrl ? 'true' : 'false'}
      style={style}
      role="img"
      aria-label={label}
    >
      {failed ? (
        <span className="atlas-sprite-animator__fallback">이미지 없음</span>
      ) : (
        <div className="atlas-sprite-animator__motion" aria-hidden="true">
          <div className="atlas-sprite-animator__safe-frame" />
        </div>
      )}
    </div>
  );
}

export const AtlasSpriteAnimator = memo(AtlasSpriteAnimatorComponent);
