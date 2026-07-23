import type { AnimationName } from '../spriteLab/types';
import type { ShowcaseSpriteContract } from '../types/api';

export type RetreatPage = 'stand' | 'back' | 'campfire' | 'seating' | 'awards';
export type MotionIntensity = 'low' | 'medium' | 'high';

export type WorldCharacterState =
  | 'idle'
  | 'walking'
  | 'running'
  | 'turning'
  | 'waving'
  | 'praying'
  | 'jumping'
  | 'falling'
  | 'landing'
  | 'climbingRope'
  | 'descendingRope'
  | 'droppingThroughHole'
  | 'lookingAround'
  | 'avoiding';

export interface RetreatGroup {
  id: string;
  groupNumber: number;
  groupName: string;
  displayName: string;
  leaderName: string;
  memberNames: string[];
  spriteSheetUrl: string;
  spriteAtlasUrl?: string;
  spriteAtlasContract?: ShowcaseSpriteContract | null;
  spriteAnimationRoot?: string;
  spriteAssetKey?: string;
  spriteFrameCount: number;
  spriteFrameWidth: number;
  spriteFrameHeight: number;
  spriteFps: number;
  enabled: boolean;
  defaultAnimation: AnimationName;
  scale: number;
  accentColor: string;
  excludedActions: WorldCharacterState[];
}

export interface SeatingPlan {
  id: string;
  name: string;
  title: string;
  timeLabel: string;
  slotGroupIds: string[];
  active: boolean;
}

export interface WorldSettings {
  title: string;
  verse: string;
  caption: string;
  autonomous: boolean;
  physicsEnabled: boolean;
  intensity: MotionIntensity;
  speed: number;
  gravity: number;
  jumpForce: number;
  maxFallSpeed: number;
  minimumDistance: number;
  walkProbability: number;
  runProbability: number;
  jumpProbability: number;
  dropProbability: number;
  ropeProbability: number;
  holeProbability: number;
  platformChangeProbability: number;
  safeZoneHeight: number;
}

export interface RetreatSettings {
  version: 1;
  currentPage: RetreatPage;
  animationPlaying: boolean;
  transparentBackground: boolean;
  groups: RetreatGroup[];
  seatingPlans: SeatingPlan[];
  world: WorldSettings;
}

export interface PlatformArea {
  id: string;
  xStart: number;
  xEnd: number;
  y: number;
  thickness: number;
  leftEdgeType: 'wall' | 'drop' | 'jump-gap' | 'rope-down';
  rightEdgeType: 'wall' | 'drop' | 'jump-gap' | 'rope-down';
  connectedPlatformIds: string[];
  jumpTargets: string[];
  dropTargets: string[];
  ropeAccessIds: string[];
  holeZones: HoleZone[];
}

export interface HoleZone {
  id: string;
  platformId: string;
  xStart: number;
  xEnd: number;
  dropToPlatformId?: string;
}

export interface RopeZone {
  id: string;
  x: number;
  yTop: number;
  yBottom: number;
  connectsPlatformIds: string[];
  mode: 'up' | 'down' | 'both';
}
