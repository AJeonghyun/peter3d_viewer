export type WorldQualityTier = 'high' | 'balanced';

export interface WorldQualityProfile {
  tier: WorldQualityTier;
  maxDpr: number;
  antialias: boolean;
  shadowMapSize: 1024 | 2048;
  softShadows: boolean;
  characterShadows: boolean;
  postprocessing: boolean;
  waterSegments: number;
  modelLoadConcurrency: number;
  animationFps: number;
  steeringFps: number;
  physicsTimeStep: number;
}

const HIGH_QUALITY: WorldQualityProfile = {
  tier: 'high',
  maxDpr: 1.65,
  antialias: true,
  shadowMapSize: 2048,
  softShadows: true,
  characterShadows: true,
  postprocessing: true,
  waterSegments: 100,
  modelLoadConcurrency: 3,
  animationFps: 30,
  steeringFps: 15,
  physicsTimeStep: 1 / 60,
};

const BALANCED_QUALITY: WorldQualityProfile = {
  tier: 'balanced',
  maxDpr: 1.25,
  antialias: false,
  shadowMapSize: 1024,
  softShadows: false,
  characterShadows: false,
  postprocessing: false,
  waterSegments: 48,
  modelLoadConcurrency: 2,
  animationFps: 15,
  steeringFps: 10,
  physicsTimeStep: 1 / 30,
};

export function detectWorldQuality(): WorldQualityProfile {
  const override = new URLSearchParams(window.location.search).get('quality');
  if (override === 'high') return HIGH_QUALITY;
  if (override === 'balanced' || override === 'low') return BALANCED_QUALITY;

  const isiPad = /iPad/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isCoarsePointer = window.matchMedia?.('(hover: none) and (pointer: coarse)').matches ?? false;
  const isTouchDevice = navigator.maxTouchPoints > 0 && isCoarsePointer;

  return isiPad || isTouchDevice ? BALANCED_QUALITY : HIGH_QUALITY;
}
