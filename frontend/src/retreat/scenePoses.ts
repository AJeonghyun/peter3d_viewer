import type { AnimationName } from '../spriteLab/types';
import type { RetreatPage } from './types';

export type RetreatPoseId =
  | 'idle'
  | 'wave'
  | 'listen-rear'
  | 'listen-side'
  | 'listen-front'
  | 'back';

export interface RetreatPoseDefinition {
  id: RetreatPoseId;
  label: string;
  shortLabel: string;
  kind: 'animation' | 'static';
  animation: AnimationName;
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
    legacyFrames: [0, 9],
    retreatFrames: [0, 1],
  },
  wave: {
    id: 'wave',
    label: '손 흔들기 · 애니메이션',
    shortLabel: '손 흔들기',
    kind: 'animation',
    animation: 'wave',
    legacyFrames: [18],
    retreatFrames: [2],
  },
  'listen-rear': {
    id: 'listen-rear',
    label: '앉아서 듣기 · 뒤쪽',
    shortLabel: '앉기 뒤',
    kind: 'static',
    animation: 'kneel',
    legacyFrames: [21],
    retreatFrames: [4],
  },
  'listen-side': {
    id: 'listen-side',
    label: '앉아서 듣기 · 옆쪽',
    shortLabel: '앉기 옆',
    kind: 'static',
    animation: 'pray',
    legacyFrames: [23],
    retreatFrames: [5],
  },
  'listen-front': {
    id: 'listen-front',
    label: '앉아서 듣기 · 앞쪽',
    shortLabel: '앉기 앞',
    kind: 'static',
    animation: 'kneel',
    legacyFrames: [19],
    retreatFrames: [3],
  },
  back: {
    id: 'back',
    label: '서 있는 뒷모습',
    shortLabel: '뒷모습',
    kind: 'static',
    animation: 'idle',
    legacyFrames: [],
    retreatFrames: [6],
  },
};

const ALL_POSE_IDS: readonly RetreatPoseId[] = [
  'idle',
  'wave',
  'listen-front',
  'listen-side',
  'listen-rear',
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
