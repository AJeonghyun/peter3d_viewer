import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { isMovementState } from './stateMachine';
import type { CharacterState } from './types';

interface CharacterMovementOptions {
  actorRef: RefObject<HTMLElement | null>;
  state: CharacterState;
  initialX: number;
  targetX: number;
  reducedMotion: boolean;
  playing: boolean;
  onComplete?: () => void;
}

const SPEED_BY_STATE: Partial<Record<CharacterState, number>> = {
  entering: 22,
  walking: 12,
  running: 24,
  exiting: 24,
};

export function useCharacterMovement({
  actorRef,
  state,
  initialX,
  targetX,
  reducedMotion,
  playing,
  onComplete,
}: CharacterMovementOptions) {
  const xRef = useRef(initialX);
  const callbackRef = useRef(onComplete);
  callbackRef.current = onComplete;

  useEffect(() => {
    xRef.current = initialX;
  }, [initialX]);

  useEffect(() => {
    const element = actorRef.current;
    if (!element) return undefined;
    const writePosition = () => {
      element.style.setProperty('--character-x', String(xRef.current));
    };
    writePosition();
    if (!isMovementState(state) || !playing) return undefined;

    if (reducedMotion) {
      xRef.current = targetX;
      writePosition();
      callbackRef.current?.();
      return undefined;
    }

    let frame = 0;
    let previousTime: number | null = null;
    const speed = SPEED_BY_STATE[state] ?? 12;
    const direction = targetX >= xRef.current ? 1 : -1;

    const update = (time: number) => {
      if (previousTime === null) previousTime = time;
      const deltaSeconds = Math.min((time - previousTime) / 1000, 0.05);
      previousTime = time;
      const remaining = Math.abs(targetX - xRef.current);
      const step = speed * deltaSeconds;
      if (remaining <= step) {
        xRef.current = targetX;
        writePosition();
        callbackRef.current?.();
        return;
      }
      xRef.current += step * direction;
      writePosition();
      frame = window.requestAnimationFrame(update);
    };

    frame = window.requestAnimationFrame(update);
    return () => window.cancelAnimationFrame(frame);
  }, [actorRef, playing, reducedMotion, state, targetX]);

  return xRef;
}
