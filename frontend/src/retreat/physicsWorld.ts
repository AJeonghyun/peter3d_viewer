import Matter from 'matter-js';
import type { AnimationName } from '../spriteLab/types';
import type {
  PlatformArea,
  RetreatGroup,
  RopeZone,
  WorldCharacterState,
  WorldSettings,
} from './types';

export interface WorldCharacterSnapshot {
  id: string;
  groupId: string;
  groupNumber: number;
  x: number;
  y: number;
  rotation: number;
  state: WorldCharacterState;
  animation: AnimationName;
  platformId: string;
  flipX: boolean;
  scale: number;
  zIndex: number;
}

export interface RetreatPhysicsWorldSnapshot {
  actors: WorldCharacterSnapshot[];
  platforms: PlatformArea[];
  ropes: RopeZone[];
}

interface WorldActor {
  group: RetreatGroup;
  body: Matter.Body;
  state: WorldCharacterState;
  animation: AnimationName;
  platformId: string;
  targetPlatformId: string | null;
  targetX: number;
  targetY: number | null;
  direction: 1 | -1;
  stateUntil: number;
  cooldownUntil: number;
  collisionMask: number;
  scale: number;
}

interface CaptureActorState {
  actor: WorldActor;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  state: WorldCharacterState;
  animation: AnimationName;
  platformId: string;
  targetPlatformId: string | null;
  targetX: number;
  targetY: number | null;
  stateUntil: number;
  cooldownUntil: number;
}

const ACTOR_WIDTH = 80;
const ACTOR_HEIGHT = 126;
const ACTOR_VISUAL_WIDTH = 168;
const ACTOR_PERSONAL_SPACE = ACTOR_VISUAL_WIDTH + 10;
const PLATFORM_CATEGORY = 0x0001;
const ACTOR_CATEGORY = 0x0002;
const GROUND_EPSILON = 5;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function stateToAnimation(state: WorldCharacterState): AnimationName {
  if (state === 'walking' || state === 'avoiding' || state === 'turning') return 'walk';
  if (state === 'running') return 'run';
  if (state === 'waving') return 'wave';
  if (state === 'praying') return 'pray';
  if (
    state === 'jumping'
    || state === 'falling'
    || state === 'landing'
    || state === 'droppingThroughHole'
  ) {
    return 'jump';
  }
  return 'idle';
}

export function createRetreatPlatforms(
  width: number,
  height: number,
  safeZoneHeight: number,
): PlatformArea[] {
  const topSafe = clamp(safeZoneHeight, 0, 18) / 100 * height;
  const laneGap = clamp(height * 0.26, 150, 250);
  const yTop = Math.max(topSafe + 120, height * 0.32);
  const yMiddle = Math.max(yTop + laneGap, height * 0.58);
  const yBottom = Math.min(
    height * 0.91,
    Math.max(yMiddle + laneGap, height * 0.86),
  );
  const xStart = width * 0.035;
  const xEnd = width * 0.965;

  return [
    {
      id: 'upper',
      xStart,
      xEnd,
      y: yTop,
      thickness: 20,
      leftEdgeType: 'wall',
      rightEdgeType: 'wall',
      connectedPlatformIds: [],
      jumpTargets: [],
      dropTargets: [],
      ropeAccessIds: [],
      holeZones: [],
    },
    {
      id: 'middle',
      xStart,
      xEnd,
      y: yMiddle,
      thickness: 20,
      leftEdgeType: 'wall',
      rightEdgeType: 'wall',
      connectedPlatformIds: [],
      jumpTargets: [],
      dropTargets: [],
      ropeAccessIds: [],
      holeZones: [],
    },
    {
      id: 'lower',
      xStart,
      xEnd,
      y: yBottom,
      thickness: 20,
      leftEdgeType: 'wall',
      rightEdgeType: 'wall',
      connectedPlatformIds: [],
      jumpTargets: [],
      dropTargets: [],
      ropeAccessIds: [],
      holeZones: [],
    },
  ];
}

export function createRetreatRopes(platforms: PlatformArea[]): RopeZone[] {
  void platforms;
  return [];
}

