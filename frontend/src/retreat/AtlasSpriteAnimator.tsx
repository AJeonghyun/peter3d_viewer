import { memo, useEffect, useState, type CSSProperties } from 'react';
import { prepareSpriteAtlas } from '../showcase/spriteAtlas';
import type { AnimationName } from '../spriteLab/types';
import type { ShowcaseSpriteContract } from '../types/api';

interface AtlasSpriteAnimatorProps {
  spriteUrl: string;
  animation: AnimationName;
  fixedFrame?: number;
  frameSequence?: readonly number[];
  playing?: boolean;
  flipX?: boolean;
  label: string;
  className?: string;
  prepared?: boolean;
  contract?: ShowcaseSpriteContract | null;
  layout?: 'legacy-4x3' | 'fixed-5x5' | 'retreat-7x1';
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

function isRetreatMasterContract(contract?: ShowcaseSpriteContract | null) {
  return contract?.id === 'retreat-live-master-v1'
    || contract?.layout === '7x1'
    || (contract?.rows === 1 && contract?.columns === 7);
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
  frameSequence,
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
  const retreatMaster = layout === 'retreat-7x1' || isRetreatMasterContract(contract);
  const gridAtlas = fixedMaster || retreatMaster;
  const columns = gridAtlas ? Number(contract?.columns ?? (retreatMaster ? 7 : 5)) : 4;
  const rows = gridAtlas ? Number(contract?.rows ?? (retreatMaster ? 1 : 5)) : 3;
  const maxFrame = Math.max(0, columns * rows - 1);
  const sequence = frameSequence?.length
    ? frameSequence.map((value) => Math.max(0, Math.min(maxFrame, Math.round(value))))
    : fixedMaster && fixedFrame !== undefined
      ? [Math.max(0, Math.min(maxFrame, Math.round(fixedFrame)))]
      : retreatMaster
        ? animation === 'idle' ? [0, 1] : animation === 'wave' ? [2] : [0]
        : FIXED_MASTER_SEQUENCES[animation] ?? FIXED_MASTER_SEQUENCES.idle;
  const sequenceKey = sequence.join(',');
  const frame = sequence[frameOffset % sequence.length] ?? 0;
  const column = frame % columns;
  const row = Math.floor(frame / columns);
  const displayScale = gridAtlas
    ? Math.min(1.6, Math.max(0.8, contract?.display_scale ?? 1))
    : 1;

  useEffect(() => {
    let active = true;
    setFailed(false);
    setPreparedUrl('');
    if (prepared || gridAtlas) {
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
  }, [gridAtlas, prepared, spriteUrl]);

  useEffect(() => {
    setFrameOffset(0);
  }, [animation, fixedFrame, sequenceKey, spriteUrl]);

  useEffect(() => {
    if (!gridAtlas || !playing || sequence.length <= 1) return undefined;
    const timer = window.setInterval(() => {
      setFrameOffset((current) => current + 1);
    }, frameDurationMs(animation));
    return () => window.clearInterval(timer);
  }, [animation, gridAtlas, playing, sequence.length]);

  const style = {
    '--atlas-row': gridAtlas ? row : animationRow(animation),
    '--atlas-column': gridAtlas ? column : 0,
    '--atlas-columns': columns,
    '--atlas-rows': rows,
    '--atlas-position-x': `${columns > 1 ? (column / (columns - 1)) * 100 : 0}%`,
    '--atlas-position-y': `${rows > 1 ? (row / (rows - 1)) * 100 : 0}%`,
    '--atlas-flip': flipX ? -1 : 1,
    '--atlas-display-scale': displayScale,
    '--atlas-image': preparedUrl ? `url(${JSON.stringify(preparedUrl)})` : 'none',
  } as CSSProperties;

  return (
    <div
      className={`atlas-sprite-animator ${className}`.trim()}
      data-animation={animation}
      data-fixed-frame={fixedFrame}
      data-layout={retreatMaster ? 'retreat-7x1' : fixedMaster ? 'fixed-5x5' : 'legacy-4x3'}
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
