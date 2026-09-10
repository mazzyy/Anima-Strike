/**
 * The stage: scene, lighting, camera and floor, matching Arena.tscn as closely
 * as three.js reasonably allows — same camera framing, same warm key light and
 * cool rim, same dark violet sky.
 *
 * Also owns the hit sparks, which were spawned by Fighter.gd in Godot. Keeping
 * them here means the fighter has no opinion about rendering.
 */

import * as THREE from 'three';
import { ARENA, BODY, CAMERA } from './config.js';

export function createArena(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060f);
  scene.fog = new THREE.Fog(0x0a0a1a, 18, 46);

  const camera = new THREE.PerspectiveCamera(
    ARENA.camera.fov, window.innerWidth / window.innerHeight, 0.1, 500,
  );
  camera.position.set(ARENA.camera.x, ARENA.camera.y, ARENA.camera.z);
  camera.rotation.x = THREE.MathUtils.degToRad(ARENA.camera.pitchDeg);

  // -- lighting -----------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0x8090c0, 0x1a1a28, 0.7);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xfff7eb, 1.9);
  key.position.set(4, 9, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 40;
  key.shadow.camera.left = -10;
  key.shadow.camera.right = 10;
  key.shadow.camera.top = 10;
  key.shadow.camera.bottom = -10;
  key.shadow.bias = -0.0009;
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x8caeff, 0.7);
  rim.position.set(-5, 6, -6);
  scene.add(rim);

  // -- floor --------------------------------------------------------------
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(12, 1, 12),
    new THREE.MeshStandardMaterial({ color: 0x2a2c3d, roughness: 0.85, metalness: 0.1 }),
  );
  floor.position.y = ARENA.floorY - 0.5;
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(12, 12, 0x5a6cff, 0x2d3350);
  grid.position.y = ARENA.floorY + 0.01;
  grid.material.opacity = 0.35;
  grid.material.transparent = true;
  scene.add(grid);

  // A glowing ring marking the fighting area, so the bounds are readable.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(ARENA.limitX + BODY.radius - 0.06, ARENA.limitX + BODY.radius, 64),
    new THREE.MeshBasicMaterial({ color: 0x6f7bff, side: THREE.DoubleSide, transparent: true, opacity: 0.5 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = ARENA.floorY + 0.02;
  scene.add(ring);

  // -- hit sparks ---------------------------------------------------------
  const sparks = [];
  const sparkGeo = new THREE.SphereGeometry(0.22, 12, 10);

  function spawnHitEffect(position, color) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
    const mesh = new THREE.Mesh(sparkGeo, mat);
    mesh.position.copy(position);
    mesh.scale.setScalar(0.4);
    scene.add(mesh);
    sparks.push({ mesh, mat, t: 0, life: 0.18 });
  }

  function updateSparks(dt) {
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.t += dt;
      const k = Math.min(s.t / s.life, 1);
      s.mesh.scale.setScalar(0.4 + k * 1.2);
      s.mat.opacity = 0.95 * (1 - k);
      if (k >= 1) {
        scene.remove(s.mesh);
        s.mat.dispose();
        sparks.splice(i, 1);
      }
    }
  }

  // -- camera tracking ----------------------------------------------------
  const restX = ARENA.camera.x;
  const restY = ARENA.camera.y;
  const restZ = ARENA.camera.z;

  function updateCamera(dt, fighters) {
    if (!CAMERA.track || !fighters || fighters.length < 2) return;
    const [a, b] = fighters;

    const midX = (a.position.x + b.position.x) / 2;
    const separation = Math.hypot(
      a.position.x - b.position.x,
      a.position.z - b.position.z,
    );

    // Pull back only once they are further apart than a comfortable spacing,
    // so a normal exchange does not make the camera breathe in and out.
    const excess = Math.max(separation - CAMERA.restSeparation, 0);
    const pull = Math.min(excess * CAMERA.zoomPerUnit, CAMERA.maxPull);

    const targetX = THREE.MathUtils.clamp(
      midX * CAMERA.followX, -CAMERA.maxOffsetX, CAMERA.maxOffsetX);
    const targetY = restY + pull * 0.35;
    const targetZ = restZ + pull;

    // Frame-rate independent damping: the fraction of the remaining distance
    // to cover this frame, derived from a per-second rate.
    const k = 1 - Math.exp(-CAMERA.damping * dt);
    camera.position.x += (targetX - camera.position.x) * k;
    camera.position.y += (targetY - camera.position.y) * k;
    camera.position.z += (targetZ - camera.position.z) * k;
    // Pitch and fov deliberately untouched.
  }

  function resetCamera() {
    camera.position.set(restX, restY, restZ);
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  resize();
  window.addEventListener('resize', resize);

  return {
    renderer, scene, camera,
    spawnHitEffect, updateSparks,
    updateCamera, resetCamera,
    render: () => renderer.render(scene, camera),
  };
}
