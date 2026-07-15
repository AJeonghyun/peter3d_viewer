import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const API = '/api';
const RESET_AFTER_MS = 45_000;
const STAT_LABELS = { courage: '용기', wisdom: '현명', faith: '진실', love: '열정' };
const fallbackColors = [
  '#e47b53', '#e7a94f', '#78b86b', '#58a9a8', '#5e92c8',
  '#8d7bc4', '#c677a2', '#c9805b', '#8ea653', '#4ba5bd',
];

const container = document.getElementById('scene');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x173c4b);
scene.fog = new THREE.FogExp2(0x173c4b, 0.028);

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 13.2, 18.5);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.65));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.055;
controls.minDistance = 5;
controls.maxDistance = 23;
controls.minPolarAngle = 0.48;
controls.maxPolarAngle = 1.18;
controls.enablePan = true;
controls.screenSpacePanning = false;

const clock = new THREE.Clock();
const loader = new GLTFLoader();
const MODEL_TARGET_HEIGHT = 1.38;
const MODEL_TARGET_WIDTH = 1.05;
const WALK_STRIDE_LENGTH = 0.78;
// The Tripo walk skeleton advances along local +X, while Three.js heading math
// below treats local +Z as forward. Rotate the imported heading by -90 degrees.
const IMPORTED_MODEL_FORWARD_YAW = -Math.PI / 2;
const ACTOR_TURN_SPEED = 2.8;
const ACTOR_COLLIDER_RADIUS = 0.38;
const WANDER_STEERING_SPEED = 1.8;

class GroundPhysicsWorld {
  constructor(radiusX, radiusZ) {
    this.radiusX = radiusX;
    this.radiusZ = radiusZ;
    this.staticColliders = [];
    this.collisionCount = 0;
  }

  addStaticCircle(name, x, z, radius) {
    this.staticColliders.push({ name, position: new THREE.Vector2(x, z), radius });
  }

  isCircleFree(x, z, radius, margin = 0.005) {
    const insideBoundary = (x / (this.radiusX - radius)) ** 2 + (z / (this.radiusZ - radius)) ** 2 <= 1;
    if (!insideBoundary) return false;
    return this.staticColliders.every(collider => (
      Math.hypot(x - collider.position.x, z - collider.position.y) >= radius + collider.radius + margin
    ));
  }

  placeAtNearestFree(actor, maxSearchRadius = 2.8) {
    const originX = actor.root.position.x;
    const originZ = actor.root.position.z;
    if (this.isCircleFree(originX, originZ, actor.colliderRadius)) return false;
    const angleOffset = seeded(actor.team.id, 311) * Math.PI * 2;
    for (let searchRadius = 0.16; searchRadius <= maxSearchRadius; searchRadius += 0.16) {
      const sampleCount = Math.max(12, Math.ceil(searchRadius * 18));
      for (let sample = 0; sample < sampleCount; sample += 1) {
        const angle = angleOffset + (sample / sampleCount) * Math.PI * 2;
        const x = originX + Math.cos(angle) * searchRadius;
        const z = originZ + Math.sin(angle) * searchRadius;
        if (!this.isCircleFree(x, z, actor.colliderRadius)) continue;
        actor.root.position.x = x;
        actor.root.position.z = z;
        return true;
      }
    }
    return false;
  }

  steeringDirection(actor, desired, actorList) {
    const position = actor.root.position;
    const avoidance = new THREE.Vector3();
    const lookAhead = actor.colliderRadius + 0.85;
    const aheadX = position.x + desired.x * lookAhead;
    const aheadZ = position.z + desired.z * lookAhead;

    this.staticColliders.forEach(collider => {
      const dx = aheadX - collider.position.x;
      const dz = aheadZ - collider.position.y;
      const distance = Math.hypot(dx, dz);
      const safeDistance = actor.colliderRadius + collider.radius + 0.38;
      if (distance >= safeDistance) return;
      const weight = 1 - distance / safeDistance;
      avoidance.x += (dx / Math.max(distance, 0.001)) * weight;
      avoidance.z += (dz / Math.max(distance, 0.001)) * weight;
    });

    actorList.forEach(other => {
      if (other === actor) return;
      const dx = aheadX - other.root.position.x;
      const dz = aheadZ - other.root.position.z;
      const distance = Math.hypot(dx, dz);
      const safeDistance = actor.colliderRadius + other.colliderRadius + 0.3;
      if (distance >= safeDistance) return;
      const weight = (1 - distance / safeDistance) * 0.7;
      avoidance.x += (dx / Math.max(distance, 0.001)) * weight;
      avoidance.z += (dz / Math.max(distance, 0.001)) * weight;
    });

    const edgeAmount = (position.x / this.radiusX) ** 2 + (position.z / this.radiusZ) ** 2;
    if (edgeAmount > 0.68) {
      const edgeWeight = THREE.MathUtils.smoothstep(edgeAmount, 0.68, 1);
      avoidance.x += (-position.x / (this.radiusX * this.radiusX)) * edgeWeight * 15;
      avoidance.z += (-position.z / (this.radiusZ * this.radiusZ)) * edgeWeight * 15;
    }

    if (avoidance.lengthSq() > 0.0001) desired.add(avoidance.multiplyScalar(1.35));
    return desired.normalize();
  }

  integrate(actor, delta) {
    const beforeX = actor.root.position.x;
    const beforeZ = actor.root.position.z;
    actor.root.position.addScaledVector(actor.velocity, delta);
    const collided = this.resolveStatic(actor);
    actor.distanceTravelled += Math.hypot(actor.root.position.x - beforeX, actor.root.position.z - beforeZ);
    if (collided && actor.velocity.lengthSq() > 0.0001) {
      actor.wanderAngle = Math.atan2(actor.velocity.x, actor.velocity.z);
      actor.wanderTimer = Math.min(actor.wanderTimer, 0.35);
    }
  }

