import { memo, Suspense, useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Physics } from '@react-three/rapier';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import type { Team } from '../types/api';
import type { ActorTelemetry, ModelLoadStats } from './config';
import { PeterActor } from './PeterActor';
import { ModelLoadPriority, ModelLoadQueueProvider } from './modelLoadQueue';
import { WorldEnvironment, WorldPhysicsColliders } from './WorldEnvironment';
import { detectWorldQuality } from './quality';
import type { WorldQualityProfile } from './quality';

interface GalileeCanvasProps {
  teams: Team[];
  selectionRef: RefObject<number | null>;
  telemetry: RefObject<Map<number, ActorTelemetry>>;
  collisionCount: RefObject<number>;
  modelLoadStats: RefObject<ModelLoadStats>;
  onSelect: (teamId: number) => void;
  onReady: () => void;
  onModelLoadProgress: (stats: ModelLoadStats) => void;
}

function SceneReady({ onReady }: { onReady: () => void }) {
  useEffect(() => { onReady(); }, [onReady]);
  return null;
}

function CameraRig({ selectionRef, telemetry }: Pick<GalileeCanvasProps, 'selectionRef' | 'telemetry'>) {
  const { camera, size } = useThree();
  const controls = useRef<OrbitControlsImpl>(null);
  const cameraGoal = useRef(new THREE.Vector3());
  const targetGoal = useRef(new THREE.Vector3());
  const followedPosition = useRef(new THREE.Vector3());
  const hasCameraGoal = useRef(false);
  const hasFollowedPosition = useRef(false);
  const focusVelocity = useRef(0.075);
  const previousSelection = useRef<number | null>(null);
  const scratch = useMemo(() => ({
    position: new THREE.Vector3(),
    movement: new THREE.Vector3(),
  }), []);

  useFrame(() => {
    const orbit = controls.current;
    if (!orbit) return;

    const selectedTeamId = selectionRef.current;
    if (selectedTeamId !== previousSelection.current) {
      const wasSelected = previousSelection.current !== null;
      if (selectedTeamId === null) {
        previousSelection.current = null;
        hasFollowedPosition.current = false;
        if (wasSelected) {
          cameraGoal.current.set(0, 13.2, 18.5);
          targetGoal.current.set(0, 0, 0);
          focusVelocity.current = 0.055;
          hasCameraGoal.current = true;
        }
      } else {
        const actor = telemetry.current.get(selectedTeamId);
        if (actor) {
          scratch.position.set(actor.x, 0, actor.z);
          cameraGoal.current.copy(scratch.position).add(
            size.width < 760
              ? scratch.movement.set(1.8, 1.65, 2.7)
              : scratch.movement.set(2.35, 1.85, 3.4),
          );
          targetGoal.current.copy(scratch.position).add(scratch.movement.set(0, 0.86, 0));
          followedPosition.current.copy(scratch.position);
          hasFollowedPosition.current = true;
          focusVelocity.current = 0.085;
          hasCameraGoal.current = true;
          previousSelection.current = selectedTeamId;
        }
      }
    }

    if (selectedTeamId !== null) {
      const actor = telemetry.current.get(selectedTeamId);
      if (actor) {
        scratch.position.set(actor.x, 0, actor.z);
        if (hasFollowedPosition.current) {
          scratch.movement.subVectors(scratch.position, followedPosition.current);
          camera.position.add(scratch.movement);
          orbit.target.add(scratch.movement);
          if (hasCameraGoal.current) {
            cameraGoal.current.add(scratch.movement);
            targetGoal.current.add(scratch.movement);
          }
        }
        followedPosition.current.copy(scratch.position);
        hasFollowedPosition.current = true;
      }
    }

    if (hasCameraGoal.current) {
      camera.position.lerp(cameraGoal.current, focusVelocity.current);
      orbit.target.lerp(targetGoal.current, focusVelocity.current);
      if (camera.position.distanceTo(cameraGoal.current) < 0.03) {
        hasCameraGoal.current = false;
      }
    }
    orbit.update();
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={[0, 0, 0]}
      enableDamping
      dampingFactor={0.055}
      minDistance={3}
      maxDistance={23}
      minPolarAngle={0.48}
      maxPolarAngle={1.18}
      enablePan
      screenSpacePanning={false}
    />
  );
}

interface PhysicsWorldProps extends Omit<GalileeCanvasProps, 'selectionRef'> {
  selectionRef: RefObject<number | null>;
  quality: WorldQualityProfile;
}

const PhysicsWorld = memo(function PhysicsWorld(props: PhysicsWorldProps) {
  return (
    <Physics gravity={[0, 0, 0]} timeStep={props.quality.physicsTimeStep} interpolate>
      <WorldPhysicsColliders />
      {props.teams.map((team) => (
        <PeterActor
          key={team.id}
          team={team}
          selectionRef={props.selectionRef}
          telemetry={props.telemetry}
          collisionCount={props.collisionCount}
          onSelect={props.onSelect}
          castShadows={props.quality.characterShadows}
          animationFps={props.quality.animationFps}
          steeringFps={props.quality.steeringFps}
        />
      ))}
      <SceneReady onReady={props.onReady} />
    </Physics>
  );
});

const SceneContent = memo(function SceneContent(props: GalileeCanvasProps & { quality: WorldQualityProfile }) {
  return (
    <>
      <color attach="background" args={['#173c4b']} />
      <fogExp2 attach="fog" args={['#173c4b', 0.028]} />
      <ModelLoadQueueProvider
        limit={props.quality.modelLoadConcurrency}
        statsRef={props.modelLoadStats}
        onStatsChange={props.onModelLoadProgress}
      >
        <WorldEnvironment quality={props.quality} />
        <PhysicsWorld {...props} />
        <CameraRig selectionRef={props.selectionRef} telemetry={props.telemetry} />
        <ModelLoadPriority selectionRef={props.selectionRef} />
      </ModelLoadQueueProvider>
    </>
  );
});

export const GalileeCanvas = memo(function GalileeCanvas(props: GalileeCanvasProps) {
  const quality = useMemo(detectWorldQuality, []);
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.dataset.worldQuality;
    root.dataset.worldQuality = quality.tier;
    return () => {
      if (previous === undefined) delete root.dataset.worldQuality;
      else root.dataset.worldQuality = previous;
    };
  }, [quality.tier]);

  return (
    <Canvas
      id="galileeCanvas"
      aria-label="갈릴리 호숫가 3D 장면"
      camera={{ fov: 40, near: 0.1, far: 100, position: [0, 13.2, 18.5] }}
      dpr={[1, quality.maxDpr]}
      shadows={quality.characterShadows}
      gl={{ antialias: quality.antialias, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.domElement.dataset.quality = quality.tier;
        gl.shadowMap.enabled = quality.characterShadows;
        gl.shadowMap.type = quality.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
        gl.outputColorSpace = THREE.SRGBColorSpace;
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.2;
      }}
    >
      <Suspense fallback={null}>
        <SceneContent {...props} quality={quality} />
      </Suspense>
    </Canvas>
  );
});
