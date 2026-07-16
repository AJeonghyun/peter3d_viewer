import { Component, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ErrorInfo, ReactNode, RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { CapsuleCollider, RigidBody } from '@react-three/rapier';
import type { RapierRigidBody } from '@react-three/rapier';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import * as THREE from 'three';
import type { Team } from '../types/api';
import {
  ACTOR_RADIUS,
  FALLBACK_COLORS,
  IMPORTED_MODEL_FORWARD_YAW,
  ISLAND_RADIUS_X,
  ISLAND_RADIUS_Z,
  MODEL_TARGET_HEIGHT,
  MODEL_TARGET_WIDTH,
  STATIC_COLLIDERS,
  WALK_STRIDE_LENGTH,
  actorStartPosition,
  seeded,
} from './config';
import type { ActorTelemetry } from './config';
import { useModelLoadPermit } from './modelLoadQueue';

interface PeterActorProps {
  team: Team;
  selectionRef: RefObject<number | null>;
  telemetry: RefObject<Map<number, ActorTelemetry>>;
  collisionCount: RefObject<number>;
  onSelect: (teamId: number) => void;
  castShadows: boolean;
  animationFps: number;
  steeringFps: number;
}

interface ModelBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
  onFailure: () => void;
}

class ModelErrorBoundary extends Component<ModelBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('GLB 모델을 불러오지 못해 데모 캐릭터를 사용합니다.', error, info.componentStack);
    this.props.onFailure();
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function findAnimationClips(animations: THREE.AnimationClip[]) {
  let idle = animations.find((clip) => /idle|standing|stand[-_ ]?still|rest/i.test(clip.name)) ?? null;
  let walk = animations.find((clip) => /walk|walking|locomotion/i.test(clip.name)) ?? null;

  // Tripo can export generic names such as NlaTrack/NlaTrack.001. The API
  // request order is fixed to [idle, walk], so preserve that order when names
  // carry no useful animation hint. A legacy one-clip NlaTrack remains walk.
  if (!idle && !walk && animations.length >= 2) {
    [idle, walk] = animations;
  } else {
    idle ??= animations.length >= 2
      ? animations.find((clip) => clip !== walk) ?? null
      : null;
    walk ??= animations.find((clip) => clip !== idle) ?? animations[0] ?? null;
  }
  return { idle: idle === walk ? null : idle, walk };
}

function sampleBounds(object: THREE.Object3D, mixer: THREE.AnimationMixer | null, clip: THREE.AnimationClip | null) {
  const bounds = new THREE.Box3();
  // A generated character can contain more than a million triangles. Sampling
  // every animation pose blocks the main thread, while the bind pose is enough
  // to normalize a kiosk character to the configured envelope.
  const samples = 1;
  for (let index = 0; index < samples; index += 1) {
    if (mixer && clip) mixer.setTime((clip.duration * index) / samples);
    object.updateMatrixWorld(true);
    object.traverse((child) => {
      if (!(child instanceof THREE.SkinnedMesh)) return;
      child.skeleton.update();
      child.computeBoundingBox();
    });
    bounds.union(new THREE.Box3().setFromObject(object));
  }
  return bounds;
}

