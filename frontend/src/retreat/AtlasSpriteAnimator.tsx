import { memo, useEffect, useState, type CSSProperties } from 'react';
import { prepareSpriteAtlas } from '../showcase/spriteAtlas';
import type { AnimationName } from '../spriteLab/types';
import type { ShowcaseSpriteContract } from '../types/api';

interface AtlasSpriteAnimatorProps {
  spriteUrl: string;
  animation: AnimationName;
  fixedFrame?: number;
  playing?: boolean;
  flipX?: boolean;
  label: string;
  className?: string;
  prepared?: boolean;
  contract?: ShowcaseSpriteContract | null;
  layout?: 'legacy-4x3' | 'fixed-5x5';
}

const FIXED_MASTER_SEQUENCES: Record<AnimationName, number[]> = {
  idle: [0, 9],
  walk: [1, 2, 3, 4, 5, 6, 7, 8],
  run: [10, 11, 12, 13, 14, 15, 16, 17],
  wave: [18],
  jump: [20],
  kneel: [21],
  pray: [22],
  point: [24],
};

function isFixedMasterContract(contract?: ShowcaseSpriteContract | null) {
  if (!contract) return false;
  return contract.version === 2
    || contract.version === '2'
    || contract.layout === '5x5'
    || (contract.rows === 5 && contract.columns === 5)
    || contract.frame_count === 25;
}

function animationRow(animation: AnimationName) {
  if (animation === 'walk' || animation === 'run') return 1;
  if (animation === 'idle') return 0;
  return 2;
}

function frameDurationMs(animation: AnimationName) {
  if (animation === 'run') return 86;
  if (animation === 'walk') return 112;
  if (animation === 'idle') return 520;
  return 900;
}

function AtlasSpriteAnimatorComponent({
  spriteUrl,
  animation,
  fixedFrame,
  playing = true,
  flipX = false,
  label,
  className = '',
  prepared = false,
  contract = null,
  layout,
}: AtlasSpriteAnimatorProps) {
  const [preparedUrl, setPreparedUrl] = useState('');
  const [failed, setFailed] = useState(false);
  const [frameOffset, setFrameOffset] = useState(0);
  const fixedMaster = layout === 'fixed-5x5' || isFixedMasterContract(contract);
  const sequence = fixedMaster && fixedFrame !== undefined
    ? [Math.max(0, Math.min(24, Math.round(fixedFrame)))]
    : FIXED_MASTER_SEQUENCES[animation] ?? FIXED_MASTER_SEQUENCES.idle;
  const frame = sequence[frameOffset % sequence.length] ?? 0;
  const columns = fixedMaster ? 5 : 4;
  const rows = fixedMaster ? 5 : 3;
  const column = frame % columns;
  const row = Math.floor(frame / columns);
  const displayScale = fixedMaster
    ? Math.min(1.6, Math.max(0.8, contract?.display_scale ?? 1))
    : 1;

  useEffect(() => {
    let active = true;
    setFailed(false);
    setPreparedUrl('');
    if (prepared || fixedMaster) {
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
  }, [fixedMaster, prepared, spriteUrl]);

  useEffect(() => {
    setFrameOffset(0);
  }, [animation, fixedFrame, spriteUrl]);

  useEffect(() => {
    if (!fixedMaster || !playing || sequence.length <= 1) return undefined;
    const timer = window.setInterval(() => {
      setFrameOffset((current) => current + 1);
    }, frameDurationMs(animation));
    return () => window.clearInterval(timer);
  }, [animation, fixedMaster, playing, sequence.length]);

  const style = {
    '--atlas-row': fixedMaster ? row : animationRow(animation),
    '--atlas-column': fixedMaster ? column : 0,
    '--atlas-columns': columns,
    '--atlas-rows': rows,
    '--atlas-flip': flipX ? -1 : 1,
    '--atlas-display-scale': displayScale,
    '--atlas-image': preparedUrl ? `url(${JSON.stringify(preparedUrl)})` : 'none',
  } as CSSProperties;

  return (
    <div
      className={`atlas-sprite-animator ${className}`.trim()}
      data-animation={animation}
      data-fixed-frame={fixedFrame}
      data-layout={fixedMaster ? 'fixed-5x5' : 'legacy-4x3'}
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