  resolveStatic(actor) {
    const position = actor.root.position;
    let collided = false;

    for (let iteration = 0; iteration < 6; iteration += 1) {
      let correctionX = 0;
      let correctionZ = 0;
      let deepestPenetration = 0;
      let deepestNormalX = 1;
      let deepestNormalZ = 0;
      let overlapCount = 0;

      this.staticColliders.forEach(collider => {
        const dx = position.x - collider.position.x;
        const dz = position.z - collider.position.y;
        const distance = Math.hypot(dx, dz);
        const penetration = actor.colliderRadius + collider.radius - distance;
        if (penetration <= 0) return;
        const normalX = distance > 0.0001 ? dx / distance : deepestNormalX;
        const normalZ = distance > 0.0001 ? dz / distance : deepestNormalZ;
        correctionX += normalX * penetration;
        correctionZ += normalZ * penetration;
        overlapCount += 1;
        if (penetration > deepestPenetration) {
          deepestPenetration = penetration;
          deepestNormalX = normalX;
          deepestNormalZ = normalZ;
        }
      });

      if (!overlapCount) break;
      const correctionLength = Math.hypot(correctionX, correctionZ);
      const normalX = correctionLength > 0.0001 ? correctionX / correctionLength : deepestNormalX;
      const normalZ = correctionLength > 0.0001 ? correctionZ / correctionLength : deepestNormalZ;
      position.x += normalX * (deepestPenetration + 0.002);
      position.z += normalZ * (deepestPenetration + 0.002);
      const inwardSpeed = actor.velocity.x * normalX + actor.velocity.z * normalZ;
      if (inwardSpeed < 0) {
        actor.velocity.x -= normalX * inwardSpeed;
        actor.velocity.z -= normalZ * inwardSpeed;
      }
      collided = true;
    }
    if (collided) this.collisionCount += 1;

    const safeRadiusX = this.radiusX - actor.colliderRadius;
    const safeRadiusZ = this.radiusZ - actor.colliderRadius;
    const ellipseAmount = (position.x / safeRadiusX) ** 2 + (position.z / safeRadiusZ) ** 2;
    if (ellipseAmount > 1) {
      const scale = 1 / Math.sqrt(ellipseAmount);
      position.x *= scale;
      position.z *= scale;
      const normal = new THREE.Vector3(position.x / (safeRadiusX * safeRadiusX), 0, position.z / (safeRadiusZ * safeRadiusZ)).normalize();
      const outwardSpeed = actor.velocity.dot(normal);
      if (outwardSpeed > 0) actor.velocity.addScaledVector(normal, -outwardSpeed);
      collided = true;
      this.collisionCount += 1;
    }
    if (!this.isCircleFree(position.x, position.z, actor.colliderRadius, 0)) {
      this.placeAtNearestFree(actor, 1.6);
      collided = true;
    }
    return collided;
  }

  resolveActorPairs(actorList) {
    for (let firstIndex = 0; firstIndex < actorList.length; firstIndex += 1) {
      const first = actorList[firstIndex];
      for (let secondIndex = firstIndex + 1; secondIndex < actorList.length; secondIndex += 1) {
        const second = actorList[secondIndex];
        const dx = second.root.position.x - first.root.position.x;
        const dz = second.root.position.z - first.root.position.z;
        const distance = Math.hypot(dx, dz);
        const minimumDistance = first.colliderRadius + second.colliderRadius;
        if (distance >= minimumDistance) continue;
        const normalX = distance > 0.0001 ? dx / distance : 1;
        const normalZ = distance > 0.0001 ? dz / distance : 0;
        const correction = (minimumDistance - distance) * 0.5;
        first.root.position.x -= normalX * correction;
        first.root.position.z -= normalZ * correction;
        second.root.position.x += normalX * correction;
        second.root.position.z += normalZ * correction;
        const relativeSpeed = (second.velocity.x - first.velocity.x) * normalX + (second.velocity.z - first.velocity.z) * normalZ;
        if (relativeSpeed < 0) {
          const impulse = relativeSpeed * 0.5;
          first.velocity.x += normalX * impulse;
          first.velocity.z += normalZ * impulse;
          second.velocity.x -= normalX * impulse;
          second.velocity.z -= normalZ * impulse;
        }
        this.collisionCount += 1;
      }
    }
    actorList.forEach(actor => this.resolveStatic(actor));
  }

  snapshot(actorList) {
    let staticOverlaps = 0;
    let actorOverlaps = 0;
    actorList.forEach(actor => {
      this.staticColliders.forEach(collider => {
        const distance = Math.hypot(actor.root.position.x - collider.position.x, actor.root.position.z - collider.position.y);
        if (distance < actor.colliderRadius + collider.radius - 0.01) staticOverlaps += 1;
      });
    });
    for (let firstIndex = 0; firstIndex < actorList.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < actorList.length; secondIndex += 1) {
        const first = actorList[firstIndex];
        const second = actorList[secondIndex];
        const distance = first.root.position.distanceTo(second.root.position);
        if (distance < first.colliderRadius + second.colliderRadius - 0.01) actorOverlaps += 1;
      }
    }
    return {
      collisionCount: this.collisionCount,
      staticOverlaps,
      actorOverlaps,
      actors: actorList.map(actor => ({
        teamId: actor.team.id,
        x: Number(actor.root.position.x.toFixed(3)),
        z: Number(actor.root.position.z.toFixed(3)),
        distanceTravelled: Number(actor.distanceTravelled.toFixed(3)),
      })),
    };
  }
}

const physicsWorld = new GroundPhysicsWorld(13.5, 9.35);
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const actors = new Map();
let teams = [];
let selectedActor = null;
let pointerStart = null;
let resetTimer = null;
let cameraGoal = null;
let targetGoal = null;
let selectedFollowPosition = null;
let focusVelocity = 0.075;

// Each team owns a loose wandering cell. Three staggered rings keep all 25
// characters visible without piling their labels around the campfire.
const zones = Array.from({ length: 25 }, (_, index) => {
  let count;
  let offset;
  let radius;
  if (index < 12) { count = 12; offset = 0; radius = 9.1; }
  else if (index < 20) { count = 8; offset = 12; radius = 6.2; }
  else { count = 5; offset = 20; radius = 3.55; }
  const angle = ((index - offset) / count) * Math.PI * 2 + (offset ? 0.3 : 0.08);
  return new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius * 0.67);
});

function seeded(teamId, salt = 0) {
  const value = Math.sin(teamId * 91.733 + salt * 17.117) * 43758.5453;
  return value - Math.floor(value);
}

