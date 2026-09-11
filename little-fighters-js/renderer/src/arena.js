/**
 * Persistent renderer, camera and pooled VFX. Maps have separate ownership.
 */
import * as THREE from 'three';
import { ARENA, CAMERA } from './config.js';
import { buildMap } from './arenas.js';
import { VFXSystem } from './vfx.js';

/**
 * Framing is solved from an unshaken camera. Camera-local shake is composed
 * last, never fed back into tracking, pull-back, or KO push-in.
 */
export function createCameraRig(camera) {
  camera.position.set(ARENA.camera.x, ARENA.camera.y, ARENA.camera.z);
  camera.rotation.set(THREE.MathUtils.degToRad(ARENA.camera.pitchDeg), 0, 0);

  const restPosition = camera.position.clone();
  const trackingOffset = new THREE.Vector3();
  const pullDirection = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
  const inverseRotation = camera.quaternion.clone().invert();
  const basePosition = new THREE.Vector3();
  const corner = new THREE.Vector3();
  const shakeLocal = new THREE.Vector3();
  const appliedShake = new THREE.Vector3();
  const unshakenPosition = camera.position.clone();
  let currentPull = 0;
  let currentPush = 0;
  let lastFighters = null;

  function composeShake() {
    appliedShake.copy(shakeLocal).applyQuaternion(camera.quaternion);
    camera.position.copy(unshakenPosition).add(appliedShake);
    camera.updateMatrixWorld(true);
  }

  // Reconstruct from the exact unshaken position instead of repeatedly
  // subtracting offsets. At zero there is no accumulated floating-point drift.
  function setShake(offset) {
    shakeLocal.copy(offset);
    composeShake();
  }

  function requiredPull(fighters) {
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.getEffectiveFOV()) / 2);
    const tanH = tanV * camera.aspect;
    const usable = 1 - CAMERA.framePadding;
    let pull = 0;
    for (const fighter of fighters) {
      const p = fighter.position;
      for (const dx of [-CAMERA.frameRadius, CAMERA.frameRadius]) {
        for (const dy of [0, CAMERA.frameHeight]) {
          for (const dz of [-CAMERA.frameRadius, CAMERA.frameRadius]) {
            corner.set(p.x + dx, p.y + dy, p.z + dz)
              .sub(basePosition).applyQuaternion(inverseRotation);
            pull = Math.max(
              pull,
              corner.z + Math.abs(corner.x) / (tanH * usable),
              corner.z + Math.abs(corner.y) / (tanV * usable),
              corner.z + camera.near,
            );
          }
        }
      }
    }
    return pull;
  }

  /** dt=0 performs a safety refit after resizing without advancing damping. */
  function updateCamera(dt, fighters = lastFighters, pushIn = 0) {
    if (!Number.isFinite(dt) || dt < 0) return;
    lastFighters = fighters;
    const k = 1 - Math.exp(-CAMERA.damping * dt);
    const tracking = CAMERA.track && fighters && fighters.length >= 2;
    if (tracking) {
      const [a, b] = fighters;
      const midX = (a.position.x + b.position.x) / 2;
      const midZ = (a.position.z + b.position.z) / 2;
      const separation = Math.hypot(
        a.position.x - b.position.x, a.position.z - b.position.z,
      );
      const limitX = Math.min(CAMERA.maxOffsetX, ARENA.limitX);
      const limitZ = Math.min(CAMERA.maxOffsetZ, ARENA.limitZ);
      const targetX = THREE.MathUtils.clamp(midX * CAMERA.followX, -limitX, limitX);
      const targetZ = THREE.MathUtils.clamp(midZ * CAMERA.followZ, -limitZ, limitZ);
      const targetPull = THREE.MathUtils.clamp(
        (separation - CAMERA.restSeparation) * CAMERA.zoomPerUnit, 0, CAMERA.maxPull,
      );
      trackingOffset.x += (targetX - trackingOffset.x) * k;
      trackingOffset.z += (targetZ - trackingOffset.z) * k;
      currentPull += (targetPull - currentPull) * k;
    }
    const targetPush = Number.isFinite(pushIn)
      ? THREE.MathUtils.clamp(pushIn, 0, CAMERA.koPush) : 0;
    currentPush += (targetPush - currentPush) * k;
    basePosition.copy(restPosition).add(trackingOffset);
    if (tracking) {
      currentPull = Math.max(currentPull, requiredPull(fighters) + currentPush);
    }
    unshakenPosition.copy(basePosition)
      .addScaledVector(pullDirection, currentPull - currentPush);
    composeShake();
  }

  function resetCamera() {
    trackingOffset.set(0, 0, 0);
    shakeLocal.set(0, 0, 0);
    currentPull = currentPush = 0;
    lastFighters = null;
    unshakenPosition.copy(restPosition);
    composeShake();
  }

  resetCamera();
  return { updateCamera, resetCamera, setShake };
}

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
  const camera = new THREE.PerspectiveCamera(
    ARENA.camera.fov, window.innerWidth / window.innerHeight,
    ARENA.camera.near, ARENA.camera.far,
  );
  const { updateCamera, resetCamera, setShake } = createCameraRig(camera);
  const vfx = new VFXSystem(scene, { onShake: setShake });

  // Compatibility for existing arena consumers. Main uses the richer event API.
  function spawnHitEffect(position, color) {
    return vfx.emit('impact', { position, color, phase: 'hit' });
  }
  function updateSparks(dt) { vfx.update(dt); }
  function clearSparks() { vfx.clear(); }

  function setMap(nextMapId) {
    if (disposed) return;
    vfx.clear();
    map.dispose();
    map = buildMap(scene, nextMapId);
    resetCamera();
    return map.mapId;
  }

  function resize() {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    updateCamera(0);
    renderer.setSize(w, h, false);
  }
  resize();
  window.addEventListener('resize', resize);

  function dispose() {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('resize', resize);
    vfx.dispose();
    map.dispose();
    renderer.dispose();
  }

  return {
    renderer, scene, camera, vfx,
    get mapId() { return map.mapId; },
    setMap, dispose, spawnHitEffect, updateSparks, clearSparks,
    updateCamera, resetCamera,
    render: () => {
      if (!disposed) renderer.render(scene, camera);
    },
  };
}
