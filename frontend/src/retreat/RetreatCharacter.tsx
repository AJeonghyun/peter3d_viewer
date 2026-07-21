import { memo, useEffect, useMemo, useState } from 'react';
import { createPeterAnimations, peterAnimations } from '../spriteLab/data';
import { SpriteAnimator } from '../spriteLab/SpriteAnimator';
import type { AnimationName, CharacterDefinition } from '../spriteLab/types';
import { AtlasSpriteAnimator } from './AtlasSpriteAnimator';
import { loadSpriteAsset } from './persistence';
import type { RetreatGroup } from './types';

const FIXED_MASTER_URL = '/assets/peter-sober/peter-sober-master.png';
const BACK_VIEW_URL = '/assets/peter/frames/idle-back.png';
const CAMPFIRE_MASTER_CONTRACT = {
  id: 'fixed-peter-master-edit-v5',
  version: 5,
  layout: '5x5',
  rows: 5,
  columns: 5,
  frame_count: 25,
} as const;

function supportsCampfirePoses(contract: RetreatGroup['spriteAtlasContract']) {
  const version = Number(contract?.version);
  return version >= CAMPFIRE_MASTER_CONTRACT.version
    || contract?.id === CAMPFIRE_MASTER_CONTRACT.id;
}

interface RetreatCharacterProps {
  group: RetreatGroup;
  animation?: AnimationName;
  fixedFrame?: number;
  playing?: boolean;
  flipX?: boolean;
  view?: 'front' | 'back';
  respectReducedMotion?: boolean;
  className?: string;
}

function RetreatCharacterComponent({
  group,
  animation = group.defaultAnimation,
  fixedFrame,
  playing = true,
  flipX = false,
  view = 'front',
  respectReducedMotion = true,
  className = '',
}: RetreatCharacterProps) {
  const [uploadedUrl, setUploadedUrl] = useState('');

  useEffect(() => {
    if (!group.spriteAssetKey) {
      setUploadedUrl('');
      return undefined;
    }
    let active = true;
    let objectUrl = '';
    void loadSpriteAsset(group.spriteAssetKey).then((blob) => {
      if (!active || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setUploadedUrl(objectUrl);
    }).catch(console.warn);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [group.spriteAssetKey]);

  const character = useMemo<CharacterDefinition>(() => {
    const sprite = uploadedUrl || group.spriteSheetUrl;
    if (!sprite || group.spriteFrameCount <= 1) {
      const animations = group.spriteAnimationRoot
        ? createPeterAnimations(group.spriteAnimationRoot, { jump: 1 })
        : peterAnimations;
      return {
        id: group.id,
        name: group.displayName,
        group: group.groupName,
        animations,
      };
    }
    const customDefinition = {
      sprite,
      frameWidth: group.spriteFrameWidth,
      frameHeight: group.spriteFrameHeight,
      frameCount: group.spriteFrameCount,
      fps: group.spriteFps,
      loop: true,
    };
    return {
      id: group.id,
      name: group.displayName,
      group: group.groupName,
      animations: Object.fromEntries(
        Object.keys(peterAnimations).map((name) => [name, customDefinition]),
      ) as CharacterDefinition['animations'],
    };
  }, [group, uploadedUrl]);

  const singleImage = (uploadedUrl || group.spriteSheetUrl) && group.spriteFrameCount <= 1
    ? uploadedUrl || group.spriteSheetUrl
    : '';
  const useGroupAtlas = Boolean(group.spriteAtlasUrl)
    && (fixedFrame === undefined || supportsCampfirePoses(group.spriteAtlasContract));
  const atlasUrl = useGroupAtlas
    ? group.spriteAtlasUrl || FIXED_MASTER_URL
    : FIXED_MASTER_URL;
  const atlasContract = useGroupAtlas ? group.spriteAtlasContract : CAMPFIRE_MASTER_CONTRACT;

  return (
    <div
      className={`retreat-character ${className}`.trim()}
      style={{ transform: `scale(${group.scale})` }}
      data-group-id={group.id}
      data-animation={animation}
    >
      {view === 'back' ? (
        <img
          src={BACK_VIEW_URL}
          alt={`${group.groupName} 캐릭터 뒷모습`}
          style={{ transform: `scaleX(${flipX ? -1 : 1})` }}
        />
      ) : group.spriteAtlasUrl || fixedFrame !== undefined ? (
        <AtlasSpriteAnimator
          spriteUrl={atlasUrl}
          animation={animation}
          fixedFrame={fixedFrame}
          playing={playing}
          flipX={flipX}
          contract={atlasContract}
          label={`${group.groupName} 캐릭터`}
        />
      ) : singleImage ? (
        <img
          src={singleImage}
          alt={`${group.groupName} 캐릭터`}
          style={{ transform: `scaleX(${flipX ? -1 : 1})` }}
        />
      ) : (
        <SpriteAnimator
          character={character}
          animation={animation}
          playing={playing}
          flipX={flipX}
          respectReducedMotion={respectReducedMotion}
        />
      )}
    </div>
  );
}

export const RetreatCharacter = memo(RetreatCharacterComponent);