export class RetreatPhysicsWorld {
  private readonly engine = Matter.Engine.create();
  private readonly platformBodies: Matter.Body[] = [];
  private readonly actors: WorldActor[] = [];
  private readonly platformsById: Map<string, PlatformArea>;
  private readonly ropesById: Map<string, RopeZone>;
  private lastTimestamp = 0;
  private captureBackup: CaptureActorState[] | null = null;

  constructor(
    private readonly groups: RetreatGroup[],
    private readonly platforms: PlatformArea[],
    private readonly ropes: RopeZone[],
    private settings: WorldSettings,
  ) {
    this.platformsById = new Map(platforms.map((platform) => [platform.id, platform]));
    this.ropesById = new Map(ropes.map((rope) => [rope.id, rope]));
    this.engine.gravity.y = clamp(settings.gravity, 0.1, 2.4);
    this.addPlatforms();
    this.addActors();
  }

  dispose() {
    Matter.World.clear(this.engine.world, false);
    Matter.Engine.clear(this.engine);
    this.actors.length = 0;
    this.platformBodies.length = 0;
  }

  setSettings(settings: WorldSettings) {
    this.settings = settings;
    this.engine.gravity.y = clamp(settings.gravity, 0.1, 2.4);
  }

  prepareCapture(mode: 'paused' | 'balanced') {
    if (!this.captureBackup) {
      this.captureBackup = this.actors.map((actor) => ({
        actor,
        x: actor.body.position.x,
        y: actor.body.position.y,
        velocityX: actor.body.velocity.x,
        velocityY: actor.body.velocity.y,
        state: actor.state,
        animation: actor.animation,
        platformId: actor.platformId,
        targetPlatformId: actor.targetPlatformId,
        targetX: actor.targetX,
        targetY: actor.targetY,
        stateUntil: actor.stateUntil,
        cooldownUntil: actor.cooldownUntil,
      }));
    }

    const assignments = mode === 'balanced'
      ? this.actors.map((actor, index) => ({
          actor,
          platform: this.platforms[Math.floor(index / 7)] ?? this.platforms[0],
          slot: index % 7,
          total: Math.min(7, this.actors.length - Math.floor(index / 7) * 7),
        }))
      : this.actors.map((actor) => ({
          actor,
          platform: this.nearestPlatform(actor.body.position.y + ACTOR_HEIGHT / 2),
          slot: -1,
          total: 0,
        }));

    assignments.forEach(({ actor, platform, slot, total }) => {
      if (!platform) return;
      const x = mode === 'balanced'
        ? platform.xStart + (platform.xEnd - platform.xStart) / (total + 1) * (slot + 1)
        : clamp(
            actor.body.position.x,
            platform.xStart + ACTOR_PERSONAL_SPACE / 2,
            platform.xEnd - ACTOR_PERSONAL_SPACE / 2,
          );
      actor.platformId = platform.id;
      actor.targetPlatformId = null;
      actor.targetX = x;
      actor.targetY = null;
      this.restorePlatformCollisions(actor);
      Matter.Body.setPosition(actor.body, { x, y: platform.y - ACTOR_HEIGHT / 2 });
      Matter.Body.setVelocity(actor.body, { x: 0, y: 0 });
      this.setState(actor, 'idle', Number.POSITIVE_INFINITY);
    });
    this.separateCrowds();
  }

  restoreAfterCapture() {
    this.captureBackup?.forEach((saved) => {
      const { actor } = saved;
      Matter.Body.setPosition(actor.body, { x: saved.x, y: saved.y });
      Matter.Body.setVelocity(actor.body, { x: saved.velocityX, y: saved.velocityY });
      actor.state = saved.state;
      actor.animation = saved.animation;
      actor.platformId = saved.platformId;
      actor.targetPlatformId = saved.targetPlatformId;
      actor.targetX = saved.targetX;
      actor.targetY = saved.targetY;
      actor.stateUntil = saved.stateUntil;
      actor.cooldownUntil = saved.cooldownUntil;
      this.restorePlatformCollisions(actor);
    });
    this.captureBackup = null;
  }

  step(timestamp: number, playing: boolean) {
    if (!playing) {
      this.lastTimestamp = timestamp;
      return;
    }

    const delta = this.lastTimestamp
      ? clamp(timestamp - this.lastTimestamp, 8, 1000 / 60)
      : 1000 / 60;
    this.lastTimestamp = timestamp;

    this.updateBrains(timestamp);
    this.applyMovement(timestamp);
    Matter.Engine.update(this.engine, delta);
    this.resolvePlatforms(timestamp);
    this.applySafety();
    this.separateCrowds();
  }

