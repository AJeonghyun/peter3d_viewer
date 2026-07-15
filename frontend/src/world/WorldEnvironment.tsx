import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import { CuboidCollider, CylinderCollider, RigidBody } from '@react-three/rapier';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import groundTextureUrl from '../../../static/assets/galilee-ground-v1.png';
import {
  ISLAND_RADIUS_X,
  ISLAND_RADIUS_Z,
  STATIC_COLLIDERS,
  seeded,
} from './config';
import type { WorldQualityProfile } from './quality';

const waterVertexShader = `
  uniform float time;
  varying vec3 localPosition;
  varying float wave;
  void main() {
    localPosition = position;
    vec3 p = position;
    wave = sin(p.x * .42 + time) * .035 + cos(p.y * .31 - time * .72) * .025;
    p.z += wave;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const waterFragmentShader = `
  varying vec3 localPosition;
  varying float wave;
  uniform float time;
  void main() {
    vec3 deep = vec3(.025, .12, .18);
    vec3 light = vec3(.10, .34, .39);
    float ripple = sin(localPosition.x * 1.1 + time * .8) * sin(localPosition.y * .75 - time * .55);
    vec3 waterColor = mix(deep, light, clamp(wave * 2.8 + .46 + ripple * .035, 0.0, 1.0));
    gl_FragColor = vec4(waterColor, 1.0);
  }