function setupEnvironment() {
  scene.add(new THREE.HemisphereLight(0xcce9e2, 0x765330, 1.58));
  const moon = new THREE.DirectionalLight(0xcfeeff, 2.35);
  moon.position.set(-5, 10, 5);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.left = -15;
  moon.shadow.camera.right = 15;
  moon.shadow.camera.top = 15;
  moon.shadow.camera.bottom = -15;
  scene.add(moon);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(68, 32, 18),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x0a2737) },
        horizonColor: { value: new THREE.Color(0x34636a) },
      },
      vertexShader: `varying float skyHeight; void main() { skyHeight = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 topColor; uniform vec3 horizonColor; varying float skyHeight; void main() { float t = smoothstep(-.08, .72, skyHeight); gl_FragColor = vec4(mix(horizonColor, topColor, t), 1.0); }`,
    })
  );
  scene.add(sky);

  createDistantShore();

  const groundTexture = new THREE.TextureLoader().load('/static/assets/galilee-ground-v1.png');
  groundTexture.wrapS = groundTexture.wrapT = THREE.RepeatWrapping;
  groundTexture.repeat.set(3.1, 2.45);
  groundTexture.colorSpace = THREE.SRGBColorSpace;
  groundTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const sandMaterial = new THREE.MeshStandardMaterial({
    map: groundTexture,
    color: 0xf0ddb0,
    roughness: 0.96,
    metalness: 0,
  });
  const islandBase = new THREE.Mesh(
    new THREE.CylinderGeometry(14.35, 14.72, 0.58, 96),
    new THREE.MeshStandardMaterial({ color: 0x80633c, roughness: 1 })
  );
  islandBase.scale.set(1.16, 1, 0.82);
  islandBase.position.y = -0.31;
  islandBase.receiveShadow = true;
  scene.add(islandBase);

  const island = new THREE.Mesh(new THREE.CircleGeometry(14.5, 96), sandMaterial);
  island.scale.set(1.16, 0.82, 1);
  island.rotation.x = -Math.PI / 2;
  island.position.y = -0.015;
  island.receiveShadow = true;
  scene.add(island);

  const shallow = new THREE.Mesh(
    new THREE.RingGeometry(14.35, 16.4, 128),
    new THREE.MeshStandardMaterial({ color: 0x68a9a3, roughness: 0.38, transparent: true, opacity: 0.44 })
  );
  shallow.scale.set(1.16, 0.82, 1);
  shallow.rotation.x = -Math.PI / 2;
  shallow.position.y = -0.09;
  scene.add(shallow);

  const waterUniforms = { time: { value: 0 } };
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 90, 42, 42),
    new THREE.ShaderMaterial({
      transparent: false,
      uniforms: waterUniforms,
      vertexShader: `
        uniform float time;
        varying float wave;
        varying vec2 localPosition;
        void main() {
          vec3 p = position;
          localPosition = p.xy;
          wave = sin(p.x * .32 + time) * .065 + cos(p.y * .27 + time * .7) * .045 + sin((p.x + p.y) * .17 - time * .45) * .025;
          p.z += wave;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        varying float wave;
        varying vec2 localPosition;
        void main() {
          vec3 deep = vec3(.025, .12, .18);
          vec3 light = vec3(.10, .34, .39);
          float ripple = sin(localPosition.x * 1.1 + time * .8) * sin(localPosition.y * .75 - time * .55);
          float islandDistance = length(vec2(localPosition.x / 16.8, localPosition.y / 11.9));
          float foam = smoothstep(.985, 1.0, islandDistance) * (1.0 - smoothstep(1.0, 1.035, islandDistance));
          foam *= .45 + .35 * sin(localPosition.x * 2.2 + localPosition.y * 1.7 + time * 1.3);
          vec3 waterColor = mix(deep, light, clamp(wave * 2.8 + .46 + ripple * .035, 0.0, 1.0));
          gl_FragColor = vec4(mix(waterColor, vec3(.72, .86, .80), max(foam, 0.0)), 1.0);
        }
      `,
    })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.18;
  water.userData.uniforms = waterUniforms;
  water.name = 'water';
  scene.add(water);

  createCampfire();
  createCampCircleProps();
  createBoat(-8.35, -3.55, -0.18);
  createProps();
  createStars();
}

function createDistantShore() {
  const hillColors = [0x1b4548, 0x234f4c, 0x2c5950];
  for (let i = 0; i < 9; i++) {
    const hill = new THREE.Mesh(
      new THREE.IcosahedronGeometry(3.4 + seeded(i + 1, 60) * 2.2, 2),
      new THREE.MeshStandardMaterial({ color: hillColors[i % hillColors.length], roughness: 1, flatShading: true })
    );
    hill.scale.set(1.8, 0.42 + seeded(i + 1, 61) * 0.16, 0.7);
    hill.position.set(-24 + i * 6.2, 0.3, -24 - seeded(i + 1, 62) * 4);
    hill.receiveShadow = true;
    scene.add(hill);
  }
  const moonDisc = new THREE.Mesh(
    new THREE.CircleGeometry(1.55, 48),
    new THREE.MeshBasicMaterial({ color: 0xf4d99a, transparent: true, opacity: 0.88, fog: false })
  );
  moonDisc.position.set(-12, 13, -31);
  scene.add(moonDisc);
}

