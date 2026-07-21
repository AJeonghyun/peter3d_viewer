import { memo, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import { animationForState, isMovementState } from './stateMachine';
import { CharacterNameTag } from './CharacterNameTag';
import { SpriteAnimator } from './SpriteAnimator';
import { useCharacterMovement } from './useCharacterMovement';
import { useReducedMotion } from './useReducedMotion';
import { useVisibilityPause } from './useVisibilityPause';
import type { CharacterDefinition, CharacterState } from './types';

interface CharacterActorProps {
  character: CharacterDefinition;
  initialX: number;
  initialY?: number;
  targetX: number;
  state: CharacterState;
  scale?: number;
  showName?: boolean;
  onStateComplete?: (
    characterId: string,
    completedState: CharacterState,
  ) => void;
}

function CharacterActorComponent({
  character,
  initialX,
  initialY = 77,
  targetX,
  state,
  scale = 1,
  showName = false,
  onStateComplete,
}: CharacterActorProps) {
  const actorRef = useRef<HTMLElement>(null);
  const reducedMotion = useReducedMotion();
  const visible = useVisibilityPause(actorRef, false);
  const direction = targetX >= initialX ? 1 : -1;
  const animation = animationForState(state);
  const movementComplete = useMemo(
    () => () => onStateComplete?.(character.id, state),
    [character.id, onStateComplete, state],
  );
  useCharacterMovement({
    actorRef,
    state,
    initialX,
    targetX,
    reducedMotion,
    playing: visible,
    onComplete: movementComplete,
  });

  const actorStyle = {
    '--character-x': initialX,
    '--character-y': `${initialY}%`,
    '--character-scale': scale,
    '--travel-direction': direction,
  } as CSSProperties;

  const oneShot = !character.animations[animation].loop;
  const animationComplete = oneShot
    ? () => onStateComplete?.(character.id, state)
    : undefined;

  return (
    <article
      ref={actorRef}
      className="character-actor"
      data-state={state}
      data-moving={isMovementState(state) ? 'true' : 'false'}
      data-direction={direction < 0 ? 'left' : 'right'}
      data-character-id={character.id}
      style={actorStyle}
      aria-label={`${character.group} ${character.name}`}
    >
      <div className="character-actor__shadow" />
      <div className="character-actor__figure">
        <SpriteAnimator
          character={character}
          animation={animation}
          flipX={direction < 0}
          playing={state !== 'offscreen'}
          speedMultiplier={reducedMotion ? 3 : 1}
          onAnimationEnd={animationComplete}
        />
      </div>
      <CharacterNameTag character={character} visible={showName} />
    </article>
  );
}

export const CharacterActor = memo(CharacterActorComponent);