`;

function Water({ segments }: { segments: number }) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => ({ time: { value: 0 } }), []);
  useFrame(({ clock }) => {
    if (material.current) material.current.uniforms.time.value = clock.elapsedTime * 0.55;
  });

  return (
    <mesh rotation-x={-Math.PI / 2} position-y={-0.18} receiveShadow>
      <planeGeometry args={[90, 90, segments, segments]} />
      <shaderMaterial
        ref={material}
        vertexShader={waterVertexShader}
        fragmentShader={waterFragmentShader}
        uniforms={uniforms}
      />
    </mesh>
  );
}

function Campfire({ castLightShadow }: { castLightShadow: boolean }) {
  const group = useRef<THREE.Group>(null);
  const glow = useRef<THREE.PointLight>(null);
  const flames = useRef<Array<THREE.Mesh | null>>([]);
  const stones = useMemo(() => Array.from({ length: 11 }, (_, index) => {
    const angle = (index / 11) * Math.PI * 2;
    return {
      angle,
      radius: 0.19 + seeded(index + 1, 70) * 0.06,
      color: ['#68665b', '#817a68', '#535851'][index % 3],
      rotation: [seeded(index + 1, 71), angle, seeded(index + 1, 72)] as [number, number, number],
    };
  }), []);

  useFrame(({ clock }, delta) => {
    const elapsed = clock.elapsedTime;
    flames.current.forEach((flame, index) => {
      if (!flame) return;
      const phase = index * 1.7;
      flame.scale.y = 0.88 + Math.sin(elapsed * 8.2 + phase) * 0.13;
      flame.scale.x = 0.94 + Math.sin(elapsed * 6.7 + phase) * 0.06;
      flame.rotation.y += delta * (0.55 + phase * 0.08);
    });
    if (glow.current) glow.current.intensity = 4.4 + Math.sin(elapsed * 9.3) * 0.5;
    if (group.current) group.current.rotation.y += delta * 0.002;
  });

  const flameSpecs = [
    { color: '#f06a2f', radius: 0.48, height: 1.25, x: 0, y: 0.72 },
    { color: '#ffa43b', radius: 0.32, height: 0.92, x: -0.12, y: 0.67 },
    { color: '#ffe28a', radius: 0.18, height: 0.62, x: 0.12, y: 0.57 },
  ];

  return (
    <group ref={group} position={[0, 0, 0.25]}>
      {stones.map((stone, index) => (
        <mesh
          key={index}
          castShadow
          scale={[1.25, 0.72, 0.9]}
          position={[Math.cos(stone.angle) * 0.63, 0.13, Math.sin(stone.angle) * 0.63]}
          rotation={stone.rotation}
        >
          <dodecahedronGeometry args={[stone.radius, 0]} />
          <meshStandardMaterial color={stone.color} roughness={0.98} flatShading />
        </mesh>
      ))}
      {Array.from({ length: 4 }, (_, index) => (
        <mesh key={index} castShadow position-y={0.24} rotation={[0, index * Math.PI / 4, Math.PI / 2]}>
          <cylinderGeometry args={[0.105, 0.13, 1.18, 10]} />
          <meshStandardMaterial
            color={index < 2 ? '#39251d' : '#5a2d1c'}
            emissive={index < 2 ? '#000000' : '#6a1d09'}
            emissiveIntensity={index < 2 ? 0 : 0.7}
            roughness={1}
          />
        </mesh>
      ))}
      {flameSpecs.map((flame, index) => (
        <mesh
          key={flame.color}
          ref={(node) => { flames.current[index] = node; }}
          position={[flame.x, flame.y, index * 0.035]}
        >
          <coneGeometry args={[flame.radius, flame.height, 18]} />
          <meshBasicMaterial
            color={flame.color}
            transparent
            opacity={0.82}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
      ))}
      <pointLight
        ref={glow}
        position-y={1.1}
        color="#ff7a32"
        intensity={4.6}
        distance={11}
        decay={1.7}
        castShadow={castLightShadow}
      />
    </group>
  );
}

function CampSeats() {
  return (
    <>
      {Array.from({ length: 4 }, (_, index) => {
        const angle = Math.PI * 0.25 + index * Math.PI / 2;
        return (
          <group
            key={index}
            position={[Math.cos(angle) * 1.72, 0.34, Math.sin(angle) * 1.72]}
            rotation-y={Math.PI / 2 - angle}
          >
            <mesh castShadow rotation-z={Math.PI / 2}>
              <cylinderGeometry args={[0.17, 0.2, 1.18, 12]} />
              <meshStandardMaterial color="#5d3925" roughness={0.96} />
            </mesh>
            {[-1, 1].map((side) => (
              <mesh key={side} position={[side * 0.38, -0.19, 0]}>
                <cylinderGeometry args={[0.09, 0.11, 0.35, 8]} />
                <meshStandardMaterial color="#5d3925" roughness={0.96} />
              </mesh>
            ))}
          </group>
        );
      })}
      <mesh position={[1.25, 0.18, 0.92]} castShadow>
        <cylinderGeometry args={[0.24, 0.18, 0.34, 12]} />
        <meshStandardMaterial color="#9b7042" roughness={1} wireframe />
      </mesh>
    </>
  );
}

function Boat() {
  const position: [number, number, number] = [-8.35, 0.02, -3.55];
  return (
    <group position={position} rotation-y={-0.18}>
      <mesh scale={[1, 0.35, 0.48]} rotation-x={Math.PI} castShadow>
        <sphereGeometry args={[1.35, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#74472d" roughness={0.82} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} rotation-z={Math.PI / 2} position={[0, 0.34, side * 0.58]} castShadow>
          <cylinderGeometry args={[0.055, 0.07, 2.55, 8]} />
          <meshStandardMaterial color="#3f2a20" roughness={0.95} />
        </mesh>
      ))}
      {Array.from({ length: 3 }, (_, index) => (
        <mesh key={index} position={[-0.72 + index * 0.72, 0.38, 0]} castShadow>
          <boxGeometry args={[0.18, 0.09, 1.02]} />
          <meshStandardMaterial color="#3f2a20" roughness={0.95} />
        </mesh>
      ))}
      <mesh position={[-0.36, 1.32, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.06, 2.3, 8]} />
        <meshStandardMaterial color="#4b3022" roughness={1} />
      </mesh>
      <mesh position={[0.22, 1.45, 0.02]} castShadow>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[new Float32Array([-0.51, 0.8, 0, -0.51, -0.8, 0, 0.68, -0.72, 0]), 3]}
          />
        </bufferGeometry>
        <meshBasicMaterial color="#dccda7" side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, -0.55]} position={[0.25, 0.55, 0.7]} castShadow>
        <cylinderGeometry args={[0.025, 0.04, 2.25, 8]} />
        <meshStandardMaterial color="#3f2a20" roughness={0.95} />
      </mesh>
      <pointLight position={[-0.92, 0.58, -0.34]} color="#ffa44c" intensity={0.9} distance={3.4} decay={2} />
    </group>
  );
}

function RocksAndBushes() {
  const rocks = useMemo(() => STATIC_COLLIDERS.filter(({ name }) => name.startsWith('rock-')), []);
  const bushes = useMemo(() => STATIC_COLLIDERS.filter(({ name }) => name.startsWith('bush-')), []);
  return (
    <>
      {rocks.map((rock, index) => (
        <mesh
          key={rock.name}
          position={[rock.x, 0.1, rock.z]}
          scale={[1, 0.55 + seeded(index + 1, 15) * 0.8, 1]}
          rotation={[seeded(index + 1, 18), seeded(index + 1, 20) * Math.PI, 0]}
          castShadow
        >
          <dodecahedronGeometry args={[rock.radius - 0.05, 1]} />
          <meshStandardMaterial color={['#646b63', '#7b796c', '#505b57'][index % 3]} roughness={1} flatShading />
        </mesh>
      ))}
      {bushes.map((bush, index) => {
        const scale = bush.radius / 0.58;
        return (
          <group key={bush.name} position={[bush.x, 0, bush.z]} scale={scale}>
            {Array.from({ length: 3 }, (_, part) => (
              <mesh key={part} position={[(part - 1) * 0.3, 0.32 + part * 0.06, (seeded(index + 1, part + 94) - 0.5) * 0.2]} castShadow>
                <icosahedronGeometry args={[0.34 + seeded(index + 1, part + 90) * 0.22, 1]} />
                <meshStandardMaterial color={['#3e654c', '#4d7351', '#5a7950'][(index + part) % 3]} roughness={1} flatShading />
              </mesh>
            ))}
          </group>
        );
      })}
    </>
  );
}

function GroundDetails() {
  const grassRef = useRef<THREE.InstancedMesh>(null);
  const flowerRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const color = new THREE.Color();
    for (let index = 0; index < 165; index += 1) {
      const id = index + 1;
      const angle = seeded(id, 80) * Math.PI * 2;
      const radius = 2.4 + seeded(id, 81) * 10.8;
      const scale = 0.75 + seeded(id, 82) * 1.05;
      quaternion.setFromEuler(new THREE.Euler(0, seeded(id, 83) * Math.PI, (seeded(id, 84) - 0.5) * 0.16));
      matrix.compose(
        new THREE.Vector3(Math.cos(angle) * radius * 1.12, 0.01, Math.sin(angle) * radius * 0.77),
        quaternion,
        new THREE.Vector3(scale, scale, scale),
      );
      grassRef.current?.setMatrixAt(index, matrix);
      color.setHSL(0.2 + seeded(id, 85) * 0.045, 0.3, 0.43 + seeded(id, 86) * 0.11);
      grassRef.current?.setColorAt(index, color);
    }
    grassRef.current?.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    if (grassRef.current?.instanceColor) grassRef.current.instanceColor.needsUpdate = true;

    const flowerColors = ['#e8b660', '#d98d89', '#d9d3a6', '#9bb5c5'];
    for (let index = 0; index < 42; index += 1) {
      const id = index + 1;
      const angle = seeded(id, 102) * Math.PI * 2;
      const radius = 3.3 + seeded(id, 103) * 8.5;
      const scale = 0.72 + seeded(id, 104) * 0.55;
      matrix.compose(
        new THREE.Vector3(Math.cos(angle) * radius * 1.1, 0.18, Math.sin(angle) * radius * 0.75),
        new THREE.Quaternion(),
        new THREE.Vector3(scale, scale, scale),
      );
      flowerRef.current?.setMatrixAt(index, matrix);
      flowerRef.current?.setColorAt(index, new THREE.Color(flowerColors[index % flowerColors.length]));
    }
    if (flowerRef.current?.instanceColor) flowerRef.current.instanceColor.needsUpdate = true;
  }, []);

  const grassPositions = useMemo(() => new Float32Array([
    -0.075, 0, 0, 0.075, 0, 0, 0, 0.24, 0,
    0, 0, -0.075, 0, 0, 0.075, 0, 0.24, 0,
  ]), []);

  return (
    <>
      <instancedMesh ref={grassRef} args={[undefined, undefined, 165]} castShadow receiveShadow>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[grassPositions, 3]} />
        </bufferGeometry>
        <meshStandardMaterial color="#91a867" roughness={1} side={THREE.DoubleSide} />
      </instancedMesh>
      <instancedMesh ref={flowerRef} args={[undefined, undefined, 42]} castShadow>
        <octahedronGeometry args={[0.055, 0]} />
        <meshStandardMaterial color="#ffffff" roughness={0.85} flatShading />
      </instancedMesh>
    </>
  );
}

function DistantShore() {
  const stars = useMemo(() => {
    const positions = new Float32Array(170 * 3);
    for (let index = 0; index < 170; index += 1) {
      const angle = seeded(index + 1, 130) * Math.PI * 2;
      const radius = 24 + seeded(index + 1, 131) * 24;
      positions[index * 3] = Math.cos(angle) * radius;
      positions[index * 3 + 1] = 12 + seeded(index + 1, 132) * 18;
      positions[index * 3 + 2] = Math.sin(angle) * radius;
    }
    return positions;
  }, []);
  return (
    <>
      {Array.from({ length: 9 }, (_, index) => (
        <mesh
          key={index}
          position={[-24 + index * 6.2, 0.3, -24 - seeded(index + 1, 62) * 4]}
          scale={[1.8, 0.42 + seeded(index + 1, 61) * 0.16, 0.7]}
          receiveShadow
        >
          <icosahedronGeometry args={[3.4 + seeded(index + 1, 60) * 2.2, 2]} />
          <meshStandardMaterial color={['#1b4548', '#234f4c', '#2c5950'][index % 3]} roughness={1} flatShading />
        </mesh>
      ))}
      <mesh position={[-12, 13, -31]}>
        <circleGeometry args={[1.55, 48]} />
        <meshBasicMaterial color="#f4d99a" transparent opacity={0.88} fog={false} toneMapped={false} />
      </mesh>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[stars, 3]} />
        </bufferGeometry>
        <pointsMaterial color="#e7f0e7" size={0.08} transparent opacity={0.7} />
      </points>
    </>
  );
}

export const WorldPhysicsColliders = memo(function WorldPhysicsColliders() {
  const boundary = useMemo(() => Array.from({ length: 40 }, (_, index) => {
    const angle = (index / 40) * Math.PI * 2;
    const nextAngle = ((index + 1) / 40) * Math.PI * 2;
    const x = Math.cos(angle) * (ISLAND_RADIUS_X + 0.18);
    const z = Math.sin(angle) * (ISLAND_RADIUS_Z + 0.18);
    const nextX = Math.cos(nextAngle) * (ISLAND_RADIUS_X + 0.18);
    const nextZ = Math.sin(nextAngle) * (ISLAND_RADIUS_Z + 0.18);
    return {
      x: (x + nextX) / 2,
      z: (z + nextZ) / 2,
      length: Math.hypot(nextX - x, nextZ - z) + 0.18,
      rotation: -Math.atan2(nextZ - z, nextX - x),
    };
  }), []);

  return (
    <>
      {STATIC_COLLIDERS.map((collider) => (
        <RigidBody key={collider.name} type="fixed" colliders={false} position={[collider.x, 0, collider.z]}>
          <CylinderCollider args={[0.8, collider.radius + 0.04]} position={[0, 0.8, 0]} />
        </RigidBody>
      ))}
      {boundary.map((segment, index) => (
        <RigidBody key={index} type="fixed" colliders={false} position={[segment.x, 0.8, segment.z]} rotation={[0, segment.rotation, 0]}>
          <CuboidCollider args={[segment.length / 2, 0.8, 0.16]} />
        </RigidBody>
      ))}
    </>
  );
});

export const WorldEnvironment = memo(function WorldEnvironment({ quality }: { quality: WorldQualityProfile }) {
  const groundTexture = useTexture(groundTextureUrl);
  useLayoutEffect(() => {
    groundTexture.wrapS = groundTexture.wrapT = THREE.RepeatWrapping;
    groundTexture.repeat.set(3.1, 2.45);
    groundTexture.colorSpace = THREE.SRGBColorSpace;
    groundTexture.needsUpdate = true;
  }, [groundTexture]);

  return (
    <>
      <hemisphereLight args={[0xcce9e2, 0x765330, 1.58]} />
      <directionalLight
        position={[-5, 10, 5]}
        color="#cfeeff"
        intensity={2.35}
        castShadow
        shadow-mapSize={[quality.shadowMapSize, quality.shadowMapSize]}
        shadow-camera-left={-15}
        shadow-camera-right={15}
        shadow-camera-top={15}
        shadow-camera-bottom={-15}
      />
      <DistantShore />
      <Water segments={quality.waterSegments} />
      <mesh position-y={-0.31} scale={[1.16, 1, 0.82]} receiveShadow>
        <cylinderGeometry args={[14.35, 14.72, 0.58, 96]} />
        <meshStandardMaterial color="#80633c" roughness={1} />
      </mesh>
      <mesh position-y={0.002} rotation-x={-Math.PI / 2} scale={[1.16, 0.82, 1]} receiveShadow>
        <circleGeometry args={[14.25, 96]} />
        <meshStandardMaterial map={groundTexture} color="#f0ddb0" roughness={0.96} metalness={0} />
      </mesh>
      <Campfire castLightShadow={quality.tier === 'high'} />
      <CampSeats />
      <Boat />
      <RocksAndBushes />
      <GroundDetails />
      {quality.postprocessing && (
        <EffectComposer multisampling={0} enableNormalPass={false}>
          <Bloom intensity={0.5} luminanceThreshold={0.68} luminanceSmoothing={0.3} mipmapBlur />
          <Vignette offset={0.18} darkness={0.52} eskil={false} />
        </EffectComposer>
      )}
    </>
  );
});