function createCampfire() {
  const fire = new THREE.Group();
  fire.position.set(0, 0, 0.25);
  physicsWorld.addStaticCircle('campfire', fire.position.x, fire.position.z, 1.02);
  const stoneColors = [0x68665b, 0x817a68, 0x535851];
  for (let i = 0; i < 11; i++) {
    const angle = (i / 11) * Math.PI * 2;
    const stone = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.19 + seeded(i + 1, 70) * 0.06, 0),
      new THREE.MeshStandardMaterial({ color: stoneColors[i % stoneColors.length], roughness: 0.98, flatShading: true })
    );
    stone.scale.set(1.25, 0.72, 0.9);
    stone.position.set(Math.cos(angle) * 0.63, 0.13, Math.sin(angle) * 0.63);
    stone.rotation.set(seeded(i + 1, 71), angle, seeded(i + 1, 72));
    stone.castShadow = true;
    fire.add(stone);
  }
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x39251d, roughness: 1 });
  const emberWoodMat = new THREE.MeshStandardMaterial({ color: 0x5a2d1c, emissive: 0x6a1d09, emissiveIntensity: 0.7, roughness: 1 });
  for (let i = 0; i < 4; i++) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.13, 1.18, 10), i < 2 ? woodMat : emberWoodMat);
    log.rotation.z = Math.PI / 2;
    log.rotation.y = (i / 4) * Math.PI;
    log.position.y = 0.24;
    log.castShadow = true;
    fire.add(log);
  }
  const flames = [
    [0xf06a2f, 0.48, 1.25, 0, 0.72],
    [0xffa43b, 0.32, 0.92, -0.12, 0.67],
    [0xffe28a, 0.18, 0.62, 0.12, 0.57],
  ];
  flames.forEach(([color, radius, height, x, y], index) => {
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(radius, height, 18),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.82, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    flame.position.set(x, y, index * 0.035);
    flame.userData.flame = true;
    flame.userData.flamePhase = index * 1.7;
    fire.add(flame);
  });
  const sparkPositions = new Float32Array(54 * 3);
  const sparkSpeeds = [];
  for (let i = 0; i < 54; i++) {
    sparkPositions[i * 3] = (seeded(i + 1, 73) - 0.5) * 0.58;
    sparkPositions[i * 3 + 1] = 0.45 + seeded(i + 1, 74) * 1.65;
    sparkPositions[i * 3 + 2] = (seeded(i + 1, 75) - 0.5) * 0.5;
    sparkSpeeds.push(0.32 + seeded(i + 1, 76) * 0.62);
  }
  const sparkGeometry = new THREE.BufferGeometry();
  sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
  const sparks = new THREE.Points(sparkGeometry, new THREE.PointsMaterial({ color: 0xffbd58, size: 0.045, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  sparks.userData.embers = true;
  sparks.userData.speeds = sparkSpeeds;
  fire.add(sparks);
  const glow = new THREE.PointLight(0xff7a32, 4.6, 11, 1.7);
  glow.position.y = 1.1;
  glow.castShadow = true;
  glow.userData.fireLight = true;
  fire.add(glow);
  scene.add(fire);
}

function createCampCircleProps() {
  const seatMaterial = new THREE.MeshStandardMaterial({ color: 0x5d3925, roughness: 0.96 });
  const cutMaterial = new THREE.MeshStandardMaterial({ color: 0x9a7145, roughness: 1 });
  for (let i = 0; i < 4; i++) {
    const angle = Math.PI * 0.25 + i * Math.PI / 2;
    const seat = new THREE.Group();
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 1.18, 12), [seatMaterial, cutMaterial, cutMaterial]);
    log.rotation.z = Math.PI / 2;
    log.castShadow = true;
    seat.add(log);
    for (const side of [-1, 1]) {
      const support = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.35, 8), seatMaterial);
      support.position.set(side * 0.38, -0.19, 0);
      seat.add(support);
    }
    seat.position.set(Math.cos(angle) * 1.72, 0.34, Math.sin(angle) * 1.72);
    seat.rotation.y = Math.PI / 2 - angle;
    scene.add(seat);
    physicsWorld.addStaticCircle(`camp-seat-${i + 1}`, seat.position.x, seat.position.z, 0.7);
  }
  const basket = new THREE.Mesh(
    new THREE.CylinderGeometry(0.24, 0.18, 0.34, 12),
    new THREE.MeshStandardMaterial({ color: 0x9b7042, roughness: 1, wireframe: true })
  );
  basket.position.set(1.25, 0.18, 0.92);
  basket.castShadow = true;
  scene.add(basket);
  physicsWorld.addStaticCircle('basket', basket.position.x, basket.position.z, 0.32);
}

function createBoat(x, z, rotation) {
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x74472d, roughness: 0.82 });
  const darkWood = new THREE.MeshStandardMaterial({ color: 0x3f2a20, roughness: 0.95 });
  const hull = new THREE.Mesh(
    new THREE.SphereGeometry(1.35, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    wood
  );
  hull.scale.set(1, 0.35, 0.48);
  hull.rotation.x = Math.PI;
  group.add(hull);
  for (const side of [-1, 1]) {
    const gunwale = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 2.55, 8), darkWood);
    gunwale.rotation.z = Math.PI / 2;
    gunwale.position.set(0, 0.34, side * 0.58);
    group.add(gunwale);
  }
  for (let i = 0; i < 3; i++) {
    const bench = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.09, 1.02), darkWood);
    bench.position.set(-0.72 + i * 0.72, 0.38, 0);
    group.add(bench);
  }
  for (let i = 0; i < 7; i++) {
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.055, 0.66), wood);
    board.position.set(-0.9 + i * 0.3, 0.18, 0);
    group.add(board);
  }
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.06, 2.3, 8),
    new THREE.MeshStandardMaterial({ color: 0x4b3022, roughness: 1 })
  );
  mast.position.set(-0.36, 1.32, 0);
  group.add(mast);
  const sailGeometry = new THREE.BufferGeometry();
  sailGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.29, 2.25, 0, -0.29, 0.65, 0, 0.9, 0.73, 0,
  ], 3));
  sailGeometry.computeVertexNormals();
  const sail = new THREE.Mesh(sailGeometry, new THREE.MeshStandardMaterial({ color: 0xdccda7, roughness: 0.9, side: THREE.DoubleSide }));
  sail.position.z = 0.02;
  group.add(sail);
  const oar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 2.25, 8), darkWood);
  oar.rotation.set(Math.PI / 2, 0, -0.55);
  oar.position.set(0.25, 0.55, 0.7);
  group.add(oar);
  const rope = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.025, 7, 22), new THREE.MeshStandardMaterial({ color: 0xa68a61, roughness: 1 }));
  rope.rotation.x = Math.PI / 2;
  rope.position.set(0.82, 0.43, -0.18);
  group.add(rope);
  const lantern = new THREE.Group();
  const lanternFrame = new THREE.MeshStandardMaterial({ color: 0x3e3026, roughness: 0.8, metalness: 0.25 });
  const lanternBody = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.22, 8), new THREE.MeshBasicMaterial({ color: 0xffca6a, transparent: true, opacity: 0.88 }));
  lanternBody.position.y = 0.13;
  lantern.add(lanternBody);
  const lanternTop = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.09, 0.07, 8), lanternFrame);
  lanternTop.position.y = 0.28;
  lantern.add(lanternTop);
  const lanternGlow = new THREE.PointLight(0xffa44c, 0.9, 3.4, 2);
  lanternGlow.position.y = 0.16;
  lantern.add(lanternGlow);
  lantern.position.set(-0.92, 0.42, -0.34);
  group.add(lantern);
  group.position.set(x, 0.02, z);
  group.rotation.y = rotation;
  group.traverse(object => { if (object.isMesh) object.castShadow = true; });
  scene.add(group);
  physicsWorld.addStaticCircle('boat', x, z, 1.5);
}