  snapshot(): RetreatPhysicsWorldSnapshot {
    return {
      actors: this.actors.map((actor) => ({
        id: actor.group.id,
        groupId: actor.group.id,
        groupNumber: actor.group.groupNumber,
        x: actor.body.position.x,
        y: actor.body.position.y + ACTOR_HEIGHT / 2,
        rotation: clamp(actor.body.angle, -0.08, 0.08),
        state: actor.state,
        animation: actor.animation,
        platformId: actor.platformId,
        flipX: actor.direction < 0,
        scale: actor.scale,
        zIndex: this.zIndexForPlatform(actor.platformId),
      })),
      platforms: this.platforms,
      ropes: this.ropes,
    };
  }

  private addPlatforms() {
    this.platforms.forEach((platform) => {
      const body = Matter.Bodies.rectangle(
        (platform.xStart + platform.xEnd) / 2,
        platform.y + platform.thickness / 2,
        platform.xEnd - platform.xStart,
        platform.thickness,
        {
          isStatic: true,
          label: `platform:${platform.id}`,
          collisionFilter: { category: PLATFORM_CATEGORY, mask: ACTOR_CATEGORY },
        },
      );
      this.platformBodies.push(body);
    });
    Matter.Composite.add(this.engine.world, this.platformBodies);
  }

  private addActors() {
    const visible = this.groups.slice(0, 21);
    const bodies: Matter.Body[] = [];
    visible.forEach((group, index) => {
      const platform = this.platforms[Math.floor(index / 7)] ?? this.platforms[0];
      if (!platform) return;
      const slot = index % 7;
      const spacing = (platform.xEnd - platform.xStart) / 8;
      const x = platform.xStart + spacing * (slot + 1);
      const y = platform.y - ACTOR_HEIGHT / 2 - 2;
      const body = Matter.Bodies.rectangle(x, y, ACTOR_WIDTH, ACTOR_HEIGHT, {
        friction: 0.9,
        frictionAir: 0.05,
        inertia: Infinity,
        restitution: 0.02,
        label: `actor:${group.id}`,
        collisionFilter: { category: ACTOR_CATEGORY, mask: PLATFORM_CATEGORY },
      });
      Matter.Body.setMass(body, 1.2);
      bodies.push(body);
      this.actors.push({
        group,
        body,
        state: 'idle',
        animation: 'idle',
        platformId: platform.id,
        targetPlatformId: null,
        targetX: x,
        targetY: null,
        direction: Math.random() > 0.5 ? 1 : -1,
        stateUntil: 600 + index * 90,
        cooldownUntil: 400 + index * 65,
        collisionMask: PLATFORM_CATEGORY,
        scale: clamp(group.scale, 0.65, 1.25),
      });
    });
    Matter.Composite.add(this.engine.world, bodies);
  }

  private updateBrains(timestamp: number) {
    this.actors.forEach((actor) => {
      if (actor.group.excludedActions.includes(actor.state)) return;
      if (timestamp < actor.stateUntil || timestamp < actor.cooldownUntil) return;
      if (this.isVerticalState(actor.state)) return;
      if (!this.settings.autonomous) {
        this.setState(actor, 'idle', timestamp + 1_200);
        return;
      }

      const intensityMultiplier = this.settings.intensity === 'low'
        ? 0.55
        : this.settings.intensity === 'high'
          ? 1.45
          : 1;
      const probability = (value: number) => clamp(value * intensityMultiplier, 0, 0.7);
      const ropeProbability = 0;
      const holeProbability = 0;
      const jumpProbability = probability(Math.min(this.settings.jumpProbability, 0.015));
      const dropProbability = 0;
      const roll = Math.random();
      const platform = this.platformsById.get(actor.platformId);
      if (!platform) return;

      if (roll < ropeProbability && this.tryStartRope(actor, timestamp)) return;
      if (
        roll < ropeProbability + holeProbability
        && this.tryStartHoleDrop(actor, timestamp)
      ) {
        return;
      }
      if (
        roll < ropeProbability + holeProbability + jumpProbability
        && this.tryStartJump(actor, timestamp)
      ) {
        return;
      }
      if (
        roll < ropeProbability + holeProbability + jumpProbability + dropProbability
        && this.tryStartEdgeDrop(actor, timestamp)
      ) {
        return;
      }
      if (roll < 0.16) {
        this.setState(actor, 'waving', timestamp + randomBetween(950, 1_700));
        return;
      }
      if (roll < 0.27) {
        this.setState(actor, 'praying', timestamp + randomBetween(1_300, 2_400));
        return;
      }

      const walkProbability = probability(this.settings.walkProbability);
      const runProbability = probability(this.settings.runProbability);
      const motionRoll = Math.random();
      if (motionRoll > walkProbability + runProbability) {
        this.setState(actor, 'idle', timestamp + randomBetween(700, 1_700));
        return;
      }
      const run = motionRoll < runProbability;
      const padding = ACTOR_WIDTH * 0.8;
      actor.targetX = randomBetween(platform.xStart + padding, platform.xEnd - padding);
      actor.direction = actor.targetX >= actor.body.position.x ? 1 : -1;
      this.setState(
        actor,
        run ? 'running' : 'walking',
        timestamp + randomBetween(run ? 1_000 : 1_600, run ? 2_300 : 3_400),
      );
    });
  }

