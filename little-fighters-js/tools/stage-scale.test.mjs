import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ARENA, BODY, CAMERA, MAP_ART, MAP_THEMES } from '../renderer/src/config.js';
import { MAPS, buildMap } from '../renderer/src/arenas.js';
import { createCameraRig } from '../renderer/src/arena.js';

test('stages have a wide collision strip, body clearance and wider spawns', () => {
  assert.ok(MAP_ART.floorWidth >= MAP_ART.floorDepth * 3);
  assert.ok(ARENA.limitX >= BODY.radius * 8);
  assert.equal(
    ARENA.limitX,
    MAP_ART.floorWidth / 2 - MAP_ART.edgeMargin - BODY.radius,
  );
  assert.equal(
    ARENA.limitZ,
    MAP_ART.floorDepth / 2 - MAP_ART.edgeMargin - BODY.radius,
  );
  assert.ok(ARENA.spawnP2.x - ARENA.spawnP1.x >= MAP_ART.floorWidth / 4);
  for (const spawn of [ARENA.spawnP1, ARENA.spawnP2]) {
    assert.ok(Math.abs(spawn.x) < ARENA.limitX);
    assert.ok(Math.abs(spawn.z) < ARENA.limitZ);
  }
  assert.ok(CAMERA.maxOffsetX >= ARENA.limitX);
  assert.ok(CAMERA.maxOffsetZ < ARENA.limitZ);
});

/** Visit individual transforms without treating an instanced batch as one prop. */
function visitPlacements(root, visit) {
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();

  root.traverse((object) => {
    if (!object.isMesh) return;
    if (object.isInstancedMesh) {
      for (let index = 0; index < object.count; index++) {
        object.getMatrixAt(index, matrix);
        matrix.decompose(position, quaternion, scale);
        visit(object, position, scale);
      }
    } else {
      visit(object, object.position, object.scale);
    }
  });
}

for (const map of MAPS) {
  test(`${map.id}: full-width art, <=128 meshes, and complete idempotent disposal`, () => {
    const scene = new THREE.Scene();
    const sentinel = new THREE.Group();
    scene.add(sentinel);
    const background = new THREE.Color(0x123456);
    const fog = new THREE.Fog(0x234567, 2, 100);
    scene.background = background;
    scene.fog = fog;
    const startingChildren = scene.children.slice();

    // Repeat replacement to catch retained roots and non-idempotent cleanup.
    for (let cycle = 0; cycle < 3; cycle++) {
      const handle = buildMap(scene, map.id);
      assert.equal(scene.children.length, startingChildren.length + 1);
      const root = scene.getObjectByName(`arena:${map.id}`);
      assert.ok(root);

      let meshes = 0;
      let instanceBatches = 0;
      let pointLights = 0;
      const resources = new Set();
      root.traverse((object) => {
        if (object.isPointLight) pointLights++;
        if (!object.isMesh) return;
        meshes++;
        resources.add(object.geometry);
        for (const material of [object.material].flat()) resources.add(material);
        if (object.isInstancedMesh) {
          instanceBatches++;
          resources.add(object);
          assert.ok(object.boundingBox);
          assert.ok(object.boundingSphere);
        }
      });

      assert.ok(MAP_ART.meshBudget <= 128);
      assert.ok(meshes <= MAP_ART.meshBudget, `${map.id}: ${meshes} meshes`);
      assert.ok(instanceBatches > 0);
      assert.ok(pointLights <= MAP_ART.maxPropLights);

      const theme = MAP_THEMES.find((candidate) => candidate.id === map.id);
      const decorColor = {
        dojo: theme.decor.paperColor,
        'neon-street': theme.decor.signBackingColor,
        'temple-courtyard': theme.decor.pillarColor,
        rooftop: theme.decor.cityColor,
      }[map.id];
      const propXs = [];
      let slab = null;
      let deckInstances = 0;
      visitPlacements(root, (object, position, scale) => {
        if (object.material.color.getHex() === decorColor) propXs.push(position.x);
        if (
          object.material.color.getHex() === theme.floorColor
          && scale.x === MAP_ART.floorWidth
          && scale.z === MAP_ART.floorDepth
        ) {
          slab = { top: position.y + scale.y / 2 };
        }
        if (
          object.isInstancedMesh
          && object.geometry.type === 'BoxGeometry'
          && Math.abs(position.y + scale.y / 2 - ARENA.floorY) < 1e-6
        ) deckInstances++;
      });
      assert.ok(slab, 'rectangular base slab');
      assert.ok(Math.abs(slab.top - (ARENA.floorY - MAP_ART.deckSink)) < 1e-6);
      assert.ok(Math.min(...propXs) < -MAP_ART.floorWidth * 0.4);
      assert.ok(Math.max(...propXs) > MAP_ART.floorWidth * 0.4);
      if (map.id !== 'neon-street') {
        assert.ok(deckInstances > 20, 'decking must be instanced');
      }

      const disposeCounts = new Map();
      for (const resource of resources) {
        disposeCounts.set(resource, 0);
        resource.addEventListener('dispose', () => {
          disposeCounts.set(resource, disposeCounts.get(resource) + 1);
        });
      }

      handle.dispose();
      handle();
      assert.deepEqual(scene.children, startingChildren);
      assert.equal(scene.background, background);
      assert.equal(scene.fog, fog);
      assert.equal(root.children.length, 0);
      for (const count of disposeCounts.values()) {
        assert.equal(count, 1, 'each owned GPU resource disposed exactly once');
      }
    }
  });
}