function createProps() {
  const rockMats = [0x646b63, 0x7b796c, 0x505b57].map(color => new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true }));
  for (let i = 0; i < 26; i++) {
    const angle = seeded(i + 1, 4) * Math.PI * 2;
    const radius = 8.6 + seeded(i + 1, 8) * 3.4;
    const rockRadius = 0.18 + seeded(i + 1, 12) * 0.36;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(rockRadius, 1), rockMats[i % rockMats.length]);
    rock.scale.y = 0.55 + seeded(i + 1, 15) * 0.8;
    rock.position.set(Math.cos(angle) * radius, 0.1, Math.sin(angle) * radius * 0.72);
    rock.rotation.set(seeded(i + 1, 18), seeded(i + 1, 20) * Math.PI, 0);
    rock.castShadow = true;
    scene.add(rock);
    physicsWorld.addStaticCircle(`rock-${i + 1}`, rock.position.x, rock.position.z, rockRadius + 0.05);
  }

  const grassGeometry = new THREE.BufferGeometry();
  grassGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.075, 0, 0, 0.075, 0, 0, 0, 0.24, 0,
    0, 0, -0.075, 0, 0, 0.075, 0, 0.24, 0,
  ], 3));
  grassGeometry.computeVertexNormals();
  const grassMaterial = new THREE.MeshStandardMaterial({ color: 0x91a867, roughness: 1, side: THREE.DoubleSide });
  const grasses = new THREE.InstancedMesh(grassGeometry, grassMaterial, 165);
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  for (let i = 0; i < 165; i++) {
    const angle = seeded(i + 1, 80) * Math.PI * 2;
    const radius = 2.4 + seeded(i + 1, 81) * 10.8;
    const position = new THREE.Vector3(Math.cos(angle) * radius * 1.12, 0.01, Math.sin(angle) * radius * 0.77);
    const scale = 0.75 + seeded(i + 1, 82) * 1.05;
    matrix.compose(position, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, seeded(i + 1, 83) * Math.PI, (seeded(i + 1, 84) - 0.5) * 0.16)), new THREE.Vector3(scale, scale, scale));
    grasses.setMatrixAt(i, matrix);
    color.setHSL(0.2 + seeded(i + 1, 85) * 0.045, 0.3, 0.43 + seeded(i + 1, 86) * 0.11);
    grasses.setColorAt(i, color);
  }
  grasses.castShadow = true;
  grasses.receiveShadow = true;
  scene.add(grasses);

  const flowerGeometry = new THREE.OctahedronGeometry(0.055, 0);
  const flowerMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true });
  const flowers = new THREE.InstancedMesh(flowerGeometry, flowerMaterial, 42);
  const flowerColors = [0xe8b660, 0xd98d89, 0xd9d3a6, 0x9bb5c5];
  for (let i = 0; i < 42; i++) {
    const angle = seeded(i + 1, 102) * Math.PI * 2;
    const radius = 3.3 + seeded(i + 1, 103) * 8.5;
    const position = new THREE.Vector3(Math.cos(angle) * radius * 1.1, 0.18, Math.sin(angle) * radius * 0.75);
    const scale = 0.72 + seeded(i + 1, 104) * 0.55;
    matrix.compose(position, new THREE.Quaternion(), new THREE.Vector3(scale, scale, scale));
    flowers.setMatrixAt(i, matrix);
    flowers.setColorAt(i, new THREE.Color(flowerColors[i % flowerColors.length]));
  }
  flowers.castShadow = true;
  scene.add(flowers);

  const bushMats = [0x3e654c, 0x4d7351, 0x5a7950].map(colorValue => new THREE.MeshStandardMaterial({ color: colorValue, roughness: 1, flatShading: true }));
  for (let i = 0; i < 15; i++) {
    const angle = (i / 15) * Math.PI * 2 + 0.17;
    const bush = new THREE.Group();
    for (let part = 0; part < 3; part++) {
      const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34 + seeded(i + 1, part + 90) * 0.22, 1), bushMats[(i + part) % bushMats.length]);
      leaves.position.set((part - 1) * 0.3, 0.32 + part * 0.06, (seeded(i + 1, part + 94) - 0.5) * 0.2);
      leaves.castShadow = true;
      bush.add(leaves);
    }
    bush.position.set(Math.cos(angle) * 13.2 * 1.12, 0, Math.sin(angle) * 13.2 * 0.77);
    const bushScale = 0.8 + seeded(i + 1, 98) * 0.65;
    bush.scale.setScalar(bushScale);
    scene.add(bush);
    physicsWorld.addStaticCircle(`bush-${i + 1}`, bush.position.x, bush.position.z, bushScale * 0.58);
  }
}

function createStars() {
  const geometry = new THREE.BufferGeometry();
  const points = [];
  for (let i = 0; i < 170; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 24 + Math.random() * 24;
    points.push(Math.cos(angle) * radius, 12 + Math.random() * 18, Math.sin(angle) * radius);
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  scene.add(new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xe7f0e7, size: 0.08, transparent: true, opacity: 0.7 })));
}

function makeLabel(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 96;
  const context = canvas.getContext('2d');
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
  context.fillText(text, 160, 53);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(1.5, 0.45, 1);
  sprite.position.y = 1.7;
  sprite.userData.isLabel = true;
  return sprite;
}

function makeDemoPeter(color, teamId) {
  const group = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xd8a276, roughness: 0.86 });
  const robe = new THREE.MeshStandardMaterial({ color, roughness: 0.78 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x33261f, roughness: 1 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.55, 6, 12), robe);
  body.position.y = 0.8;
  group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), skin);
  head.position.y = 1.43;
  group.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.225, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), dark);
  hair.position.y = 1.48;
  group.add(hair);
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.39, 4, 8), robe);
    arm.position.set(side * 0.34, 0.86, 0);
    arm.rotation.z = side * (0.18 + seeded(teamId, 42) * 0.15);
    group.add(arm);
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.38, 4, 8), dark);
    leg.position.set(side * 0.13, 0.26, 0);
    group.add(leg);
  }
  group.traverse(object => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = false;
    }
  });
  return group;
}

function zonePoint(teamId, salt) {
  const zone = zones[teamId - 1];
  const angle = seeded(teamId, salt) * Math.PI * 2;
  const radius = 0.35 + seeded(teamId, salt + 1) * 0.95;
  const result = zone.clone().add(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius));
  if (result.length() < 2.2) result.multiplyScalar(1.6);
  return result;
}

