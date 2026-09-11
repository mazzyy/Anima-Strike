/**
 * Persistent renderer, camera and hit effects. Procedural map ownership is
 * separate, so changing stages never touches fighters or recreates WebGL.
 */

import * as THREE from 'three';
import { ARENA, CAMERA } from './config.js';
import { buildMap } from './arenas.js';

export function createArena(canvas, mapId) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  let map = buildMap(scene, mapId);
  let disposed = false;

  // Depth range, not defaults. 0.1-to-500 is a 5000:1 ratio, which spends
  // almost all of the depth buffer's precision on the first metre in front of
  // the lens — where nothing ever is. The camera sits ~13 units back and the
  // nearest geometry is ~10 units away, so starting at 1 costs nothing and
  // buys back the precision that flat ground detail needs.
  const camera = new THREE.PerspectiveCamera(
    ARENA.camera.fov,
    window.innerWidth / window.innerHeight,
    ARENA.camera.near,
    ARENA.camera.far,
  );
  camera.position.set(ARENA.camera.x, ARENA.camera.y, ARENA.camera.z);
  camera.rotation.x = THREE.MathUtils.degToRad(ARENA.camera.pitchDeg);

  // -- hit sparks ---------------------------------------------------------
  const sparks = [];
  const sparkGeo = new THREE.SphereGeometry(0.22, 12, 10);

  function spawnHitEffect(position, color) {
    if (disposed) return;
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
    const mesh = new THREE.Mesh(sparkGeo, mat);
    mesh.position.copy(position);
    mesh.scale.setScalar(0.4);
    scene.add(mesh);
    sparks.push({ mesh, mat, t: 0, life: 0.18 });
  }

  function clearSparks() {
    for (const spark of sparks) {
      spark.mesh.removeFromParent();
      spark.mat.dispose();
    }
    sparks.length = 0;
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
  const restPosition = camera.position.clone();
  const trackingOffset = new THREE.Vector3();
  // Camera-local +Z points backward. Dolly along this axis rather than using
  // an arbitrary Y/Z ratio, so dollying does not shift the shot's aim.
  const pullDirection = new THREE.Vector3(0, 0, 1)
    .applyQuaternion(camera.quaternion);
  let currentPull = 0;
  let currentPush = 0;

  /** pushIn is a presentation offset in world units, independent of tracking. */
  function updateCamera(dt, fighters, pushIn = 0) {
    if (!Number.isFinite(dt) || dt <= 0) return;

    const k = 1 - Math.exp(-CAMERA.damping * dt);

    if (CAMERA.track && fighters && fighters.length >= 2) {
      const [a, b] = fighters;
      const midX = (a.position.x + b.position.x) / 2;
      const midZ = (a.position.z + b.position.z) / 2;
      const separation = Math.hypot(
        a.position.x - b.position.x,
        a.position.z - b.position.z,
      );

      // Clamp the tracking centre inside the arena. The camera itself keeps
      // its original elevated, outside-the-ring offset from that centre.
      const limitX = Math.min(CAMERA.maxOffsetX, ARENA.limitX);
      const limitZ = Math.min(CAMERA.maxOffsetZ, ARENA.limitZ);
      const targetX = THREE.MathUtils.clamp(
        midX * CAMERA.followX, -limitX, limitX,
      );
      const targetZ = THREE.MathUtils.clamp(
        midZ * CAMERA.followZ, -limitZ, limitZ,
      );

      // Ordinary tracking never zooms closer than the original framing.
      const targetPull = THREE.MathUtils.clamp(
        (separation - CAMERA.restSeparation) * CAMERA.zoomPerUnit,
        0,
        CAMERA.maxPull,
      );

      trackingOffset.x += (targetX - trackingOffset.x) * k;
      trackingOffset.z += (targetZ - trackingOffset.z) * k;
      currentPull += (targetPull - currentPull) * k;
    }

    // The explicit presentation dolly also works with tracking disabled.
    const targetPush = Number.isFinite(pushIn)
      ? THREE.MathUtils.clamp(pushIn, 0, CAMERA.koPush)
      : 0;
    currentPush += (targetPush - currentPush) * k;

    camera.position.copy(restPosition)
      .add(trackingOffset)
      .addScaledVector(pullDirection, currentPull - currentPush);
    // Pitch and field of view deliberately untouched; no lookAt().
  }

  function resetCamera() {
    trackingOffset.set(0, 0, 0);
    currentPull = 0;
    currentPush = 0;
    camera.position.copy(restPosition);
  }

  /** Replace only the map; all maps occupy exactly one scene child. */
  function setMap(nextMapId) {
    if (disposed) return;
    clearSparks();
    map.dispose();
    map = buildMap(scene, nextMapId);
    resetCamera();
    return map.mapId;
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

  function dispose() {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('resize', resize);
    clearSparks();
    map.dispose();
    sparkGeo.dispose();
    renderer.dispose();
  }

  return {
    renderer, scene, camera,
    get mapId() { return map.mapId; },
    setMap, dispose,
    spawnHitEffect, updateSparks, clearSparks,
    updateCamera, resetCamera,
    render: () => {
      if (!disposed) renderer.render(scene, camera);
    },
  };
}
