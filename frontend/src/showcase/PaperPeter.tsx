import { memo, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Team } from '../types/api';
import { peterAnimations } from '../spriteLab/data';
import { SpriteAnimator } from '../spriteLab/SpriteAnimator';
import type { AnimationName, CharacterDefinition } from '../spriteLab/types';
import { AtlasSpriteAnimator } from '../retreat/AtlasSpriteAnimator';
import { prepareCharacterImage } from './characterImage';
import { prepareSpriteAtlas } from './spriteAtlas';
import type { PreparedSpriteAtlas } from './spriteAtlas';

export type ActorPhase = 'entering' | 'arriving' | 'active' | 'exiting';

export interface StageSlot {
  id: number;
  x: number;
  y: number;
  scale: number;
  layer: number;
  roam?: number;
}

interface PaperPeterProps {
  team: Team;
  phase: ActorPhase;
  slot: StageSlot;
  layout?: 'gallery' | 'tier';
  compact?: boolean;
}

const SAMPLE_CHARACTER_URL = '/assets/showcase/peter-template.png';
const WALK_SPEED_PX_PER_SECOND = 24;
const PRESET_CHARACTER: CharacterDefinition = {
  id: 'peter-preset',
  name: '베드로',
  group: '',
  animations: peterAnimations,
};

function isFixedMasterContract(team: Team) {
  if (!team.showcase_sprite_active_version_id) return false;
  const contract = team.showcase_sprite_contract;
  return contract?.version === 2
    || contract?.version === '2'
    || contract?.layout === '5x5'
    || (contract?.rows === 5 && contract?.columns === 5)
    || contract?.frame_count === 25;
}

