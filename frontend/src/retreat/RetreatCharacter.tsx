import { memo, useEffect, useMemo, useState } from 'react';
import { createPeterAnimations, peterAnimations } from '../spriteLab/data';
import { SpriteAnimator } from '../spriteLab/SpriteAnimator';
import type { AnimationName, CharacterDefinition } from '../spriteLab/types';
import { AtlasSpriteAnimator } from './AtlasSpriteAnimator';
import { loadSpriteAsset } from './persistence';
import { RETREAT_POSES, type RetreatPoseId } from './scenePoses';
import type { RetreatGroup } from './types';

const EXPANDED_MASTER_URL = '/api/showcase/fixed-master';
const CAMPFIRE_MASTER_CONTRACT = {
  id: 'fixed-peter-master-edit-v5',
  version: 5,
  layout: '5x5',
  rows: 5,
  columns: 5,
  frame_count: 25,
} as const;
const V6_MASTER_CONTRACT = {
  id: 'fixed-peter-master-edit-v6',
  version: 6,
  layout: '8x4',
  rows: 4,
  columns: 8,
  frame_count: 32,
} as const;
const CURRENT_MASTER_CONTRACT = {
  id: 'fixed-peter-master-edit-v7',
  version: 7,
  layout: '8x4',
  rows: 4,
  columns: 8,
  frame_count: 32,
} as const;

function supportsCampfirePoses(contract: RetreatGroup['spriteAtlasContract']) {
  const version = Number(contract?.version);
  return version >= CAMPFIRE_MASTER_CONTRACT.version
    || contract?.id === CAMPFIRE_MASTER_CONTRACT.id;
}

function supportsExpandedMaster(contract: RetreatGroup['spriteAtlasContract']) {
  const version = Number(contract?.version);
  return version === V6_MASTER_CONTRACT.version
    || contract?.id === V6_MASTER_CONTRACT.id;
}

function supportsCurrentMaster(contract: RetreatGroup['spriteAtlasContract']) {
  const version = Number(contract?.version);
  return version >= CURRENT_MASTER_CONTRACT.version
    || contract?.id === CURRENT_MASTER_CONTRACT.id;
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
  const currentGroupAtlas = supportsCurrentMaster(group.spriteAtlasContract);
  const expandedGroupAtlas = supportsExpandedMaster(group.spriteAtlasContract);
  const needsCampfireFrames = pose
    ? pose.legacyFrames.some((frame) => frame >= 19)
    : fixedFrame !== undefined && fixedFrame >= 19;
  const groupAtlasSupportsPose = pose
    ? currentGroupAtlas || (
      (expandedGroupAtlas ? pose.expandedFrames : pose.legacyFrames).length > 0
      && (!needsCampfireFrames || supportsCampfirePoses(group.spriteAtlasContract))
    )
    : !needsCampfireFrames || supportsCampfirePoses(group.spriteAtlasContract);
  const useGroupAtlas = Boolean(group.spriteAtlasUrl)
    && groupAtlasSupportsPose;
  const atlasUrl = useGroupAtlas
    ? group.spriteAtlasUrl || EXPANDED_MASTER_URL
    : EXPANDED_MASTER_URL;
  const legacySmallPoseScale = expandedGroupAtlas
    && (resolvedPoseId === 'jump' || resolvedPoseId === 'pray' || resolvedPoseId === 'point')
    ? 1.45
    : 1;
  const atlasContract = useGroupAtlas
    ? {
        ...group.spriteAtlasContract,
        display_scale: Number(group.spriteAtlasContract?.display_scale ?? 1) * legacySmallPoseScale,
      }
    : CURRENT_MASTER_CONTRACT;
  const poseSequence = pose
    ? useGroupAtlas
      ? currentGroupAtlas
        ? pose.currentFrames
        : expandedGroupAtlas
          ? pose.expandedFrames
          : pose.legacyFrames
      : pose.currentFrames
    : undefined;
  const fallbackFixedFrame = fixedFrame === 19
    ? 27
    : fixedFrame === 21
      ? 29
      : fixedFrame === 23
        ? 28
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