function RiggedPeter({
  teamId,
  url,
  speed,
  selectionRef,
  onReady,
  castShadows,
  animationFps,
}: {
  teamId: number;
  url: string;
  speed: number;
  selectionRef: RefObject<number | null>;
  onReady: () => void;
  castShadows: boolean;
  animationFps: number;
}) {
  const { scene, animations } = useGLTF(url, '/draco/');
  const clone = useMemo(() => {
    const result = cloneSkeleton(scene);
    result.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      // Selection uses a dedicated low-poly proxy. Never raycast generated
      // character geometry — Tripo meshes can exceed one million triangles.
      object.raycast = () => undefined;
    });
    return result;
  }, [scene]);
  const clips = useMemo(() => findAnimationClips(animations), [animations]);
  const boundsClip = clips.walk ?? clips.idle;
  const fit = useMemo(() => {
    const sampleMixer = boundsClip ? new THREE.AnimationMixer(clone) : null;
    if (sampleMixer && boundsClip) sampleMixer.clipAction(boundsClip).play();
    const bounds = sampleBounds(clone, sampleMixer, boundsClip);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    sampleMixer?.setTime(0);
    sampleMixer?.stopAllAction();
    sampleMixer?.uncacheRoot(clone);
    const horizontal = Math.max(size.x, size.z);
    const valid = Number.isFinite(size.y) && size.y > 0 && Number.isFinite(horizontal) && horizontal > 0;
    return {
      scale: valid ? Math.min(MODEL_TARGET_HEIGHT / size.y, MODEL_TARGET_WIDTH / horizontal) : 1,
      offset: new THREE.Vector3(-center.x, -bounds.min.y, -center.z),
    };
  }, [boundsClip, clone]);
  const mixer = useMemo(() => new THREE.AnimationMixer(clone), [clone]);
  const walkAction = useRef<THREE.AnimationAction | null>(null);
  const idleAction = useRef<THREE.AnimationAction | null>(null);
  const activeAction = useRef<THREE.AnimationAction | null>(null);
  const selectedAnimation = useRef<boolean | null>(null);
  const animationElapsed = useRef(seeded(teamId, 510) / animationFps);

  useEffect(() => {
    const walking = clips.walk ? mixer.clipAction(clips.walk, clone) : null;
    const idling = clips.idle ? mixer.clipAction(clips.idle, clone) : null;
    const isSelected = selectionRef.current === teamId;

    if (walking && clips.walk) {
      walking.enabled = true;
      walking.clampWhenFinished = false;
      walking.setLoop(THREE.LoopRepeat, Infinity);
      walking.setEffectiveTimeScale(Math.max(0.65, speed * clips.walk.duration / WALK_STRIDE_LENGTH));
      walking.setEffectiveWeight(isSelected && idling ? 0 : 1);
      walking.reset().play();
    }
    if (idling) {
      idling.enabled = true;
      idling.clampWhenFinished = false;
      idling.setLoop(THREE.LoopRepeat, Infinity);
      idling.setEffectiveTimeScale(1);
      idling.setEffectiveWeight(isSelected ? 1 : 0);
      idling.reset().play();
    }

    walkAction.current = walking;
    idleAction.current = idling;
    activeAction.current = isSelected && idling ? idling : walking ?? idling;
    selectedAnimation.current = isSelected;
    if (!idling && walking) walking.paused = isSelected;
    onReady();
    return () => {
      walkAction.current = null;
      idleAction.current = null;
      activeAction.current = null;
      selectedAnimation.current = null;
      walking?.stop();
      idling?.stop();
      mixer.uncacheRoot(clone);
    };
  }, [clips, clone, mixer, onReady, selectionRef, speed, teamId]);

  useFrame((_, delta) => {
    const walking = walkAction.current;
    const idling = idleAction.current;
    const isSelected = selectionRef.current === teamId;

    if (isSelected !== selectedAnimation.current) {
      if (walking && idling) {
        const previous = activeAction.current;
        const next = isSelected ? idling : walking;
        if (previous !== next) {
          previous?.fadeOut(0.18);
          next.stopFading();
          next.enabled = true;
          next.paused = false;
          next.reset().setEffectiveWeight(1).fadeIn(0.18).play();
          activeAction.current = next;
        }
      } else if (walking) {
        // Older GLBs only contain a walk clip. Keep their selected pose frozen
        // instead of making a stationary character continue stepping in place.
        walking.paused = isSelected;
      }
      selectedAnimation.current = isSelected;
    }

    const action = activeAction.current;
    if (!action || (isSelected && !idling)) return;
    animationElapsed.current += Math.min(delta, 0.1);
    const interval = 1 / animationFps;
    if (animationElapsed.current < interval) return;
    mixer.update(Math.min(animationElapsed.current, 0.1));
    animationElapsed.current %= interval;
  });

  useEffect(() => {
    clone.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = castShadows;
      object.receiveShadow = false;
    });
  }, [castShadows, clone]);

  return (
    <group scale={fit.scale}>
      <primitive object={clone} position={fit.offset} />
    </group>
  );
}

function QueuedRiggedPeter({
  teamId,
  url,
  speed,
  selectionRef,
  onReady,
  castShadows,
  animationFps,
  fallback,
}: {
  teamId: number;
  url: string;
  speed: number;
  selectionRef: RefObject<number | null>;
  onReady: () => void;
  castShadows: boolean;
  animationFps: number;
  fallback: ReactNode;
}) {
  const { permitted, markSettled } = useModelLoadPermit(teamId, url);
  const markReady = useCallback(() => {
    markSettled('ready');
    onReady();
  }, [markSettled, onReady]);
  const markFailed = useCallback(() => markSettled('failed'), [markSettled]);

  if (!permitted) return fallback;
  return (
    <ModelErrorBoundary key={url} fallback={fallback} onFailure={markFailed}>
      <Suspense fallback={fallback}>
        <RiggedPeter
          teamId={teamId}
          url={url}
          speed={speed}
          selectionRef={selectionRef}
          onReady={markReady}
          castShadows={castShadows}
          animationFps={animationFps}
        />
      </Suspense>
    </ModelErrorBoundary>
  );
}

