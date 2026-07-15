import * as THREE from 'three';
import type { Team } from '../types/api';

export const RESET_AFTER_MS = 45_000;
export const ACTOR_RADIUS = 0.38;
export const ISLAND_RADIUS_X = 13.5;
export const ISLAND_RADIUS_Z = 9.35;
export const MODEL_TARGET_HEIGHT = 1.38;
export const MODEL_TARGET_WIDTH = 1.05;
export const WALK_STRIDE_LENGTH = 0.78;
export const IMPORTED_MODEL_FORWARD_YAW = -Math.PI / 2;

export const STAT_LABELS = {
  courage: '용기',
  wisdom: '현명',
  faith: '진실',
  love: '열정',
} as const;

export const FALLBACK_COLORS = [
  '#e47b53', '#e7a94f', '#78b86b', '#58a9a8', '#5e92c8',
  '#8d7bc4', '#c677a2', '#c9805b', '#8ea653', '#4ba5bd',
];

export interface CircleColliderConfig {
  name: string;
  x: number;
  z: number;
  radius: number;
}

export function seeded(id: number, salt = 0) {
  const value = Math.sin(id * 91.733 + salt * 17.117) * 43758.5453;
  return value - Math.floor(value);
}

export const ACTOR_ZONES = Array.from({ length: 25 }, (_, index) => {
  let count: number;
  let offset: number;
  let radius: number;
  if (index < 12) {
    count = 12;
    offset = 0;
    radius = 9.1;
  } else if (index < 20) {
    count = 8;
    offset = 12;
    radius = 6.2;
  } else {
    count = 5;
    offset = 20;
    radius = 3.55;
  }
  const angle = ((index - offset) / count) * Math.PI * 2 + (offset ? 0.3 : 0.08);
  return new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius * 0.67);
});

export function actorStartPosition(teamId: number) {
  const zone = ACTOR_ZONES[teamId - 1] ?? ACTOR_ZONES[0];
  const angle = seeded(teamId, 2) * Math.PI * 2;
  const radius = 0.35 + seeded(teamId, 3) * 0.95;
  const result = zone.clone().add(new THREE.Vector3(
    Math.cos(angle) * radius,
    0,
    Math.sin(angle) * radius,
  ));
  if (result.length() < 2.2) result.multiplyScalar(1.6);
  return result;
}

const rockColliders: CircleColliderConfig[] = Array.from({ length: 26 }, (_, index) => {
  const id = index + 1;
  const angle = seeded(id, 4) * Math.PI * 2;
  const radius = 8.6 + seeded(id, 8) * 3.4;
  const rockRadius = 0.18 + seeded(id, 12) * 0.36;
  return {
    name: `rock-${id}`,
    x: Math.cos(angle) * radius,
    z: Math.sin(angle) * radius * 0.72,
    radius: rockRadius + 0.05,
  };
});

const bushColliders: CircleColliderConfig[] = Array.from({ length: 15 }, (_, index) => {
  const id = index + 1;
  const angle = (index / 15) * Math.PI * 2 + 0.17;
  const scale = 0.8 + seeded(id, 98) * 0.65;
  return {
    name: `bush-${id}`,
    x: Math.cos(angle) * 13.2 * 1.12,
    z: Math.sin(angle) * 13.2 * 0.77,
    radius: scale * 0.58,
  };
});

export const STATIC_COLLIDERS: CircleColliderConfig[] = [
  { name: 'campfire', x: 0, z: 0.25, radius: 1.02 },
  ...Array.from({ length: 4 }, (_, index) => {
    const angle = Math.PI * 0.25 + index * Math.PI / 2;
    return {
      name: `camp-seat-${index + 1}`,
      x: Math.cos(angle) * 1.72,
      z: Math.sin(angle) * 1.72,
      radius: 0.7,
    };
  }),
  { name: 'basket', x: 1.25, z: 0.92, radius: 0.32 },
  { name: 'boat', x: -8.35, z: -3.55, radius: 1.5 },
  ...rockColliders,
  ...bushColliders,
];

export function fallbackTeams(): Team[] {
  return Array.from({ length: 25 }, (_, index) => ({
    id: index + 1,
    name: `${index + 1}조`,
    identity_text: '첫걸음을 준비하는 베드로',
    color: FALLBACK_COLORS[index % FALLBACK_COLORS.length],
    symbol: '물고기',
    courage: 10,
    wisdom: 10,
    faith: 10,
    love: 10,
    talents: 0,
    title: '첫걸음을 준비하는 자',
    image_url: null,
    model_url: null,
    conversion_status: 'demo',
    updated_at: '',
  }));
}

export interface ActorTelemetry {
  x: number;
  z: number;
  distanceTravelled: number;
}

export interface WorldDebugSnapshot {
  collisionCount: number;
  staticOverlaps: number;
  actorOverlaps: number;
  actors: Array<ActorTelemetry & { teamId: number }>;
}

