import type { RetreatGroup, RetreatSettings, SeatingPlan } from './types';

const ACCENTS = [
  '#f26d6d', '#f59f45', '#e1b83b', '#85b85b', '#49a985', '#4aa8b8', '#508fd8',
  '#746fd0', '#9b69c7', '#c864a3', '#d86a83', '#b77a52', '#71859a', '#539aaa',
  '#6ca36e', '#bd9142', '#d87851', '#8c7ac0', '#5a9dcc', '#c36d8b', '#7c9670',
];

export function createDefaultGroups(): RetreatGroup[] {
  return Array.from({ length: 21 }, (_, index) => {
    const number = index + 1;
    return {
      id: `group-${String(number).padStart(2, '0')}`,
      groupNumber: number,
      groupName: `${number}조`,
      displayName: `베드로 ${number}조`,
      leaderName: '',
      memberNames: [],
      spriteSheetUrl: '',
      spriteAtlasUrl: '',
      spriteAtlasContract: null,
      spriteAnimationRoot: '',
      spriteFrameCount: 1,
      spriteFrameWidth: 160,
      spriteFrameHeight: 192,
      spriteFps: 8,
      enabled: true,
      defaultAnimation: 'idle',
      scale: 1,
      accentColor: ACCENTS[index],
      excludedActions: [],
    };
  });
}

export function createDefaultSeatingPlans(groups = createDefaultGroups()): SeatingPlan[] {
  const groupIds = groups.slice(0, 21).map((group) => group.id);
  return [
    {
      id: 'first-day-main',
      name: '첫째 날 기본',
      title: '첫째 날 자리표',
      timeLabel: '',
      slotGroupIds: groupIds,
      active: true,
    },
  ];
}

export const DEFAULT_RETREAT_SETTINGS: RetreatSettings = {
  version: 1,
  currentPage: 'walk',
  animationPlaying: true,
  transparentBackground: false,
  groups: createDefaultGroups(),
  seatingPlans: createDefaultSeatingPlans(),
  world: {
    title: 'DO YOU LOVE ME?',
    verse: '네가 나를 사랑하느냐 · 요한복음 21:15',
    caption: '',
    autonomous: true,
    physicsEnabled: true,
    intensity: 'medium',
    speed: 1,
    gravity: 0.55,
    jumpForce: 7,
    maxFallSpeed: 18,
    minimumDistance: 118,
    walkProbability: 0.64,
    runProbability: 0.14,
    jumpProbability: 0.015,
    dropProbability: 0,
    ropeProbability: 0,
    holeProbability: 0,
    platformChangeProbability: 0,
    safeZoneHeight: 7,
  },
};