  private applyMovement(timestamp: number) {
    this.actors.forEach((actor) => {
      if (actor.state === 'climbingRope' || actor.state === 'descendingRope') {
        this.moveOnRope(actor, timestamp);
        return;
      }

      if (actor.state === 'droppingThroughHole') {
        Matter.Body.setVelocity(actor.body, {
          x: 0,
          y: Math.min(this.settings.maxFallSpeed, Math.max(5, actor.body.velocity.y)),
        });
        return;
      }

      const walkSpeed = 0.9 * this.settings.speed;
      const runSpeed = 1.9 * this.settings.speed;
      const speed = actor.state === 'running' ? runSpeed : walkSpeed;
      const dx = actor.targetX - actor.body.position.x;
      const activeMove = actor.state === 'walking' || actor.state === 'running' || actor.state === 'avoiding';
      let velocityX = activeMove && Math.abs(dx) > 6 ? Math.sign(dx) * speed : 0;
      velocityX += this.avoidanceVelocity(actor);
      if (Math.abs(velocityX) > 0.05) actor.direction = velocityX > 0 ? 1 : -1;

      Matter.Body.setVelocity(actor.body, {
        x: clamp(velocityX, -runSpeed * 1.35, runSpeed * 1.35),
        y: Math.min(actor.body.velocity.y, this.settings.maxFallSpeed),
      });

      if (activeMove && Math.abs(dx) <= 8 && timestamp > actor.cooldownUntil) {
        this.setState(actor, 'idle', timestamp + randomBetween(700, 1_600));
      }
    });
  }

  private resolvePlatforms(timestamp: number) {
    this.actors.forEach((actor) => {
      if (actor.state === 'climbingRope' || actor.state === 'descendingRope') return;
      const bottomY = actor.body.position.y + ACTOR_HEIGHT / 2;
      const current = this.platformsById.get(actor.platformId);
      const standing = current
        && Math.abs(bottomY - current.y) <= GROUND_EPSILON
        && actor.body.velocity.y >= -0.5
        && Math.abs(actor.body.velocity.y) < 1.2;

      if (standing) {
        if (actor.collisionMask !== PLATFORM_CATEGORY) this.restorePlatformCollisions(actor);
        if (actor.state === 'falling' || actor.state === 'jumping' || actor.state === 'droppingThroughHole') {
          this.setState(actor, 'landing', timestamp + 360);
        } else if (actor.state === 'landing' && timestamp > actor.stateUntil) {
          this.setState(actor, 'idle', timestamp + randomBetween(600, 1_200));
        }
        return;
      }

      this.recoverJumpPlatformCollisions(actor);

      if (actor.body.velocity.y > 1.5 && !this.isVerticalState(actor.state)) {
        this.setState(actor, 'falling', timestamp + 700);
      }

      const landed = this.findLandingPlatform(actor.body.position.x, bottomY, actor.body.velocity.y);
      if (!landed) return;
      actor.platformId = landed.id;
      actor.targetPlatformId = null;
      actor.targetY = null;
      Matter.Body.setPosition(actor.body, {
        x: clamp(actor.body.position.x, landed.xStart + ACTOR_WIDTH / 2, landed.xEnd - ACTOR_WIDTH / 2),
        y: landed.y - ACTOR_HEIGHT / 2,
      });
      Matter.Body.setVelocity(actor.body, { x: actor.body.velocity.x * 0.35, y: 0 });
      this.restorePlatformCollisions(actor);
      this.setState(actor, 'landing', timestamp + 380);
    });
  }

