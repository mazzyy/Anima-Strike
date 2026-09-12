import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBackdrop } from '../renderer/src/backdrop.js';
import { buildMap, MAPS } from '../renderer/src/arenas.js';
import {
  ARENA, BODY, BACKDROP, CAMERA, MAP_ART, VFX,
} from '../renderer/src/config.js';

function cameraAt({ x = 0, z = 0, pull = 0, aspect = 16 / 9, shake = 0 } = {}) {
  const camera = new THREE.PerspectiveCamera(
    ARENA.camera.fov, aspect, ARENA.camera.near, ARENA.camera.far,
  );
  camera.rotation.x = THREE.MathUtils.degToRad(ARENA.camera.pitchDeg);
  const direction = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
  camera.position.set(ARENA.camera.x + x, ARENA.camera.y, ARENA.camera.z + z);
  camera.position.addScaledVector(direction, pull);
  camera.position.add(
    new THREE.Vector3(shake, shake, 0).applyQuaternion(camera.quaternion),
  );
  camera.updateMatrixWorld(true);
  return camera;
}

function eachInstance(root, callback, visibleOnly = false) {
  root.updateMatrixWorld(true);
  const visit = (mesh) => {
    if (!mesh.isMesh) return;
    const matrix = new THREE.Matrix4();
    const count = mesh.isInstancedMesh ? mesh.count : 1;
    for (let i = 0; i < count; i++) {
      if (mesh.isInstancedMesh) mesh.getMatrixAt(i, matrix);
      else matrix.identity();
      matrix.premultiply(mesh.matrixWorld);
      callback(mesh, matrix, i);
    }
  };
  if (visibleOnly) root.traverseVisible(visit);
  else root.traverse(visit);
}

function assertOutsidePlayableVolume(backdrop) {
  const reachX = ARENA.limitX + BODY.radius;
  const reachZ = ARENA.limitZ + BODY.radius;
  eachInstance(backdrop.root, (mesh, matrix) => {
    mesh.geometry.computeBoundingBox();
    const bounds = mesh.geometry.boundingBox.clone().applyMatrix4(matrix);
    // Deliberately test an infinitely tall playable XZ prism: jumping cannot
    // make a previously safe decoration become an invisible obstacle.
    const outside = bounds.max.x < -reachX || bounds.min.x > reachX
      || bounds.max.z < -reachZ || bounds.min.z > reachZ;
    assert.ok(outside, `${mesh.name} intersects the playable prism`);
  });
}

function assertClearCentre(backdrop, camera) {
  const foreground = backdrop.layers.at(-1);
  eachInstance(foreground, (mesh, matrix) => {
    const positions = mesh.geometry.attributes.position;
    const point = new THREE.Vector3();
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(matrix).project(camera);
      assert.ok(Number.isFinite(point.x));
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
    }
    // Includes transparent margins, making this stricter than testing only
    // opaque pixels in the softened foreground shader.
    assert.ok(maxX < -1 / 3 || minX > 1 / 3, 'foreground covers the centre third');
  }, true);
}

for (const map of MAPS) {
  test(`${map.id}: depth, factors and aerial perspective are ordered`, () => {
    const scene = new THREE.Scene();
    const backdrop = createBackdrop(scene, map.id);
    try {
      assert.equal(backdrop.layers.length, 4);
      for (let i = 1; i < backdrop.layers.length; i++) {
        const previous = backdrop.layers[i - 1];
        const current = backdrop.layers[i];
        assert.ok(previous.userData.parallax < current.userData.parallax);
        if (!current.userData.foreground) {
          assert.ok(previous.position.z < current.position.z);
        }
      }

      for (let i = 1; i < BACKDROP.layers.length; i++) {
        const a = BACKDROP.layers[i - 1];
        const b = BACKDROP.layers[i];
        assert.ok(a.thickness < b.thickness);
        assert.ok(a.brightness < b.brightness);
        assert.ok(a.blueMix > b.blueMix);
        assert.ok(a.windowRows < b.windowRows);
      }

      for (const x of [0, -CAMERA.maxOffsetX, CAMERA.maxOffsetX, 3, 0]) {
        backdrop.update(cameraAt({ x }));
        BACKDROP.layers.forEach((spec, index) => {
          assert.ok(Math.abs(backdrop.layers[index].position.x - x * spec.parallax) < 1e-10);
        });
      }
    } finally {
      backdrop.dispose();
    }
  });

  test(`${map.id}: pan, pull-back, push-in, shake and resize remain safe`, () => {
    const scene = new THREE.Scene();
    const backdrop = createBackdrop(scene, map.id);
    try {
      backdrop.update(cameraAt());
      assert.equal(backdrop.layers.at(-1).visible, true);
      for (const aspect of [0.55, 1, 16 / 9, 32 / 9]) {
        for (const x of [-CAMERA.maxOffsetX, 0, CAMERA.maxOffsetX]) {
          for (const z of [-CAMERA.maxOffsetZ, CAMERA.maxOffsetZ]) {
            for (const pull of [-CAMERA.koPush, 18, CAMERA.maxPull]) {
              for (const shake of [-VFX.shake.maxStrength, VFX.shake.maxStrength]) {
                const camera = cameraAt({ x, z, pull, aspect, shake });
                backdrop.update(camera);
                assertOutsidePlayableVolume(backdrop);
                assertClearCentre(backdrop, camera);
              }
            }
          }
        }
      }
    } finally {
      backdrop.dispose();
    }
  });

  test(`${map.id}: repeated geometry is instanced and fits combined stage budget`, () => {
    const scene = new THREE.Scene();
    const stage = buildMap(scene, map.id);
    const backdrop = createBackdrop(scene, map.id);
    try {
      let drawCalls = 0;
      let triangles = 0;
      backdrop.root.traverse((mesh) => {
        assert.ok(!mesh.isLight, 'backdrops must not multiply stage lights');
        if (!mesh.isMesh) return;
        assert.ok(mesh.isInstancedMesh);
        assert.equal(mesh.castShadow, false);
        drawCalls++;
        triangles += (mesh.geometry.index?.count
          ?? mesh.geometry.attributes.position.count) / 3 * mesh.count;
      });
      assert.equal(drawCalls, backdrop.stats.drawCalls);
      assert.equal(triangles, backdrop.stats.triangles);
      assert.ok(drawCalls <= BACKDROP.drawCallBudget);
      assert.ok(triangles <= BACKDROP.triangleBudget);

      let combinedMeshes = 0;
      scene.traverse((object) => { if (object.isMesh) combinedMeshes++; });
      assert.ok(combinedMeshes <= MAP_ART.meshBudget);
    } finally {
      backdrop.dispose();
      stage.dispose();
    }
    assert.equal(scene.children.length, 0);
  });

  test(`${map.id}: dispose releases rendered geometry, materials and instance allocations once`, () => {
    const scene = new THREE.Scene();
    const backdrop = createBackdrop(scene, map.id);
    const resources = new Set();
    backdrop.root.traverse((mesh) => {
      if (!mesh.isMesh) return;
      resources.add(mesh);
      resources.add(mesh.geometry);
      resources.add(mesh.material);
    });
    const counts = new Map();
    for (const resource of resources) {
      counts.set(resource, 0);
      resource.addEventListener('dispose', () => {
        counts.set(resource, counts.get(resource) + 1);
      });
    }

    backdrop.dispose();
    backdrop.dispose();
    backdrop.update(cameraAt({ x: 10 }));
    for (const count of counts.values()) assert.equal(count, 1);
    assert.equal(scene.children.length, 0);
    assert.equal(backdrop.root.children.length, 0);
  });
}