function createActor(team) {
  const root = new THREE.Group();
  const color = team.color || fallbackColors[(team.id - 1) % fallbackColors.length];
  const speed = 0.28 + seeded(team.id, 9) * 0.1;
  const wanderAngle = seeded(team.id, 201) * Math.PI * 2;
  root.position.copy(zonePoint(team.id, 2));
  root.rotation.y = wanderAngle;
  const visual = makeDemoPeter(color, team.id);
  visual.name = 'demoVisual';
  root.add(visual);
  root.add(makeLabel(team.name, color));
  scene.add(root);

  const actor = {
    team,
    root,
    visual,
    modelScene: null,
    mixer: null,
    action: null,
    speed,
    velocity: new THREE.Vector3(Math.sin(wanderAngle), 0, Math.cos(wanderAngle)).multiplyScalar(speed),
    wanderAngle,
    wanderTimer: 0.6 + seeded(team.id, 202) * 1.8,
    wanderStep: 0,
    turnRate: (seeded(team.id, 203) - 0.5) * 0.75,
    colliderRadius: ACTOR_COLLIDER_RADIUS,
    distanceTravelled: 0,
    forwardYaw: 0,
    bobOffset: seeded(team.id, 11) * Math.PI * 2,
    selected: false,
    modelLoaded: false,
    loadingModel: false,
    modelUrl: null,
    requestedModelUrl: null,
    modelLoadVersion: 0,
    hasAnimation: false,
    visualBaseY: 0,
    visualBaseRotationZ: 0,
  };
  root.userData.actor = actor;
  root.traverse(object => { object.userData.actor = actor; });
  physicsWorld.placeAtNearestFree(actor);
  actors.set(team.id, actor);
  if (team.model_url) loadRealModel(actor, team.model_url);
  return actor;
}

function findWalkClip(animations) {
  return animations.find(clip => /walk|walking|nlatrack/i.test(clip.name)) || animations[0] || null;
}

function sampleModelBounds(object, mixer, clip) {
  const bounds = new THREE.Box3();
  const sampleCount = mixer && clip?.duration > 0 ? 8 : 1;
  for (let index = 0; index < sampleCount; index += 1) {
    if (mixer && clip) mixer.setTime((clip.duration * index) / sampleCount);
    object.updateMatrixWorld(true);
    object.traverse(child => {
      if (!child.isSkinnedMesh) return;
      child.skeleton.update();
      child.boundingBox = null;
      child.computeBoundingBox();
    });
    bounds.union(new THREE.Box3().setFromObject(object));
  }
  return bounds;
}

function normalizeModel(object, mixer, clip) {
  const animatedBounds = sampleModelBounds(object, mixer, clip);
  const size = animatedBounds.getSize(new THREE.Vector3());
  const horizontalSize = Math.max(size.x, size.z);
  if (!Number.isFinite(size.y) || size.y <= 0 || !Number.isFinite(horizontalSize) || horizontalSize <= 0) return null;

  const scale = Math.min(MODEL_TARGET_HEIGHT / size.y, MODEL_TARGET_WIDTH / horizontalSize);
  object.scale.multiplyScalar(scale);

  const normalizedBounds = sampleModelBounds(object, mixer, clip);
  const center = normalizedBounds.getCenter(new THREE.Vector3());
  object.position.x -= center.x;
  object.position.y -= normalizedBounds.min.y;
  object.position.z -= center.z;
  object.updateMatrixWorld(true);

  if (mixer) mixer.setTime(0);
  const finalSize = normalizedBounds.getSize(new THREE.Vector3());
  return { sourceHeight: size.y, sourceWidth: horizontalSize, scale, finalHeight: finalSize.y };
}

function loadRealModel(actor, url) {
  if (!url || actor.modelUrl === url || (actor.loadingModel && actor.requestedModelUrl === url)) return;
  actor.requestedModelUrl = url;
  const loadVersion = ++actor.modelLoadVersion;
  actor.loadingModel = true;
  loader.load(url, gltf => {
    if (loadVersion !== actor.modelLoadVersion) return;
    const modelWrapper = new THREE.Group();
    modelWrapper.name = `team-${actor.team.id}-model`;
    modelWrapper.add(gltf.scene);
    const clip = findWalkClip(gltf.animations);
    const mixer = clip ? new THREE.AnimationMixer(gltf.scene) : null;
    const action = mixer ? mixer.clipAction(clip) : null;
    if (action) {
      action.enabled = true;
      action.clampWhenFinished = false;
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.setEffectiveWeight(1);
      action.setEffectiveTimeScale(1);
      action.reset().play();
    }
    const modelFit = normalizeModel(modelWrapper, mixer, clip);
    if (action) {
      const walkTimeScale = Math.max(0.65, actor.speed * clip.duration / WALK_STRIDE_LENGTH);
      action.setEffectiveTimeScale(walkTimeScale).reset().play();
    }
    modelWrapper.traverse(object => {
      object.userData.actor = actor;
      if (object.isMesh) {
        object.castShadow = actor.selected;
        object.receiveShadow = false;
      }
    });
    const wasVisible = actor.visual.visible;
    if (actor.mixer) {
      actor.mixer.stopAllAction();
      actor.mixer.uncacheRoot(actor.modelScene || actor.visual);
    }
    actor.root.remove(actor.visual);
    actor.visual = modelWrapper;
    actor.modelScene = gltf.scene;
    actor.visual.visible = wasVisible;
    actor.root.add(modelWrapper);
    actor.mixer = mixer;
    actor.action = action;
    actor.hasAnimation = Boolean(action);
    actor.forwardYaw = IMPORTED_MODEL_FORWARD_YAW;
    actor.visualBaseY = modelWrapper.position.y;
    actor.visualBaseRotationZ = modelWrapper.rotation.z;
    actor.modelUrl = url;
    actor.modelLoaded = true;
    actor.loadingModel = false;
    console.info(`Team ${actor.team.id} model ready`, { clip: clip?.name || null, ...(modelFit || {}) });
  }, undefined, error => {
    if (loadVersion !== actor.modelLoadVersion) return;
    console.warn(`Team ${actor.team.id} model load failed`, error);
    actor.loadingModel = false;
  });
}

function headingForDirection(actor, direction) {
  return Math.atan2(direction.x, direction.z) + actor.forwardYaw;
}