  private applySafety() {
    const bottomPlatform = this.platforms[this.platforms.length - 1];
    if (!bottomPlatform) return;
    const floorY = bottomPlatform.y - ACTOR_HEIGHT / 2;
    this.actors.forEach((actor) => {
      const platform = this.platformsById.get(actor.platformId) ?? bottomPlatform;
      const minX = platform.xStart + ACTOR_WIDTH / 2;
      const maxX = platform.xEnd - ACTOR_WIDTH / 2;
      if (actor.body.position.y > bottomPlatform.y + 180) {
        Matter.Body.setPosition(actor.body, {
          x: clamp(actor.body.position.x, bottomPlatform.xStart + ACTOR_WIDTH, bottomPlatform.xEnd - ACTOR_WIDTH),
          y: floorY,
        });
        Matter.Body.setVelocity(actor.body, { x: 0, y: 0 });
        actor.platformId = bottomPlatform.id;
        actor.targetPlatformId = null;
        actor.targetY = null;
        this.restorePlatformCollisions(actor);
        this.setState(actor, 'landing', this.lastTimestamp + 420);
        return;
      }
      if (!this.isVerticalState(actor.state)) {
        Matter.Body.setPosition(actor.body, {
          x: clamp(actor.body.position.x, minX, maxX),
          y: actor.body.position.y,
        });
      }
    });
  }

  private separateCrowds() {
    this.platforms.forEach((platform) => {
      const grounded = this.actors
        .filter((actor) => (
          actor.platformId === platform.id
          && !this.isVerticalState(actor.state)
          && Math.abs(actor.body.position.y + ACTOR_HEIGHT / 2 - platform.y) < 12
        ))
        .sort((left, right) => left.body.position.x - right.body.position.x);
      if (grounded.length < 2) return;

      const minX = platform.xStart + ACTOR_WIDTH / 2;
      const maxX = platform.xEnd - ACTOR_WIDTH / 2;
      const available = maxX - minX;
      const desiredGap = Math.min(
        Math.max(this.settings.minimumDistance, ACTOR_PERSONAL_SPACE),
        available / (grounded.length - 1),
        110,
      );

      let cursor = minX - desiredGap;
      grounded.forEach((actor) => {
        const nextX = Math.max(actor.body.position.x, cursor + desiredGap);
        Matter.Body.setPosition(actor.body, {
          x: Math.min(maxX, nextX),
          y: actor.body.position.y,
        });
        cursor = actor.body.position.x;
      });

      cursor = maxX + desiredGap;
      for (let index = grounded.length - 1; index >= 0; index -= 1) {
        const actor = grounded[index];
        if (!actor) continue;
        const nextX = Math.min(actor.body.position.x, cursor - desiredGap);
        Matter.Body.setPosition(actor.body, {
          x: Math.max(minX, nextX),
          y: actor.body.position.y,
        });
        cursor = actor.body.position.x;
      }
    });
  }

  private tryStartRope(actor: WorldActor, timestamp: number) {
    const platform = this.platformsById.get(actor.platformId);
    if (!platform) return false;
    const accessible = platform.ropeAccessIds
      .map((id) => this.ropesById.get(id))
      .filter((rope): rope is RopeZone => Boolean(rope));
    const rope = accessible.find((candidate) => Math.abs(candidate.x - actor.body.position.x) < 72)
      ?? accessible[Math.floor(Math.random() * accessible.length)];
    if (!rope) return false;
    const nextPlatformId = rope.connectsPlatformIds.find((id) => id !== actor.platformId);
    const nextPlatform = nextPlatformId ? this.platformsById.get(nextPlatformId) : null;
    if (!nextPlatform) return false;
    const ropeState = nextPlatform.y < platform.y ? 'climbingRope' : 'descendingRope';
    if (actor.group.excludedActions.includes(ropeState)) return false;
    actor.targetPlatformId = nextPlatform.id;
    actor.targetX = rope.x;
    actor.targetY = nextPlatform.y - ACTOR_HEIGHT / 2;
    Matter.Body.setPosition(actor.body, { x: rope.x, y: actor.body.position.y });
    Matter.Body.setVelocity(actor.body, { x: 0, y: 0 });
    Matter.Body.set(actor.body, { isSensor: true });
    this.setState(
      actor,
      ropeState,
      timestamp + randomBetween(900, 1_500),
    );
    return true;
  }