test('generator factories are cached, reduced, instanced and owned', () => {
  const scene = new THREE.Scene();
  const disposalCounts = new Map();
  const calls = { city: 0, skyscraper: 0 };

  function watch(resource) {
    disposalCounts.set(resource, 0);
    resource.addEventListener('dispose', () => {
      disposalCounts.set(resource, disposalCounts.get(resource) + 1);
    });
    return resource;
  }

  function source(kind) {
    calls[kind]++;
    const root = new THREE.Group();
    const geometry = watch(new THREE.BoxGeometry(2, 8, 2, 16, 16, 16));
    const texture = watch(new THREE.Texture());
    const material = watch(new THREE.MeshBasicMaterial({ map: texture }));
    const mesh = watch(new THREE.InstancedMesh(geometry, material, 3));
    const transform = new THREE.Object3D();
    for (let i = 0; i < 3; i++) {
      transform.position.set(i * 3, i, 0);
      transform.updateMatrix();
      mesh.setMatrixAt(i, transform.matrix);
    }
    root.add(mesh);
    root.position.set(7, 4, -2);
    return root;
  }

  const backdrop = createBackdrop(scene, 'rooftop', {
    sources: {
      city: () => source('city'),
      skyscraper: () => source('skyscraper'),
    },
  });
  assert.deepEqual(calls, { city: 1, skyscraper: 1 });
  assert.ok(backdrop.stats.triangles <= BACKDROP.triangleBudget);
  backdrop.update(cameraAt());
  assertOutsidePlayableVolume(backdrop);
  backdrop.dispose();
  backdrop.dispose();
  for (const count of disposalCounts.values()) assert.equal(count, 1);
});

test('forest and tree sources are used only by the temple', () => {
  const calls = [];
  const sources = {
    forest: () => {
      calls.push('forest');
      return new THREE.ConeGeometry(3, 8, 8);
    },
    tree: () => {
      calls.push('tree');
      return new THREE.ConeGeometry(1, 5, 5);
    },
  };
  const scene = new THREE.Scene();
  const dojo = createBackdrop(scene, 'dojo', { sources });
  dojo.dispose();
  assert.deepEqual(calls, []);

  const temple = createBackdrop(scene, 'temple-courtyard', { sources });
  assert.deepEqual(calls, ['forest', 'tree']);
  assert.ok(temple.stats.triangles <= BACKDROP.triangleBudget);
  temple.dispose();
});

test('build failure releases already-generated resources and leaves no scene child', () => {
  const scene = new THREE.Scene();
  const geometry = new THREE.BoxGeometry();
  let disposals = 0;
  geometry.addEventListener('dispose', () => disposals++);
  assert.throws(() => createBackdrop(scene, 'rooftop', {
    sources: {
      city: () => geometry,
      skyscraper: () => { throw new Error('source failed'); },
    },
  }), /source failed/);
  assert.equal(disposals, 1);
  assert.equal(scene.children.length, 0);
});

test('map replacement does not accumulate backdrop roots', () => {
  const scene = new THREE.Scene();
  for (let pass = 0; pass < 3; pass++) {
    for (const map of MAPS) {
      const backdrop = createBackdrop(scene, map.id);
      backdrop.update(cameraAt({ x: pass }));
      assert.equal(scene.children.length, 1);
      backdrop.dispose();
      assert.equal(scene.children.length, 0);
    }
  }
});
