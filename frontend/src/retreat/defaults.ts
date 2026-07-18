import type { RetreatGroup, RetreatSettings } from './types';

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

export const DEFAULT_RETREAT_SETTINGS: RetreatSettings = {
  version: 1,
  currentPage: 'group-layout',
  animationPlaying: true,
  groups: createDefaultGroups(),
  groupLayout: {
    title: '함께 걸어가는 21개 조',
    showMembers: false,
    animationEnabled: true,
    background: 'lake',
  },
  notice: {
    title: '',
    subtitle: '지금 안내드려요',
    body: '안내 내용을 입력해 주세요.',
    emphasis: '',
    footer: '',
    textAlign: 'center',
    fontSize: 64,
    lineHeight: 1.28,
    textColor: '#17324a',
    emphasisColor: '#d86b4b',
    scene: 'mixed-seated-standing',
    rotation: {
      enabledGroupIds: createDefaultGroups().map((group) => group.id),
      maxVisibleCharacters: 3,
      order: 'sequential',
      stayDurationMs: 7_000,
      enterMode: 'walk',
      exitMode: 'fade',
    },
  },
  world: {
    title: 'DO YOU LOVE ME?',
    verse: '네가 나를 사랑하느냐 · 요한복음 21:15',
    caption: '',
    autonomous: true,
    physicsEnabled: true,
    intensity: 'medium',
    speed: 1,
    gravity: 0.9,
    jumpForce: 13,
    maxFallSpeed: 18,
    minimumDistance: 96,
    walkProbability: 0.48,
    runProbability: 0.12,
    jumpProbability: 0.12,
    dropProbability: 0.08,
    ropeProbability: 0.1,
    holeProbability: 0.08,
    platformChangeProbability: 0.28,
    safeZoneHeight: 24,
  },
};