function updateActor(actor, delta, elapsed, actorList) {
  if (actor.mixer) {
    if (actor.action && !actor.action.isRunning()) actor.action.play();
    actor.mixer.update(delta);
  }

  actor.wanderTimer -= delta;
  if (actor.wanderTimer <= 0) {
    actor.wanderStep += 1;
    actor.turnRate = (seeded(actor.team.id, 203 + actor.wanderStep * 2) - 0.5) * 0.9;
    actor.wanderTimer = 1.35 + seeded(actor.team.id, 204 + actor.wanderStep * 2) * 2.4;
  }
  actor.wanderAngle += actor.turnRate * delta;
  const desiredDirection = new THREE.Vector3(Math.sin(actor.wanderAngle), 0, Math.cos(actor.wanderAngle));
  physicsWorld.steeringDirection(actor, desiredDirection, actorList);
  const desiredVelocity = desiredDirection.multiplyScalar(actor.speed);
  actor.velocity.lerp(desiredVelocity, 1 - Math.exp(-WANDER_STEERING_SPEED * delta));

  if (actor.velocity.lengthSq() > 0.0004) {
    const targetRotation = headingForDirection(actor, actor.velocity);
    let rotationDelta = targetRotation - actor.root.rotation.y;
    rotationDelta = Math.atan2(Math.sin(rotationDelta), Math.cos(rotationDelta));
    actor.root.rotation.y += rotationDelta * Math.min(1, delta * ACTOR_TURN_SPEED);
  }
  physicsWorld.integrate(actor, delta);

  if (!actor.modelLoaded || !actor.hasAnimation) {
    const step = elapsed * 3.4 + actor.bobOffset;
    actor.visual.position.y = actor.visualBaseY + Math.abs(Math.sin(step)) * (actor.modelLoaded ? 0.018 : 0.035);
    if (actor.modelLoaded) actor.visual.rotation.z = actor.visualBaseRotationZ + Math.sin(step * 0.5) * 0.012;
  }
}

function fallbackTeams() {
  return Array.from({ length: 25 }, (_, index) => ({
    id: index + 1,
    name: `${index + 1}조`,
    identity_text: '첫걸음을 준비하는 베드로',
    color: fallbackColors[index % fallbackColors.length],
    symbol: '물고기',
    courage: 10,
    wisdom: 10,
    faith: 10,
    love: 10,
    talents: 0,
    title: '첫걸음을 준비하는 자',
    model_url: null,
  }));
}

