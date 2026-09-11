import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MAPS, buildMap } from '../renderer/src/arenas.js';

function trackResources(root) {
  const resources = new Set();
  const lights = [];
  const shadowCounts = [];

  root.traverse((object) => {
    if (object.geometry) resources.add(object.geometry);
    if (object.material) {
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material]) {
        resources.add(material);
      }
    }
    if (object.isLight) lights.push(object);
    if (object.shadow) {
      const counter = { count: 0 };
      const original = object.shadow.dispose.bind(object.shadow);
      object.shadow.dispose = () => {
        counter.count++;
        original();
      };
      shadowCounts.push(counter);
    }
  });

  const counts = new Map();
  for (const resource of resources) {
    counts.set(resource, 0);
    resource.addEventListener('dispose', () => {
      counts.set(resource, counts.get(resource) + 1);
    });
  }

  return { resources, counts, lights, shadowCounts };
}

test('four maps expose unique IDs and complete descriptors', () => {
  assert.equal(MAPS.length, 4);
  assert.equal(new Set(MAPS.map((map) => map.id)).size, MAPS.length);

  for (const map of MAPS) {
    assert.equal(typeof map.id, 'string');
    assert.ok(map.id.length);
    assert.equal(typeof map.name, 'string');
    assert.ok(map.name.length);
    assert.equal(typeof map.floorColor, 'number');
    assert.equal(typeof map.skyColor, 'number');
    assert.ok(map.fog.far > map.fog.near);
    assert.ok(map.lights.length > 0);
    assert.equal(typeof map.build, 'function');
  }
});

test('unknown and omitted IDs build the first map', () => {
  for (const id of ['not-an-arena', undefined, null]) {
    const scene = new THREE.Scene();
    const dispose = buildMap(scene, id);
    assert.equal(typeof dispose, 'function');
    assert.equal(dispose.mapId, MAPS[0].id);
    assert.equal(scene.children[0].name, `arena:${MAPS[0].id}`);
    assert.equal(scene.background.getHex(), MAPS[0].skyColor);
    dispose();
    assert.equal(scene.children.length, 0);
    assert.equal(scene.background, null);
    assert.equal(scene.fog, null);
  }
});

for (const map of MAPS) {
  test(`${map.id}: dispose restores scene and releases every owned resource once`, () => {
    const scene = new THREE.Scene();
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshBasicMaterial();
    const existing = new THREE.Mesh(geometry, material);
    const existingLight = new THREE.AmbientLight();
    scene.add(existing, existingLight);

    const background = new THREE.Color(0x123456);
    const fog = new THREE.Fog(0x654321, 2, 100);
    scene.background = background;
    scene.fog = fog;
    const originalChildren = [...scene.children];
    let foreignDisposals = 0;
    geometry.addEventListener('dispose', () => foreignDisposals++);
    material.addEventListener('dispose', () => foreignDisposals++);

    // Exercise the public per-descriptor builder as well as buildMap().
    const handle = map.build(scene);
    assert.equal(scene.children.length, originalChildren.length + 1);
    const root = scene.children.at(-1);
    const tracked = trackResources(root);
    assert.ok(tracked.resources.size > 0);
    assert.ok(tracked.lights.length >= map.lights.length);
    assert.ok(tracked.shadowCounts.length > 0);

    handle.dispose();
    handle.dispose();

    assert.equal(scene.children.length, originalChildren.length);
    assert.deepEqual(scene.children, originalChildren);
    assert.equal(root.parent, null);
    assert.equal(root.children.length, 0);
    assert.equal(scene.background, background);
    assert.equal(scene.fog, fog);
    assert.equal(foreignDisposals, 0);
    for (const count of tracked.counts.values()) assert.equal(count, 1);
    for (const counter of tracked.shadowCounts) assert.equal(counter.count, 1);

    geometry.dispose();
    material.dispose();
  });
}

test('repeated map replacement has a constant child count and no shared resources', () => {
  const scene = new THREE.Scene();
  const fighter = new THREE.Group();
  scene.add(fighter);
  const baseline = [...scene.children];
  const allResources = new Set();

  for (let cycle = 0; cycle < 3; cycle++) {
    for (const map of MAPS) {
      const handle = buildMap(scene, map.id);
      assert.equal(scene.children.length, baseline.length + 1);
      const tracked = trackResources(scene.children.at(-1));

      for (const resource of tracked.resources) {
        assert.ok(!allResources.has(resource), 'maps must not reuse disposed resources');
        allResources.add(resource);
      }

      handle.dispose();
      assert.deepEqual(scene.children, baseline);
      for (const count of tracked.counts.values()) assert.equal(count, 1);
    }
  }
});

test('disposing a map preserves objects and environment installed by other owners', () => {
  const scene = new THREE.Scene();
  const handle = buildMap(scene, MAPS[0].id);
  const fighter = new THREE.Group();
  scene.add(fighter);
  const background = new THREE.Color(0xaabbcc);
  const fog = new THREE.Fog(0xaabbcc, 3, 60);
  scene.background = background;
  scene.fog = fog;

  handle.dispose();

  assert.deepEqual(scene.children, [fighter]);
  assert.equal(scene.background, background);
  assert.equal(scene.fog, fog);
});