function fighter(x, z, y = ARENA.floorY) {
  return { position: new THREE.Vector3(x, y, z) };
}

function assertFramed(camera, fighters, label) {
  camera.updateMatrixWorld(true);
  const projectionView = new THREE.Matrix4().multiplyMatrices(
    camera.projectionMatrix, camera.matrixWorldInverse,
  );
  const frustum = new THREE.Frustum().setFromProjectionMatrix(projectionView);
  const corner = new THREE.Vector3();

  for (const { position } of fighters) {
    for (const dx of [-CAMERA.frameRadius, CAMERA.frameRadius]) {
      for (const dy of [0, CAMERA.frameHeight]) {
        for (const dz of [-CAMERA.frameRadius, CAMERA.frameRadius]) {
          corner.set(position.x + dx, position.y + dy, position.z + dz);
          assert.ok(frustum.containsPoint(corner), `${label}: ${corner.toArray()}`);
          corner.project(camera);
          assert.ok(Math.abs(corner.x) <= 1 - CAMERA.framePadding + 1e-6);
          assert.ok(Math.abs(corner.y) <= 1 - CAMERA.framePadding + 1e-6);
        }
      }
    }
  }
}

for (const aspect of [16 / 9, 4 / 3, 1, 9 / 16]) {
  test(`camera frames both ends, edge tracking and resize at aspect ${aspect}`, () => {
    const camera = new THREE.PerspectiveCamera(
      ARENA.camera.fov, aspect, ARENA.camera.near, ARENA.camera.far,
    );
    const rig = createCameraRig(camera);
    const x = ARENA.limitX;
    const z = ARENA.limitZ;

    const shots = [
      [fighter(-x, 0), fighter(x, 0)],
      [fighter(-x, -z), fighter(x, z, 2)],
      [fighter(-x, z, 2), fighter(x, -z)],
      [fighter(x - 2, z), fighter(x, z)],
      [fighter(-x, -z), fighter(-x + 2, -z)],
    ];

    for (const fighters of shots) {
      // Abrupt changes must be safe before damping has caught up.
      rig.updateCamera(1 / 60, fighters, CAMERA.koPush);
      assertFramed(camera, fighters, 'first frame');

      for (let frame = 0; frame < 180; frame++) {
        rig.updateCamera(1 / 60, fighters, CAMERA.koPush);
        assertFramed(camera, fighters, 'tracking');
      }

      const midpoint = (fighters[0].position.x + fighters[1].position.x) / 2;
      assert.ok(Math.abs(camera.position.x - midpoint) < 0.01);
    }

    camera.aspect = aspect / 2;
    camera.updateProjectionMatrix();
    rig.updateCamera(0);
    assertFramed(camera, shots.at(-1), 'resize without simulation advance');

    rig.resetCamera();
    assert.equal(camera.position.x, ARENA.camera.x);
    assert.equal(camera.position.y, ARENA.camera.y);
    assert.equal(camera.position.z, ARENA.camera.z);
  });
}
