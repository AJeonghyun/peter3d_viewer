import { memo, useEffect, useMemo, useState } from 'react';
import { createPeterAnimations, peterAnimations } from '../spriteLab/data';
import { SpriteAnimator } from '../spriteLab/SpriteAnimator';
import type { AnimationName, CharacterDefinition } from '../spriteLab/types';
import { AtlasSpriteAnimator } from './AtlasSpriteAnimator';
import { loadSpriteAsset } from './persistence';
import { RETREAT_POSES, type RetreatPoseId } from './scenePoses';
import type { RetreatGroup } from './types';

const RETREAT_MASTER_URL = '/assets/retreat/peter-retreat-master.png';
const CAMPFIRE_MASTER_CONTRACT = {
  id: 'fixed-peter-master-edit-v5',
  version: 5,
  layout: '5x5',
  rows: 5,
  columns: 5,
  frame_count: 25,
} as const;
const RETREAT_MASTER_CONTRACT = {
  id: 'retreat-live-master-v1',
  version: 1,
  layout: '7x1',
  rows: 1,
  columns: 7,
  frame_count: 7,
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
  poseId?: RetreatPoseId;
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
  poseId,
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
  const resolvedPoseId = poseId ?? (view === 'back' ? 'back' : undefined);
  const pose = resolvedPoseId ? RETREAT_POSES[resolvedPoseId] : null;
  const needsRetreatMaster = resolvedPoseId === 'back';
  const needsCampfireFrames = pose
    ? pose.legacyFrames.some((frame) => frame >= 19)
    : fixedFrame !== undefined && fixedFrame >= 19;
  const useGroupAtlas = Boolean(group.spriteAtlasUrl)
    && !needsRetreatMaster
    && (!needsCampfireFrames || supportsCampfirePoses(group.spriteAtlasContract));
  const atlasUrl = useGroupAtlas
    ? group.spriteAtlasUrl || RETREAT_MASTER_URL
    : RETREAT_MASTER_URL;
  const atlasContract = useGroupAtlas ? group.spriteAtlasContract : RETREAT_MASTER_CONTRACT;
  const poseSequence = pose
    ? useGroupAtlas ? pose.legacyFrames : pose.retreatFrames
    : undefined;
  const fallbackFixedFrame = fixedFrame === 19
    ? 3
    : fixedFrame === 21
      ? 4
      : fixedFrame === 23
        ? 5
        : fixedFrame;
  const resolvedFixedFrame = useGroupAtlas ? fixedFrame : fallbackFixedFrame;
  const resolvedAnimation = pose?.animation ?? animation;

  return (
    <div
      className={`retreat-character ${className}`.trim()}
      style={{ transform: `scale(${group.scale})` }}
      data-group-id={group.id}
      data-animation={resolvedAnimation}
    >
      {pose || group.spriteAtlasUrl || fixedFrame !== undefined ? (
        <AtlasSpriteAnimator
          spriteUrl={atlasUrl}
          animation={resolvedAnimation}
          fixedFrame={resolvedFixedFrame}
          frameSequence={poseSequence}
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
