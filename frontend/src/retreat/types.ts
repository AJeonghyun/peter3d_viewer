import type { AnimationName } from '../spriteLab/types';

export type RetreatPage = 'group-layout' | 'notice' | 'all-characters';
export type TextAlign = 'left' | 'center' | 'right';
export type MotionIntensity = 'low' | 'medium' | 'high';
export type ExportFormat = 'png' | 'jpeg';
export type CaptureMode = 'current' | 'paused' | 'balanced';

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

export interface GroupLayoutSettings {
  title: string;
  showMembers: boolean;
  animationEnabled: boolean;
  background: 'lake' | 'sand' | 'paper';
}

export interface NoticeCharacterRotationSettings {
  enabledGroupIds: string[];
  maxVisibleCharacters: number;
  order: 'sequential' | 'random' | 'selected';
  stayDurationMs: number;
  enterMode: 'walk' | 'fade';
  exitMode: 'walk' | 'fade';
}

export type NoticeScene =
  | 'fire-circle-seated'
  | 'fire-circle-standing'
  | 'mixed-seated-standing'
  | 'galilee-shore-conversation'
  | 'follow-me'
  | 'calm-lake';

export interface NoticeSettings {
  title: string;
  subtitle: string;
  body: string;
  emphasis: string;
  footer: string;
  textAlign: TextAlign;
  fontSize: number;
  lineHeight: number;
  textColor: string;
  emphasisColor: string;
  scene: NoticeScene;
  rotation: NoticeCharacterRotationSettings;
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
  groups: RetreatGroup[];
  groupLayout: GroupLayoutSettings;
  notice: NoticeSettings;
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
