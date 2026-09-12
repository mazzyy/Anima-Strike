/**
 * Guards against z-fighting on the ground.
 *
 *   node --test tools/arena-depth.test.mjs
 *
 * The bug this exists to prevent: addFloor() put the base slab's top face at
 * exactly y=0, and every plank, tile and board laid on top of it also put its
 * top face at exactly y=0. Two surfaces sharing a plane across the whole stage
 * is textbook z-fighting — the depth buffer cannot say which is in front, so
 * the ground shimmers. It showed up "when characters move" because the camera
 * tracks them; a still camera would have shown a stable but equally wrong
 * pattern.
 *
 * The camera's depth range made it worse. 0.1-to-500 near/far spends nearly
 * all of a 24-bit depth buffer on the first metre in front of the lens, where
 * nothing in this game ever is.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { MAPS, buildMap } from '../renderer/src/arenas.js';
import { MAP_ART, ARENA } from '../renderer/src/config.js';

/** Every mesh near the walking plane, with its world-space bounds. */
function groundSurfaces(scene) {
  const found = [];
  scene.updateMatrixWorld(true);

  const keep = (box) => {
    if (box.isEmpty() || !Number.isFinite(box.max.y)) return;
    // Walls and props are separated from the floor by metres; ignore them.
    if (Math.abs(box.max.y - ARENA.floorY) > 0.5) return;
    found.push({ topY: box.max.y, box });
  };

  scene.traverse((object) => {
    if (!object.isMesh || !object.geometry) return;

    // An InstancedMesh reports ONE box covering every instance. Two interleaved
    // tile batches would then look like they overlap everywhere, when in fact
    // each tile has the plane to itself. Expand to per-instance boxes so the
    // test measures real surfaces rather than their union.
    if (object.isInstancedMesh) {
      object.geometry.computeBoundingBox();
      const local = object.geometry.boundingBox;
      const instance = new THREE.Matrix4();
      const world = new THREE.Matrix4();
      for (let i = 0; i < object.count; i++) {
        object.getMatrixAt(i, instance);
        world.multiplyMatrices(object.matrixWorld, instance);
        keep(local.clone().applyMatrix4(world));
      }
      return;
    }

    keep(new THREE.Box3().setFromObject(object));
  });
  return found;
}

function covering(surfaces, x, z) {
  return surfaces.filter((s) =>
    s.box.min.x <= x && s.box.max.x >= x && s.box.min.z <= z && s.box.max.z >= z);
}

/**
 * Sample across the playable area rather than at the origin alone. Decking is
 * laid in strips with gaps between them — the dojo's planks leave 18mm of air
 * at x=0 — so a single probe point can miss every plank and see only the slab.
 */
function samplePoints() {
  const points = [];
  const stepX = ARENA.limitX / 3;
  const stepZ = ARENA.limitZ / 3;
  for (let x = -ARENA.limitX; x <= ARENA.limitX + 1e-9; x += stepX) {
    for (let z = -ARENA.limitZ; z <= ARENA.limitZ + 1e-9; z += stepZ) {
      points.push([x, z]);
    }
  }
  return points;
}

for (const map of MAPS) {
  test(`${map.id}: no two stacked ground surfaces share a plane`, () => {
    const scene = new THREE.Scene();
    const dispose = buildMap(scene, map.id);
    const surfaces = groundSurfaces(scene);

    let stackedAnywhere = 0;
    for (const [x, z] of samplePoints()) {
      const here = covering(surfaces, x, z).sort((a, b) => a.topY - b.topY);
      if (here.length >= 2) stackedAnywhere++;

      for (let i = 1; i < here.length; i++) {
        const gap = here[i].topY - here[i - 1].topY;
        assert.ok(gap > 0.003,
          `at (${x.toFixed(2)}, ${z.toFixed(2)}) two surfaces are `
          + `${(gap * 1000).toFixed(2)}mm apart at y=${here[i].topY.toFixed(4)} `
          + '— that will z-fight');
      }
    }

    // Without this the test would pass trivially on a stage with no decking.
    assert.ok(stackedAnywhere > 0,
      'no sample point had decking over the slab — the test proved nothing');

    dispose();
  });

  test(`${map.id}: the base slab sits below the walking plane`, () => {
    const scene = new THREE.Scene();
    const dispose = buildMap(scene, map.id);

    const ground = groundSurfaces(scene);
    const slab = ground.reduce((widest, s) => {
      const area = (s.box.max.x - s.box.min.x) * (s.box.max.z - s.box.min.z);
      const best = (widest.box.max.x - widest.box.min.x)
        * (widest.box.max.z - widest.box.min.z);
      return area > best ? s : widest;
    });

    assert.ok(slab.topY <= -MAP_ART.deckSink + 1e-6,
      `the widest ground surface tops out at ${slab.topY.toFixed(4)}; it must `
      + `sit at or below -${MAP_ART.deckSink} so decking never shares its plane`);

    dispose();
  });
}

test('the camera depth range is tight enough for flat ground detail', () => {
  const { near, far } = ARENA.camera;
  assert.ok(Number.isFinite(near) && Number.isFinite(far), 'both must be set');

  // The camera sits ~13 units back and never dollies closer than ~10.
  assert.ok(near >= 0.5, `near ${near} throws away depth precision`);
  assert.ok(far / near <= 500,
    `a ${Math.round(far / near)}:1 depth range cannot separate surfaces `
    + `${MAP_ART.surfaceLift * 1000}mm apart`);
});

test('a decal lift is big enough to survive the depth buffer', () => {
  assert.ok(MAP_ART.surfaceLift >= 0.01,
    `${MAP_ART.surfaceLift * 1000}mm is too thin a lift for flat decals`);
  assert.ok(MAP_ART.deckSink > MAP_ART.surfaceLift,
    'the slab must drop further than a decal rises, or they can meet');
});
