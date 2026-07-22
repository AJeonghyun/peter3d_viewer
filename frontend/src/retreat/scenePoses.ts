import type { AnimationName } from '../spriteLab/types';
import type { RetreatPage } from './types';

export type RetreatPoseId =
  | 'idle'
  | 'wave'
  | 'jump'
  | 'pray'
  | 'point'
  | 'listen-rear'
  | 'listen-back'
  | 'listen-side'
  | 'listen-front'
  | 'back';

export interface RetreatPoseDefinition {
  id: RetreatPoseId;
  label: string;
  shortLabel: string;
  kind: 'animation' | 'static';
  animation: AnimationName;
  currentFrames: readonly number[];
  expandedFrames: readonly number[];
  legacyFrames: readonly number[];
  retreatFrames: readonly number[];
}

export const RETREAT_POSES: Record<RetreatPoseId, RetreatPoseDefinition> = {
  idle: {
    id: 'idle',
    label: '서 있기 · 숨쉬기',
    shortLabel: '서 있기',
    kind: 'animation',
    animation: 'idle',
    currentFrames: [0, 1],
    expandedFrames: [25, 26],
    legacyFrames: [0, 9],
    retreatFrames: [0, 1],
  },
  wave: {
    id: 'wave',
    label: '손 흔들기 · 애니메이션',
    shortLabel: '손 흔들기',
    kind: 'animation',
    animation: 'wave',
    currentFrames: [2, 3],
    expandedFrames: [27],
    legacyFrames: [18],
    retreatFrames: [2],
  },
  jump: {
    id: 'jump',
    label: '기뻐서 뛰기 · 애니메이션',
    shortLabel: '기뻐서 뛰기',
    kind: 'animation',
    animation: 'jump',
    currentFrames: [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
    expandedFrames: [20],
    legacyFrames: [20],
    retreatFrames: [0],
  },
  pray: {
    id: 'pray',
    label: '기도하기',
    shortLabel: '기도',
    kind: 'animation',
    animation: 'pray',
    currentFrames: [24, 25],
    expandedFrames: [22],
    legacyFrames: [22],
    retreatFrames: [0],
  },
  point: {
    id: 'point',
    label: '가리키기',
    shortLabel: '가리키기',
    kind: 'static',
    animation: 'point',
    currentFrames: [26],
    expandedFrames: [24],
    legacyFrames: [24],
    retreatFrames: [0],
  },
  'listen-rear': {
    id: 'listen-rear',
    label: '앉아서 듣기 · 뒤쪽',
    shortLabel: '앉기 뒤',
    kind: 'static',
    animation: 'kneel',
    currentFrames: [29],
    expandedFrames: [29],
    legacyFrames: [21],
    retreatFrames: [4],
  },
  'listen-side': {
    id: 'listen-side',
    label: '앉아서 듣기 · 옆쪽',
    shortLabel: '앉기 옆',
    kind: 'static',
    animation: 'pray',
    currentFrames: [28],
    expandedFrames: [30],
    legacyFrames: [23],
    retreatFrames: [5],
  },
  'listen-front': {
    id: 'listen-front',
    label: '앉아서 듣기 · 앞쪽',
    shortLabel: '앉기 앞',
    kind: 'static',
    animation: 'kneel',
    currentFrames: [27],
    expandedFrames: [28],
    legacyFrames: [19],
    retreatFrames: [3],
  },
  'listen-back': {
    id: 'listen-back',
    label: '앉아서 듣기 · 완전 뒷모습',
    shortLabel: '앉기 완전 뒤',
    kind: 'static',
    animation: 'kneel',
    currentFrames: [30],
    expandedFrames: [],
    legacyFrames: [],
    retreatFrames: [],
  },
  back: {
    id: 'back',
    label: '서 있는 뒷모습',
    shortLabel: '뒷모습',
    kind: 'static',
    animation: 'idle',
    currentFrames: [31],
    expandedFrames: [31],
    legacyFrames: [],
    retreatFrames: [6],
  },
};

const ALL_POSE_IDS: readonly RetreatPoseId[] = [
  'idle',
  'wave',
  'jump',
  'pray',
  'point',
  'listen-front',
  'listen-side',
  'listen-rear',
  'listen-back',
  'back',
];

export function poseOptionsForPage(_page: RetreatPage) {
  return ALL_POSE_IDS.map((poseId) => RETREAT_POSES[poseId]);
}

export function defaultPoseForPage(page: RetreatPage): RetreatPoseId {
  if (page === 'back') return 'back';
  if (page === 'campfire') return 'listen-front';
  return 'idle';
}

export function poseForCampfireFrame(frame: number): RetreatPoseId {
  if (frame === 21) return 'listen-rear';
  if (frame === 23) return 'listen-side';
  return 'listen-front';
}

export function isRetreatPoseId(value: unknown): value is RetreatPoseId {
  return typeof value === 'string' && value in RETREAT_POSES;
}