async function fetchTeams() {
  try {
    const response = await fetch(`${API}/teams`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn('Using offline demo teams', error);
    toast('서버에 연결되지 않아 데모 데이터로 보여드려요');
    return fallbackTeams();
  }
}

function renderFinder() {
  const grid = document.getElementById('teamGrid');
  grid.innerHTML = '';
  teams.forEach(team => {
    const button = document.createElement('button');
    button.style.setProperty('--button-color', team.color || fallbackColors[(team.id - 1) % fallbackColors.length]);
    button.innerHTML = `<i></i>${escapeHtml(team.name)}`;
    button.addEventListener('click', () => {
      closeFinder();
      selectActor(actors.get(team.id));
    });
    grid.appendChild(button);
  });
}

function escapeHtml(value) {
  const element = document.createElement('span');
  element.textContent = String(value ?? '');
  return element.innerHTML;
}

function radarPoint(value, axis) {
  const amount = Math.max(0, Math.min(100, Number(value) || 0)) / 100;
  const positions = [
    [160, 130 - 106 * amount],
    [160 + 116 * amount, 130],
    [160, 130 + 106 * amount],
    [160 - 116 * amount, 130],
  ];
  return positions[axis];
}

function updateRadar(team) {
  const values = [team.courage, team.wisdom, team.faith, team.love];
  const points = values.map((value, index) => radarPoint(value, index));
  document.getElementById('radarShape').setAttribute('points', points.map(point => point.join(',')).join(' '));
  document.getElementById('radarDots').innerHTML = points.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4" />`).join('');
  Object.entries(STAT_LABELS).forEach(([key]) => {
    document.getElementById(`${key}Value`).textContent = team[key];
  });
}

async function renderHistory(teamId) {
  const list = document.getElementById('historyList');
  list.innerHTML = '<li class="empty-history">기록을 불러오는 중…</li>';
  try {
    const response = await fetch(`${API}/teams/${teamId}/history`, { cache: 'no-store' });
    if (!response.ok) throw new Error();
    const history = await response.json();
    if (!history.length) {
      list.innerHTML = '<li class="empty-history">아직 기록된 성장이 없습니다</li>';
      return;
    }
    list.innerHTML = history.map(event => {
      const gains = Object.keys(STAT_LABELS)
        .filter(key => event[`${key}_delta`])
        .map(key => `${STAT_LABELS[key]} ${event[`${key}_delta`] > 0 ? '+' : ''}${event[`${key}_delta`]}`);
      if (event.talent_delta) gains.push(`달란트 ${event.talent_delta > 0 ? '+' : ''}${event.talent_delta}`);
      return `<li><b>${escapeHtml(event.source)}</b>${escapeHtml(gains.join(' · ') || event.note || '성장 기록')}</li>`;
    }).join('');
  } catch {
    list.innerHTML = '<li class="empty-history">성장 기록을 불러오지 못했습니다</li>';
  }
}

function renderPanel(team) {
  const color = team.color || '#67b8c7';
  document.documentElement.style.setProperty('--team', color);
  document.getElementById('teamName').textContent = team.name;
  document.getElementById('teamIdentity').textContent = team.identity_text || '우리 조가 키워가는 베드로';
  document.getElementById('teamSymbol').textContent = (team.symbol || '물고기').slice(0, 2);
  document.getElementById('teamTalents').textContent = team.talents;
  document.getElementById('teamLevel').textContent = Math.round((team.courage + team.wisdom + team.faith + team.love) / 4);
  document.getElementById('teamTitle').textContent = team.title;
  updateRadar(team);
  renderHistory(team.id);
}

function selectActor(actor) {
  if (!actor) return;
  if (selectedActor) {
    selectedActor.selected = false;
    selectedActor.root.scale.setScalar(1);
  }
  selectedActor = actor;
  actor.selected = true;
  selectedFollowPosition = actor.root.position.clone();
  actor.root.scale.setScalar(1.08);
  const cameraDirection = camera.position.clone().sub(actor.root.position);
  cameraDirection.y = 0;
  actor.root.rotation.y = headingForDirection(actor, cameraDirection);
  actor.root.traverse(object => { if (object.isMesh) object.castShadow = true; });
  actors.forEach(other => {
    const label = other.root.children.find(child => child.userData.isLabel);
    if (label) label.visible = false;
    if (other !== actor && other.root.position.distanceTo(actor.root.position) < 2.8) other.visual.visible = false;
  });
  renderPanel(actor.team);
  const panel = document.getElementById('teamPanel');
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  document.getElementById('worldHint').classList.add('hide');
  const offset = innerWidth < 760 ? new THREE.Vector3(2.5, 2.4, 4.0) : new THREE.Vector3(3.2, 2.5, 4.8);
  cameraGoal = actor.root.position.clone().add(offset);
  targetGoal = actor.root.position.clone().add(new THREE.Vector3(0, 0.8, 0));
  focusVelocity = 0.085;
  scheduleReset();
}

function closePanel() {
  if (selectedActor) {
    selectedActor.selected = false;
    selectedActor.root.scale.setScalar(1);
    selectedActor.root.traverse(object => { if (object.isMesh) object.castShadow = false; });
  }
  selectedActor = null;
  selectedFollowPosition = null;
  actors.forEach(actor => {
    actor.visual.visible = true;
    const label = actor.root.children.find(child => child.userData.isLabel);
    if (label) label.visible = true;
  });
  const panel = document.getElementById('teamPanel');
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  document.getElementById('worldHint').classList.remove('hide');
  cameraGoal = new THREE.Vector3(0, 13.2, 18.5);
  targetGoal = new THREE.Vector3(0, 0, 0);
  focusVelocity = 0.055;
}

function openFinder() {
  const finder = document.getElementById('finder');
  finder.classList.add('open');
  finder.setAttribute('aria-hidden', 'false');
  scheduleReset();
}

function closeFinder() {
  const finder = document.getElementById('finder');
  finder.classList.remove('open');
  finder.setAttribute('aria-hidden', 'true');
}

function scheduleReset() {
  clearTimeout(resetTimer);
  resetTimer = setTimeout(() => {
    closeFinder();
    closePanel();
  }, RESET_AFTER_MS);
}

function toast(message) {
  const element = document.getElementById('toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(element._timer);
  element._timer = setTimeout(() => element.classList.remove('show'), 3200);
}

function bindEvents() {
  document.getElementById('findTeamBtn').addEventListener('click', openFinder);
  document.getElementById('closeFinderBtn').addEventListener('click', closeFinder);
  document.getElementById('closePanelBtn').addEventListener('click', closePanel);
  document.getElementById('finder').addEventListener('click', event => {
    if (event.target.id === 'finder') closeFinder();
  });
  document.getElementById('soundBtn').addEventListener('click', () => toast('배경 소리는 다음 버전에서 준비할게요'));

  renderer.domElement.addEventListener('pointerdown', event => {
    pointerStart = { x: event.clientX, y: event.clientY };
    scheduleReset();
  });
  renderer.domElement.addEventListener('pointerup', event => {
    if (!pointerStart || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 10) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects([...actors.values()].map(actor => actor.root), true)
      .find(intersection => intersection.object.userData.actor && !intersection.object.userData.isLabel);
    if (hit) selectActor(hit.object.userData.actor);
  });
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  addEventListener('pointerdown', scheduleReset, { passive: true });
}

async function refreshTeamData() {
  try {
    const response = await fetch(`${API}/teams`, { cache: 'no-store' });
    if (!response.ok) return;
    const fresh = await response.json();
    teams = fresh;
    fresh.forEach(team => {
      const actor = actors.get(team.id);
      if (!actor) return;
      const changed = actor.team.updated_at !== team.updated_at;
      actor.team = team;
      if (team.model_url && team.model_url !== actor.modelUrl) loadRealModel(actor, team.model_url);
      if (selectedActor === actor && changed) renderPanel(team);
    });
  } catch { /* kiosk remains usable with cached state */ }
}

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;
  const actorList = [...actors.values()];
  actorList.forEach(actor => updateActor(actor, delta, elapsed, actorList));
  physicsWorld.resolveActorPairs(actorList);
  if (selectedActor && selectedFollowPosition) {
    const followDelta = selectedActor.root.position.clone().sub(selectedFollowPosition);
    camera.position.add(followDelta);
    controls.target.add(followDelta);
    if (cameraGoal) cameraGoal.add(followDelta);
    if (targetGoal) targetGoal.add(followDelta);
    selectedFollowPosition.copy(selectedActor.root.position);
  }
  const water = scene.getObjectByName('water');
  if (water) water.userData.uniforms.time.value = elapsed * 0.55;
  scene.traverse(object => {
    if (object.userData.flame) {
      const phase = object.userData.flamePhase || 0;
      object.scale.y = 0.88 + Math.sin(elapsed * 8.2 + phase) * 0.13;
      object.scale.x = 0.94 + Math.sin(elapsed * 6.7 + phase) * 0.06;
      object.position.x += Math.sin(elapsed * 7.4 + phase) * 0.0008;
      object.rotation.y += delta * (0.55 + phase * 0.08);
    }
    if (object.userData.embers) {
      const positions = object.geometry.attributes.position;
      const speeds = object.userData.speeds;
      for (let i = 0; i < positions.count; i++) {
        const nextY = positions.getY(i) + speeds[i] * delta;
        positions.setY(i, nextY > 2.25 ? 0.42 : nextY);
        positions.setX(i, positions.getX(i) + Math.sin(elapsed * 2.4 + i) * delta * 0.015);
      }
      positions.needsUpdate = true;
      object.rotation.y += delta * 0.08;
    }
    if (object.userData.fireLight) object.intensity = 4.4 + Math.sin(elapsed * 9.3) * 0.5;
  });
  if (cameraGoal && targetGoal) {
    camera.position.lerp(cameraGoal, focusVelocity);
    controls.target.lerp(targetGoal, focusVelocity);
    if (camera.position.distanceTo(cameraGoal) < 0.03) cameraGoal = targetGoal = null;
  }
  controls.update();
  renderer.render(scene, camera);
}

async function init() {
  setupEnvironment();
  bindEvents();
  teams = await fetchTeams();
  document.getElementById('loadingStatus').textContent = `${teams.length}명의 베드로를 갈릴리에 배치하는 중…`;
  teams.forEach(createActor);
  if (new URLSearchParams(location.search).has('debug')) {
    const diagnostics = document.createElement('output');
    diagnostics.id = 'physicsDiagnostics';
    diagnostics.setAttribute('aria-label', '물리 진단');
    diagnostics.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;overflow:hidden';
    document.body.appendChild(diagnostics);
    window.__peterWorldDebug = {
      snapshot: () => physicsWorld.snapshot([...actors.values()]),
    };
    setInterval(() => {
      diagnostics.textContent = JSON.stringify(window.__peterWorldDebug.snapshot());
    }, 500);
  }
  renderFinder();
  animate();
  scheduleReset();
  setInterval(refreshTeamData, 8_000);
  setTimeout(() => document.getElementById('loading').classList.add('hide'), 650);
}

init();