  private tryStartHoleDrop(actor: WorldActor, timestamp: number) {
    if (actor.group.excludedActions.includes('droppingThroughHole')) return false;
    const platform = this.platformsById.get(actor.platformId);
    if (!platform) return false;
    const hole = platform.holeZones.find((zone) => (
      actor.body.position.x >= zone.xStart - 42 && actor.body.position.x <= zone.xEnd + 42
    )) ?? platform.holeZones[Math.floor(Math.random() * platform.holeZones.length)];
    const target = hole?.dropToPlatformId ? this.platformsById.get(hole.dropToPlatformId) : null;
    if (!hole || !target) return false;
    actor.targetPlatformId = target.id;
    actor.targetX = randomBetween(hole.xStart, hole.xEnd);
    actor.targetY = target.y - ACTOR_HEIGHT / 2;
    Matter.Body.setPosition(actor.body, { x: actor.targetX, y: actor.body.position.y });
    Matter.Body.setVelocity(actor.body, { x: 0, y: 3 });
    this.disablePlatformCollisions(actor);
    this.setState(actor, 'droppingThroughHole', timestamp + 1_100);
    return true;
  }

  private tryStartEdgeDrop(actor: WorldActor, timestamp: number) {
    const platform = this.platformsById.get(actor.platformId);
    const targetId = platform?.dropTargets[Math.floor(Math.random() * platform.dropTargets.length)];
    const target = targetId ? this.platformsById.get(targetId) : null;
    if (!platform || !target) return false;
    const fromLeft = Math.random() < 0.5;
    const x = fromLeft ? platform.xStart + 8 : platform.xEnd - 8;
    actor.direction = fromLeft ? -1 : 1;
    actor.targetPlatformId = target.id;
    actor.targetX = x;
    actor.targetY = target.y - ACTOR_HEIGHT / 2;
    Matter.Body.setPosition(actor.body, { x, y: actor.body.position.y });
    Matter.Body.setVelocity(actor.body, { x: actor.direction * 1.6, y: 2.4 });
    this.disablePlatformCollisions(actor);
    this.setState(actor, 'falling', timestamp + 1_200);
    return true;
  }

  private tryStartJump(actor: WorldActor, timestamp: number) {
    if (actor.group.excludedActions.includes('jumping')) return false;
    const platform = this.platformsById.get(actor.platformId);
    if (!platform || Math.random() > this.settings.platformChangeProbability) {
      Matter.Body.setVelocity(actor.body, {
        x: actor.direction * randomBetween(0.4, 1.2),
        y: -this.settings.jumpForce,
      });
      this.setState(actor, 'jumping', timestamp + 850);
      return true;
    }
    const targetId = platform.jumpTargets[Math.floor(Math.random() * platform.jumpTargets.length)];
    const target = targetId ? this.platformsById.get(targetId) : null;
    if (!target) return false;
    actor.targetPlatformId = target.id;
    actor.targetX = clamp(actor.body.position.x + randomBetween(-120, 120), target.xStart + 52, target.xEnd - 52);
    actor.targetY = target.y - ACTOR_HEIGHT / 2;
    if (target.y < platform.y) this.disablePlatformCollisions(actor);
    Matter.Body.setVelocity(actor.body, {
      x: clamp((actor.targetX - actor.body.position.x) / 44, -3.2, 3.2),
      y: target.y < platform.y ? -this.settings.jumpForce * 1.12 : -this.settings.jumpForce * 0.76,
    });
    this.setState(actor, 'jumping', timestamp + 1_100);
    return true;
  }

