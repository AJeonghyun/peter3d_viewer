import type { AnimationDefinition, CharacterDefinition } from './types';

const FRAME_ROOT = '/assets/peter/frames';
const FRAME_WIDTH = 280;
const FRAME_HEIGHT = 340;

function animationSheet(
  name: string,
  frameCount: number,
  options: Omit<
    AnimationDefinition,
    'sprite' | 'frameWidth' | 'frameHeight' | 'frameCount'
  >,
): AnimationDefinition {
  return {
    sprite: `${FRAME_ROOT}/${name}-sheet.png`,
    frameWidth: FRAME_WIDTH,
    frameHeight: FRAME_HEIGHT,
    frameCount,
    ...options,
  };
}

export const peterAnimations = {
  idle: animationSheet('idle', 1, {
    fps: 1,
    loop: true,
  }),
  walk: animationSheet('walk', 6, {
    fps: 8,
    loop: true,
  }),
  run: animationSheet('run', 5, {
    fps: 11,
    loop: true,
  }),
  wave: animationSheet('wave', 1, {
    fps: 1,
    loop: false,
    holdLastFrame: true,
    durationMs: 1_350,
  }),
  jump: animationSheet('jump', 1, {
    fps: 1,
    loop: false,
    holdLastFrame: true,
    durationMs: 900,
  }),
  pray: animationSheet('pray', 1, {
    fps: 1,
    loop: false,
    holdLastFrame: true,
    durationMs: 1_800,
  }),
  kneel: animationSheet('kneel', 1, {
    fps: 1,
    loop: false,
    holdLastFrame: true,
    durationMs: 1_800,
  }),
  point: animationSheet('point', 1, {
    fps: 1,
    loop: false,
    holdLastFrame: true,
    durationMs: 1_350,
  }),
} satisfies Record<string, AnimationDefinition>;

const DEMO_CHARACTERS = [
  ['peter-01', '하늘 베드로', '1조'],
  ['peter-02', '용기 베드로', '4조'],
  ['peter-03', '진실 베드로', '7조'],
  ['peter-04', '현명 베드로', '12조'],
  ['peter-05', '열정 베드로', '18조'],
] as const;

export const demoCharacters: CharacterDefinition[] = DEMO_CHARACTERS.map(
  ([id, name, group]) => ({
    id,
    name,
    group,
    animations: peterAnimations,
  }),
);

export const demoSlots = [16, 33, 50, 67, 84] as const;

export const demoSequenceSettings = {
  maxVisible: 5,
  entranceDelayMs: 180,
  waveDelayMs: 360,
  nameVisibleMs: 2_000,
} as const;