function DemoPeter({ color, teamId, castShadows }: { color: string; teamId: number; castShadows: boolean }) {
  return (
    <group>
      <mesh position-y={0.8} castShadow={castShadows}>
        <capsuleGeometry args={[0.27, 0.55, 6, 12]} />
        <meshStandardMaterial color={color} roughness={0.78} />
      </mesh>
      <mesh position-y={1.43} castShadow={castShadows}>
        <sphereGeometry args={[0.22, 16, 12]} />
        <meshStandardMaterial color="#d8a276" roughness={0.86} />
      </mesh>
      <mesh position-y={1.48} castShadow={castShadows}>
        <sphereGeometry args={[0.225, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#33261f" roughness={1} />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh position={[side * 0.34, 0.86, 0]} rotation-z={side * (0.18 + seeded(teamId, 42) * 0.15)} castShadow={castShadows}>
            <capsuleGeometry args={[0.075, 0.39, 4, 8]} />
            <meshStandardMaterial color={color} roughness={0.78} />
          </mesh>
          <mesh position={[side * 0.13, 0.26, 0]} castShadow={castShadows}>
            <capsuleGeometry args={[0.085, 0.38, 4, 8]} />
            <meshStandardMaterial color="#33261f" roughness={1} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function TeamLabel({
  name,
  color,
  visible,
  spriteRef,
}: {
  name: string;
  color: string;
  visible: boolean;
  spriteRef: RefObject<THREE.Sprite | null>;
}) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 96;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.fillStyle = 'rgba(4, 20, 27, .82)';
    context.beginPath();
    context.roundRect(18, 10, 284, 65, 28);
    context.fill();
    context.strokeStyle = `${color}cc`;
    context.lineWidth = 3;
    context.stroke();
    context.fillStyle = '#f9f3e7';
    context.font = '700 29px sans-serif';
    context.textAlign = 'center';
    context.fillText(name, 160, 53);
    const canvasTexture = new THREE.CanvasTexture(canvas);
    canvasTexture.colorSpace = THREE.SRGBColorSpace;
    return canvasTexture;
  }, [color, name]);

  useEffect(() => () => texture?.dispose(), [texture]);
  if (!texture) return null;
  return (
    <sprite ref={spriteRef} position-y={1.7} scale={[1.5, 0.45, 1]} visible={visible} raycast={() => null}>
      <spriteMaterial map={texture} transparent depthWrite={false} />
    </sprite>
  );
}

function steerAroundObstacles(
  position: THREE.Vector3,
  desired: THREE.Vector3,
  avoidance: THREE.Vector3,
  teamId: number,
  telemetry: Map<number, ActorTelemetry>,
) {
  avoidance.set(0, 0, 0);
  const lookAhead = ACTOR_RADIUS + 0.85;
  const aheadX = position.x + desired.x * lookAhead;
  const aheadZ = position.z + desired.z * lookAhead;

  STATIC_COLLIDERS.forEach((collider) => {
    const dx = aheadX - collider.x;
    const dz = aheadZ - collider.z;
    const distance = Math.hypot(dx, dz);
    const safeDistance = ACTOR_RADIUS + collider.radius + 0.38;
    if (distance >= safeDistance) return;
    const weight = 1 - distance / safeDistance;
    avoidance.x += (dx / Math.max(distance, 0.001)) * weight;
    avoidance.z += (dz / Math.max(distance, 0.001)) * weight;
  });

  telemetry.forEach((other, otherId) => {
    if (otherId === teamId) return;
    const dx = aheadX - other.x;
    const dz = aheadZ - other.z;
    const distance = Math.hypot(dx, dz);
    const safeDistance = ACTOR_RADIUS * 2 + 0.3;
    if (distance >= safeDistance) return;
    const weight = (1 - distance / safeDistance) * 0.7;
    avoidance.x += (dx / Math.max(distance, 0.001)) * weight;
    avoidance.z += (dz / Math.max(distance, 0.001)) * weight;
  });

  const ellipseAmount = (position.x / ISLAND_RADIUS_X) ** 2 + (position.z / ISLAND_RADIUS_Z) ** 2;
  if (ellipseAmount > 0.68) {
    const weight = THREE.MathUtils.smoothstep(ellipseAmount, 0.68, 1);
    avoidance.x += (-position.x / (ISLAND_RADIUS_X ** 2)) * weight * 15;
    avoidance.z += (-position.z / (ISLAND_RADIUS_Z ** 2)) * weight * 15;
  }
  if (avoidance.lengthSq() > 0.0001) desired.add(avoidance.multiplyScalar(1.35));
  return desired.normalize();
}

const UP_AXIS = new THREE.Vector3(0, 1, 0);

function PeterActorComponent({
  team,
  selectionRef,
  telemetry,
  collisionCount,
  onSelect,
  castShadows,
  animationFps,
  steeringFps,
}: PeterActorProps) {
  const body = useRef<RapierRigidBody>(null);
  const visual = useRef<THREE.Group>(null);
  const label = useRef<THREE.Sprite>(null);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const lastSelection = useRef<number | null | undefined>(undefined);
  const color = team.color || FALLBACK_COLORS[(team.id - 1) % FALLBACK_COLORS.length];
  const speed = useMemo(() => 0.28 + seeded(team.id, 9) * 0.1, [team.id]);
  const initialPosition = useMemo(() => actorStartPosition(team.id), [team.id]);
  const movement = useRef({
    angle: seeded(team.id, 201) * Math.PI * 2,
    timer: 0.6 + seeded(team.id, 202) * 1.8,
    step: 0,
    turnRate: (seeded(team.id, 203) - 0.5) * 0.75,
    velocity: new THREE.Vector3(),
    previous: initialPosition.clone(),
    position: new THREE.Vector3(),
    desired: new THREE.Vector3(),
    avoidance: new THREE.Vector3(),
    currentQuaternion: new THREE.Quaternion(),
    targetQuaternion: new THREE.Quaternion(),
    lockedPosition: new THREE.Vector3(),
    selected: false,
    distance: 0,
    steeringElapsed: seeded(team.id, 520) / steeringFps,
  });
  const telemetryValue = useRef<ActorTelemetry>({
    x: initialPosition.x,
    z: initialPosition.z,
    distanceTravelled: 0,
  });
  const [modelReady, setModelReady] = useState(false);
  const markModelReady = useMemo(() => () => setModelReady(true), []);

  useEffect(() => {
    telemetry.current.set(team.id, telemetryValue.current);
    return () => { telemetry.current.delete(team.id); };
  }, [initialPosition, team.id, telemetry]);

  useFrame(({ camera, clock }, delta) => {
    const rigidBody = body.current;
    if (!rigidBody) return;
    const positionValue = rigidBody.translation();
    const state = movement.current;
    const position = state.position.set(positionValue.x, 0, positionValue.z);
    const selectedTeamId = selectionRef.current;
    const isSelected = selectedTeamId === team.id;

    if (isSelected) {
      if (!state.selected) state.lockedPosition.copy(position);
      state.selected = true;
      position.copy(state.lockedPosition);
      state.velocity.set(0, 0, 0);
      rigidBody.setTranslation({ x: position.x, y: 0, z: position.z }, true);
      rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);

      state.desired.set(camera.position.x - position.x, 0, camera.position.z - position.z);
      if (state.desired.lengthSq() > 0.0001) state.desired.normalize();
    } else {
      if (state.selected) state.steeringElapsed = 1 / steeringFps;
      state.selected = false;
      state.steeringElapsed += Math.min(delta, 0.1);
      const steeringInterval = 1 / steeringFps;
      if (state.steeringElapsed >= steeringInterval) {
        const steeringDelta = Math.min(state.steeringElapsed, 0.12);
        state.steeringElapsed %= steeringInterval;
        state.timer -= steeringDelta;
        if (state.timer <= 0) {
          state.step += 1;
          state.turnRate = (seeded(team.id, 203 + state.step * 2) - 0.5) * 0.9;
          state.timer = 1.35 + seeded(team.id, 204 + state.step * 2) * 2.4;
        }
        state.angle += state.turnRate * steeringDelta;
        const desired = steerAroundObstacles(
          position,
          state.desired.set(Math.sin(state.angle), 0, Math.cos(state.angle)),
          state.avoidance,
          team.id,
          telemetry.current,
        );
        const desiredVelocity = desired.multiplyScalar(speed);
        state.velocity.lerp(desiredVelocity, 1 - Math.exp(-1.8 * steeringDelta));
        rigidBody.setLinvel({ x: state.velocity.x, y: 0, z: state.velocity.z }, true);
      }
    }

    const facingDirection = isSelected ? state.desired : state.velocity;
    if (facingDirection.lengthSq() > 0.0004) {
      const forwardYaw = modelReady ? IMPORTED_MODEL_FORWARD_YAW : 0;
      const yaw = Math.atan2(facingDirection.x, facingDirection.z) + forwardYaw;
      const currentRotation = rigidBody.rotation();
      state.currentQuaternion.set(currentRotation.x, currentRotation.y, currentRotation.z, currentRotation.w);
      state.targetQuaternion.setFromAxisAngle(UP_AXIS, yaw);
      state.currentQuaternion.slerp(state.targetQuaternion, Math.min(1, delta * (isSelected ? 6.5 : 2.8)));
      rigidBody.setRotation(state.currentQuaternion, true);
    }

    state.distance += Math.hypot(position.x - state.previous.x, position.z - state.previous.z);
    state.previous.copy(position);
    telemetryValue.current.x = position.x;
    telemetryValue.current.z = position.z;
    telemetryValue.current.distanceTravelled = state.distance;

    if (visual.current) {
      if (lastSelection.current !== selectedTeamId) {
        visual.current.scale.setScalar(isSelected ? 1.28 : 1);
        if (label.current) label.current.visible = selectedTeamId === null;
        lastSelection.current = selectedTeamId;
      }
      const selectedPosition = selectedTeamId === null ? null : telemetry.current.get(selectedTeamId);
      const hiddenBySelection = selectedTeamId !== null
        && selectedTeamId !== team.id
        && selectedPosition != null
        && Math.hypot(position.x - selectedPosition.x, position.z - selectedPosition.z) < 2.8;
      visual.current.visible = !hiddenBySelection;
      if (!modelReady) {
        visual.current.position.y = isSelected
          ? 0
          : Math.abs(Math.sin(clock.elapsedTime * 3.4 + seeded(team.id, 11) * Math.PI * 2)) * 0.035;
      }
    }
  });

  const demo = <DemoPeter color={color} teamId={team.id} castShadows={castShadows} />;
  return (
    <RigidBody
      ref={body}
      name={`peter-${team.id}`}
      position={[initialPosition.x, 0, initialPosition.z]}
      rotation={[0, movement.current.angle, 0]}
      colliders={false}
      gravityScale={0}
      linearDamping={1.2}
      angularDamping={8}
      lockRotations
      enabledTranslations={[true, false, true]}
      canSleep={false}
      onCollisionEnter={() => { collisionCount.current += 1; }}
    >
      <CapsuleCollider args={[0.34, ACTOR_RADIUS]} position={[0, 0.72, 0]} friction={0.2} restitution={0} />
      <mesh
        name={`peter-${team.id}-interaction`}
        position-y={0.86}
        onPointerDown={(event) => {
          pointerStart.current = { x: event.nativeEvent.clientX, y: event.nativeEvent.clientY };
        }}
        onPointerUp={(event) => {
          const start = pointerStart.current;
          pointerStart.current = null;
          if (!start || Math.hypot(event.nativeEvent.clientX - start.x, event.nativeEvent.clientY - start.y) > 10) return;
          event.stopPropagation();
          onSelect(team.id);
        }}
      >
        <capsuleGeometry args={[0.42, 1.05, 4, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
      <group ref={visual} scale={1}>
        {team.model_url ? (
          <QueuedRiggedPeter
            teamId={team.id}
            url={team.model_url}
            speed={speed}
            selectionRef={selectionRef}
            onReady={markModelReady}
            castShadows={castShadows}
            animationFps={animationFps}
            fallback={demo}
          />
        ) : demo}
        <TeamLabel name={team.name} color={color} visible={selectionRef.current === null} spriteRef={label} />
      </group>
    </RigidBody>
  );
}

function actorsAreEqual(previous: PeterActorProps, next: PeterActorProps) {
  return previous.team.id === next.team.id
    && previous.team.name === next.team.name
    && previous.team.color === next.team.color
    && previous.team.model_url === next.team.model_url
    && previous.selectionRef === next.selectionRef
    && previous.telemetry === next.telemetry
    && previous.collisionCount === next.collisionCount
    && previous.onSelect === next.onSelect
    && previous.castShadows === next.castShadows
    && previous.animationFps === next.animationFps
    && previous.steeringFps === next.steeringFps;
}

export const PeterActor = memo(PeterActorComponent, actorsAreEqual);

// Preloading is intentionally omitted: 25 event models can be large, and each
// actor should stream independently while the light demo Peter remains visible.
