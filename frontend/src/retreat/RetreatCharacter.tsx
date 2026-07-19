import { memo, useEffect, useMemo, useState } from 'react';
import { createPeterAnimations, peterAnimations } from '../spriteLab/data';
import { SpriteAnimator } from '../spriteLab/SpriteAnimator';
import type { AnimationName, CharacterDefinition } from '../spriteLab/types';
import { loadSpriteAsset } from './persistence';
import type { RetreatGroup } from './types';

interface RetreatCharacterProps {
  group: RetreatGroup;
  animation?: AnimationName;
  playing?: boolean;
  flipX?: boolean;
  respectReducedMotion?: boolean;
  className?: string;
}

function RetreatCharacterComponent({
  group,
  animation = group.defaultAnimation,
  playing = true,
  flipX = false,
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

  return (
    <div
      className={`retreat-character ${className}`.trim()}
      style={{ transform: `scale(${group.scale})` }}
      data-group-id={group.id}
      data-animation={animation}
    >
      {singleImage ? (
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
