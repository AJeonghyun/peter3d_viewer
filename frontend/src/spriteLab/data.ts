import type { AnimationDefinition, CharacterDefinition } from './types';

const FRAME_ROOT = '/assets/peter/frames';

function frames(...names: string[]) {
  return names.map((name) => `${FRAME_ROOT}/${name}.png`);
}

export const peterAnimations = {
  idle: {
    frames: frames('idle-front'),
    fps: 1,
    loop: true,
  },
  walk: {
    frames: frames('walk-01', 'walk-02', 'walk-03', 'walk-04', 'walk-05'),
    fps: 7,
    loop: true,
  },
  run: {
    frames: frames('run-01', 'run-02', 'run-03', 'run-04', 'run-05'),
    fps: 10,
    loop: true,
  },
  wave: {
    frames: frames('wave-01'),
    fps: 1,
    loop: false,
    holdLastFrame: true,
    durationMs: 1_350,
  },
  jump: {
    frames: frames('jump-01'),
    fps: 1,
    loop: false,
    holdLastFrame: true,
    durationMs: 900,
  },
  pray: {
    frames: frames('pray-01'),
    fps: 1,
    loop: false,
    holdLastFrame: true,
    durationMs: 1_800,
  },
  kneel: {
    frames: frames('kneel-01'),
    fps: 1,
    loop: false,
    holdLastFrame: true,
    durationMs: 1_800,
  },
  point: {
    frames: frames('point-01'),
    fps: 1,
    loop: false,
    holdLastFrame: true,
    durationMs: 1_350,
  },
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