function PaperPeterComponent({
  team,
  phase,
  slot,
  layout = 'gallery',
  compact = false,
}: PaperPeterProps) {
  const source = team.showcase_image_url || team.image_url || SAMPLE_CHARACTER_URL;
  const [imageSource, setImageSource] = useState(SAMPLE_CHARACTER_URL);
  const [nicknameSource, setNicknameSource] = useState<string | null>(null);
  const [sprite, setSprite] = useState<PreparedSpriteAtlas | null>(null);
  const [gesture, setGesture] = useState<'idle' | 'wave' | 'step'>('idle');
  const [roamOffset, setRoamOffset] = useState(0);
  const [walkDuration, setWalkDuration] = useState(1.8);
  const [travelDirection, setTravelDirection] = useState<1 | -1>(
    team.id % 2 === 0 ? 1 : -1,
  );

  useEffect(() => {
    let active = true;
    void prepareCharacterImage(source).then((prepared) => {
      if (!active) return;
      setImageSource(prepared.characterUrl);
      setNicknameSource(prepared.nicknameUrl);
    });
    return () => { active = false; };
  }, [source]);

  useEffect(() => {
    let active = true;
    const spriteUrl = team.showcase_sprite_active_version_id
      ? team.showcase_sprite_active_url
      : '';
    if (!spriteUrl) {
      setSprite(null);
      return () => { active = false; };
    }
    if (isFixedMasterContract(team)) {
      setSprite({
        url: spriteUrl,
        cellAspect: 1,
      });
      return () => { active = false; };
    }
    void prepareSpriteAtlas(spriteUrl).then((prepared) => {
      if (active) setSprite(prepared);
    });
    return () => { active = false; };
  }, [team]);

  useEffect(() => {
    if (phase !== 'active') {
      setGesture('idle');
      setRoamOffset(0);
      return undefined;
    }
    let actionTimer: number | undefined;
    let actionEndTimer: number | undefined;
    let currentOffset = 0;
    let nextDirection: 1 | -1 = team.id % 2 === 0 ? 1 : -1;

    const schedule = () => {
      actionTimer = window.setTimeout(() => {
        const canRoam = layout === 'tier' && Boolean(slot.roam);
        const nextGesture = canRoam && Math.random() < 0.72
          ? 'step'
          : 'wave';
        let actionDuration = 1800;

        if (nextGesture === 'step') {
          const roamPixels = Math.round(
            ((slot.roam ?? 0) * window.innerWidth) / 100,
          );
          const nextOffset = nextDirection * roamPixels;
          const distance = Math.abs(nextOffset - currentOffset);
          actionDuration = Math.round(Math.min(
            2800,
            Math.max(900, (distance / WALK_SPEED_PX_PER_SECOND) * 1000),
          ));
          setTravelDirection(nextOffset > currentOffset ? 1 : -1);
          setWalkDuration(actionDuration / 1000);
          setRoamOffset(nextOffset);
          currentOffset = nextOffset;
          nextDirection = nextDirection === 1 ? -1 : 1;
        }

        setGesture(nextGesture);
        actionEndTimer = window.setTimeout(() => {
          setGesture('idle');
          schedule();
        }, actionDuration);
      }, 2200 + Math.random() * 3600);
    };

    schedule();
    return () => {
      if (actionTimer) window.clearTimeout(actionTimer);
      if (actionEndTimer) window.clearTimeout(actionEndTimer);
    };
  }, [layout, phase, slot.roam, team.id]);

  const usePresetSprite = layout === 'tier' && !sprite;
  const presetAnimation: AnimationName = phase !== 'active' || gesture === 'step'
    ? 'walk'
    : gesture === 'wave' ? 'wave' : 'idle';
  const actorStyle = {
    '--actor-x': `${slot.x}%`,
    '--actor-y': `${slot.y}%`,
    '--actor-scale': slot.scale,
    '--actor-layer': slot.layer,
    '--team-color': team.color,
    '--motion-delay': `${-(team.id % 7) * 0.11}s`,
    '--travel-direction': travelDirection,
    '--roam-x': `${roamOffset}px`,
    '--walk-duration': `${walkDuration}s`,
    '--entry-x': slot.x < 50 ? '-72vw' : '72vw',
    '--exit-x': slot.x < 50 ? '72vw' : '-72vw',
    '--sprite-cell-ratio': sprite?.cellAspect ?? 1,
    '--sprite-row': phase === 'active'
      ? gesture === 'wave' ? 2 : gesture === 'step' ? 1 : 0
      : 1,
  } as CSSProperties;

  return (
    <article
      className="paper-peter"
      data-phase={phase}
      data-gesture={gesture}
      data-render={sprite ? 'sprite' : usePresetSprite ? 'preset' : 'paper'}
      data-layout={layout}
      data-compact={compact ? 'true' : 'false'}
      data-direction={travelDirection < 0 ? 'left' : 'right'}
      style={actorStyle}
      aria-label={`${team.name} 베드로`}
    >
      {sprite ? (
        <div className="sprite-peter__figure">
          <AtlasSpriteAnimator
            spriteUrl={sprite.url}
            animation={presetAnimation}
            flipX={travelDirection < 0}
            playing={phase !== 'exiting'}
            prepared
            contract={team.showcase_sprite_active_version_id
              ? team.showcase_sprite_contract
              : null}
            label={`${team.name}의 AI 게임 캐릭터`}
          />
        </div>
      ) : usePresetSprite ? (
        <div className="preset-peter__figure" role="img" aria-label={`${team.name}의 게임 캐릭터`}>
          <SpriteAnimator
            character={PRESET_CHARACTER}
            animation={presetAnimation}
            flipX={travelDirection < 0}
            playing={phase !== 'exiting'}
          />
        </div>
      ) : (
        <div className="paper-peter__figure" role="img" aria-label={`${team.name}에서 만든 베드로`}>
          <img className="paper-peter__part paper-peter__left-leg" src={imageSource} alt="" />
          <img className="paper-peter__part paper-peter__right-leg" src={imageSource} alt="" />
          <img className="paper-peter__part paper-peter__left-arm" src={imageSource} alt="" />
          <img className="paper-peter__part paper-peter__right-arm" src={imageSource} alt="" />
          <img className="paper-peter__part paper-peter__torso" src={imageSource} alt="" />
          <img className="paper-peter__part paper-peter__head" src={imageSource} alt="" />
        </div>
      )}
      <div className="paper-peter__name" data-has-art={nicknameSource ? 'true' : 'false'}>
        {nicknameSource
          ? <img src={nicknameSource} alt={`${team.name}에서 만든 닉네임창`} />
          : <span>{team.name}</span>}
      </div>
    </article>
  );
}

export const PaperPeter = memo(PaperPeterComponent);
