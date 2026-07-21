import type { AnimationName, CharacterState } from './types';

const MOVEMENT_STATES = new Set<CharacterState>([
  'entering',
  'walking',
  'running',
  'exiting',
]);

const LOCKED_STATES = new Set<CharacterState>([
  'jumping',
  'waving',
  'praying',
  'kneeling',
  'pointing',
  'exiting',
]);

export function animationForState(state: CharacterState): AnimationName {
  switch (state) {
    case 'entering':
    case 'walking':
    case 'exiting':
      return 'walk';
    case 'running':
      return 'run';
    case 'waving':
      return 'wave';
    case 'jumping':
      return 'jump';
    case 'praying':
      return 'pray';
    case 'kneeling':
      return 'kneel';
    case 'pointing':
      return 'point';
    case 'offscreen':
    case 'idle':
    default:
      return 'idle';
  }
}

export function isMovementState(state: CharacterState) {
  return MOVEMENT_STATES.has(state);
}

export function canStartState(current: CharacterState, requested: CharacterState) {
  if (current === 'offscreen') return requested === 'entering';
  if (current === 'exiting') return false;
  if (current === 'jumping' && requested === 'jumping') return false;
  if (LOCKED_STATES.has(current) && requested !== 'idle') return false;
  return true;
}

export function stateAfterCompletion(state: CharacterState): CharacterState {
  if (state === 'exiting') return 'offscreen';
  return 'idle';
}
