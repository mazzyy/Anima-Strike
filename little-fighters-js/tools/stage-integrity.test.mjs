/**
 * The environment pass runs against this.
 *
 *   node --test tools/stage-integrity.test.mjs
 *
 * Stages are about to get much richer — parallax skylines, weather, practical
 * lights, reflections, decals. Three things go wrong when that happens, and
 * none of them are visible in a code review:
 *
 *   1. A prop ends up inside the playable volume and the fighters walk into an
 *      invisible wall, or get stuck in a lantern. This is the machine-checkable
 *      version of "the map is a box I cannot cross".
 *   2. Draw calls, triangles and lights creep up until the game stops holding
 *      60fps, on a machine the author is not testing on.
 *   3. Something builds resources it never releases, and switching maps a few
 *      times exhausts memory.
 *
 * Budgets below are CEILINGS for the finished, detailed stages, not a
 * description of what exists today. They are deliberately generous; the point
 * is to catch a runaway, not to police good work.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { MAPS, buildMap } from '../renderer/src/arenas.js';
import { ARENA, BODY } from '../renderer/src/config.js';

const BUDGET = {
  drawCalls: 900,        // an InstancedMesh counts once, which is the point
  triangles: 600_000,
  lights: 24,            // forward rendering makes point lights expensive fast
  shadowCasters: 4,
};

/** Where the fighters actually are. Nothing solid may be in here. */
function playableVolume() {
  return new THREE.Box3(
    new THREE.Vector3(-ARENA.limitX, ARENA.floorY + 0.25, -ARENA.limitZ),
    new THREE.Vector3(ARENA.limitX, ARENA.floorY + BODY.height, ARENA.limitZ),
  );
}

function survey(scene) {
  scene.updateMatrixWorld(true);
  const out = {
    drawCalls: 0, triangles: 0, lights: 0, shadowCasters: 0,
    blockers: [], bad: [],
  };
  const play = playableVolume();

  scene.traverse((object) => {
    if (object.isLight) {
      out.lights++;
      if (object.castShadow) out.shadowCasters++;
      if (!Number.isFinite(object.intensity) || object.intensity < 0) {
        out.bad.push(`${object.type} has intensity ${object.intensity}`);
      }
      return;
    }
    if (!object.isMesh) return;

    if (!object.geometry) { out.bad.push(`${object.name || object.type} has no geometry`); return; }
    if (!object.material) { out.bad.push(`${object.name || object.type} has no material`); return; }

    out.drawCalls++;
    const geometry = object.geometry;
    const vertices = geometry.index
      ? geometry.index.count
      : (geometry.attributes.position?.count ?? 0);
    out.triangles += (vertices / 3) * (object.isInstancedMesh ? object.count : 1);

    const position = object.getWorldPosition(new THREE.Vector3());
    if (![position.x, position.y, position.z].every(Number.isFinite)) {
      out.bad.push(`${object.name || object.type} sits at a non-finite position`);
      return;
    }

    // An InstancedMesh reports ONE box spanning every instance. A row of
    // pillars along the back of the stage and another along the front share a
    // union that swallows the middle, so the union would read as an
    // obstruction while no actual pillar is anywhere near the fighters. Check
    // the instances themselves.
    const boxes = [];
    if (object.isInstancedMesh) {
      object.geometry.computeBoundingBox();
      const local = object.geometry.boundingBox;
      const instance = new THREE.Matrix4();
      const world = new THREE.Matrix4();
      for (let i = 0; i < object.count; i++) {
        object.getMatrixAt(i, instance);
        world.multiplyMatrices(object.matrixWorld, instance);
        boxes.push(local.clone().applyMatrix4(world));
      }
    } else {
      boxes.push(new THREE.Box3().setFromObject(object));
    }

    for (const box of boxes) {
      if (box.isEmpty() || !box.intersectsBox(play)) continue;
      out.blockers.push({
        name: object.name || object.type,
        box: `x ${box.min.x.toFixed(2)}..${box.max.x.toFixed(2)} `
           + `y ${box.min.y.toFixed(2)}..${box.max.y.toFixed(2)} `
           + `z ${box.min.z.toFixed(2)}..${box.max.z.toFixed(2)}`,
      });
    }
  });
  return out;
}

for (const map of MAPS) {
  test(`${map.id}: nothing solid stands where the fighters walk`, () => {
    const scene = new THREE.Scene();
    const dispose = buildMap(scene, map.id);
    const { blockers } = survey(scene);
    dispose();

    assert.deepEqual(blockers.map((b) => `${b.name} @ ${b.box}`), [],
      'decoration must stay outside the playable volume — a fighter cannot '
      + 'walk through scenery, and an invisible wall reads as a broken map');
  });

  test(`${map.id}: stays inside its rendering budget`, () => {
    const scene = new THREE.Scene();
    const dispose = buildMap(scene, map.id);
    const s = survey(scene);
    dispose();

    assert.ok(s.drawCalls <= BUDGET.drawCalls,
      `${s.drawCalls} draw calls, budget ${BUDGET.drawCalls} — instance the `
      + 'repeated props rather than adding meshes one at a time');
    assert.ok(s.triangles <= BUDGET.triangles,
      `${Math.round(s.triangles).toLocaleString()} triangles, budget `
      + BUDGET.triangles.toLocaleString());
    assert.ok(s.lights <= BUDGET.lights,
      `${s.lights} lights, budget ${BUDGET.lights} — use emissive materials `
      + 'for glow and real lights only where something must be lit');
    assert.ok(s.shadowCasters <= BUDGET.shadowCasters,
      `${s.shadowCasters} shadow-casting lights, budget ${BUDGET.shadowCasters}`);
  });

  test(`${map.id}: every mesh and light is well-formed`, () => {
    const scene = new THREE.Scene();
    const dispose = buildMap(scene, map.id);
    const { bad } = survey(scene);
    dispose();
    assert.deepEqual(bad, []);
  });

  test(`${map.id}: builds and tears down repeatedly without leaking`, () => {
    const scene = new THREE.Scene();
    const before = scene.children.length;

    for (let round = 0; round < 3; round++) {
      const dispose = buildMap(scene, map.id);
      assert.ok(scene.children.length > before, 'build added nothing');
      dispose();
      assert.equal(scene.children.length, before,
        `after ${round + 1} build/dispose cycles the scene still holds children`);
    }
  });
}

test('the playable volume is a stage, not a box', () => {
  // A beat-'em-up is wide. This is the machine-checkable form of the
  // complaint that the map was a small square you could not cross.
  const width = ARENA.limitX * 2;
  const depth = ARENA.limitZ * 2;
  assert.ok(width > depth,
    `the stage is ${width.toFixed(1)} by ${depth.toFixed(1)} — it must be wider `
    + 'than it is deep');
});
