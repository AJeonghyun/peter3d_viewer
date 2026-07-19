import type { AnimationDefinition, CharacterDefinition } from './types';

const FRAME_ROOT = '/assets/peter-sober/frames';
const FRAME_WIDTH = 300;
const FRAME_HEIGHT = 360;

function animationSheet(
  frameRoot: string,
  name: string,
  frameCount: number,
  options: Omit<
    AnimationDefinition,
    'sprite' | 'frameWidth' | 'frameHeight' | 'frameCount'
  >,
): AnimationDefinition {
  return {
    sprite: `${frameRoot}/${name}-sheet.png`,
    frameWidth: FRAME_WIDTH,
    frameHeight: FRAME_HEIGHT,
    frameCount,
    ...options,
  };
}

export function createPeterAnimations(
  frameRoot: string,
  frameCounts: Partial<Record<keyof CharacterDefinition['animations'], number>> = {},
) {
  return {
    idle: animationSheet(frameRoot, 'idle', frameCounts.idle ?? 1, {
      fps: 1,
      loop: true,
    }),
    walk: animationSheet(frameRoot, 'walk', frameCounts.walk ?? 8, {
      fps: 10,
      loop: true,
    }),
    run: animationSheet(frameRoot, 'run', frameCounts.run ?? 8, {
      fps: 14,
      loop: true,
    }),
    wave: animationSheet(frameRoot, 'wave', frameCounts.wave ?? 1, {
      fps: 1,
      loop: false,
      holdLastFrame: true,
      durationMs: 1_350,
    }),
    jump: animationSheet(frameRoot, 'jump', frameCounts.jump ?? 3, {
      fps: 5,
      loop: false,
      holdLastFrame: true,
      durationMs: 900,
    }),
    pray: animationSheet(frameRoot, 'pray', frameCounts.pray ?? 1, {
      fps: 1,
      loop: false,
      holdLastFrame: true,
      durationMs: 1_800,
    }),
    kneel: animationSheet(frameRoot, 'kneel', frameCounts.kneel ?? 1, {
      fps: 1,
      loop: false,
      holdLastFrame: true,
      durationMs: 1_800,
    }),
    point: animationSheet(frameRoot, 'point', frameCounts.point ?? 1, {
      fps: 1,
      loop: false,
      holdLastFrame: true,
      durationMs: 1_350,
    }),
  } satisfies CharacterDefinition['animations'];
}

export const peterAnimations = createPeterAnimations(FRAME_ROOT);

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