  private moveOnRope(actor: WorldActor, timestamp: number) {
    const targetPlatform = actor.targetPlatformId
      ? this.platformsById.get(actor.targetPlatformId)
      : null;
    if (!targetPlatform || actor.targetY == null) {
      this.restorePlatformCollisions(actor);
      this.setState(actor, 'idle', timestamp + 800);
      return;
    }

    const dy = actor.targetY - actor.body.position.y;
    const step = clamp(Math.abs(dy), 0, 2.2 * this.settings.speed) * Math.sign(dy);
    Matter.Body.setPosition(actor.body, {
      x: actor.targetX,
      y: actor.body.position.y + step,
    });
    Matter.Body.setVelocity(actor.body, { x: 0, y: 0 });
    if (Math.abs(dy) < 4 || timestamp > actor.stateUntil) {
      actor.platformId = targetPlatform.id;
      actor.targetPlatformId = null;
      actor.targetY = null;
      Matter.Body.setPosition(actor.body, { x: actor.targetX, y: targetPlatform.y - ACTOR_HEIGHT / 2 });
      Matter.Body.set(actor.body, { isSensor: false });
      this.restorePlatformCollisions(actor);
      this.setState(actor, 'landing', timestamp + 420);
    }
  }

  private avoidanceVelocity(actor: WorldActor) {
    const minimumDistance = clamp(
      Math.max(this.settings.minimumDistance, ACTOR_PERSONAL_SPACE),
      ACTOR_PERSONAL_SPACE,
      120,
    );
    let push = 0;
    this.actors.forEach((other) => {
      if (other === actor || other.platformId !== actor.platformId) return;
      const dx = actor.body.position.x - other.body.position.x;
      const distance = Math.abs(dx);
      if (distance > 0.01 && distance < minimumDistance) {
        push += Math.sign(dx) * (minimumDistance - distance) / minimumDistance;
      }
    });
    if (Math.abs(push) > 0.12 && !this.isVerticalState(actor.state)) {
      actor.state = 'avoiding';
      actor.animation = stateToAnimation(actor.state);
    }
    return clamp(push * 1.5, -1.8, 1.8);
  }

  private findLandingPlatform(x: number, bottomY: number, velocityY: number) {
    if (velocityY < -0.5) return null;
    const target = this.platforms.find((platform) => (
      x >= platform.xStart
      && x <= platform.xEnd
      && bottomY >= platform.y - 4
      && bottomY <= platform.y + platform.thickness + 10
    ));
    return target ?? null;
  }

  private nearestPlatform(bottomY: number) {
    return this.platforms.reduce<PlatformArea | undefined>((nearest, platform) => (
      !nearest || Math.abs(platform.y - bottomY) < Math.abs(nearest.y - bottomY)
        ? platform
        : nearest
    ), undefined);
  }

  private recoverJumpPlatformCollisions(actor: WorldActor) {
    if (
      actor.collisionMask !== 0
      || actor.state === 'droppingThroughHole'
      || !actor.targetPlatformId
      || actor.targetY == null
    ) {
      return;
    }
    const target = this.platformsById.get(actor.targetPlatformId);
    if (!target) return;
    const isAboveTarget = actor.body.position.y <= actor.targetY - 8;
    const descendingTowardTarget = actor.body.velocity.y >= 0;
    if (isAboveTarget && descendingTowardTarget) {
      this.restorePlatformCollisions(actor);
    }
  }

  private setState(actor: WorldActor, state: WorldCharacterState, until: number) {
    if (actor.group.excludedActions.includes(state)) {
      actor.state = 'idle';
      actor.animation = 'idle';
      actor.stateUntil = until;
      actor.cooldownUntil = until + 180;
      return;
    }
    actor.state = state;
    actor.animation = stateToAnimation(state);
    actor.stateUntil = until;
    actor.cooldownUntil = until + 220;
  }

  private isVerticalState(state: WorldCharacterState) {
    return state === 'climbingRope'
      || state === 'descendingRope'
      || state === 'droppingThroughHole';
  }

  private disablePlatformCollisions(actor: WorldActor) {
    actor.collisionMask = 0;
    actor.body.collisionFilter.mask = 0;
  }

  private restorePlatformCollisions(actor: WorldActor) {
    actor.collisionMask = PLATFORM_CATEGORY;
    actor.body.collisionFilter.mask = PLATFORM_CATEGORY;
    Matter.Body.set(actor.body, { isSensor: false });
  }

  private zIndexForPlatform(platformId: string) {
    if (platformId === 'upper') return 4;
    if (platformId === 'middle') return 6;
    return 8;
  }
}
