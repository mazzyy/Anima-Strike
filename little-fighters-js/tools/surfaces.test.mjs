import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MAP_THEMES } from '../renderer/src/map-themes.js';
import { MAP_ART } from '../renderer/src/config.js';
import { buildMap } from '../renderer/src/arenas.js';
import {
  createSurfaceMaps,
  createSurfaces,
  createDecalPool,
  reflectorResolution,
} from '../renderer/src/surfaces.js';

function canvasFactory(width, height) {
  let pixels = new Uint8ClampedArray(width * height * 4);
  const context = {
    createImageData(w, h) {
      return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
    },
    putImageData(image) {
      pixels = image.data.slice();
    },
    getImageData() {
      return { data: pixels };
    },
  };
  return { width, height, getContext: () => context };
}

function pixelsOf(texture) {
  return texture.image.getContext('2d').getImageData(
    0, 0, texture.image.width, texture.image.height,
  ).data;
}

function channelRange(pixels, channel) {
  let min = 255;
  let max = 0;
  for (let i = channel; i < pixels.length; i += 4) {
    min = Math.min(min, pixels[i]);
    max = Math.max(max, pixels[i]);
  }
  return max - min;
}

test('every generated surface triplet contains spatial variation', () => {
  for (const theme of MAP_THEMES) {
    const maps = createSurfaceMaps(theme, { canvasFactory });
    try {
      for (const texture of maps.textures) {
        assert.equal(texture.isCanvasTexture, true);
        const pixels = pixelsOf(texture);
        assert.ok(
          channelRange(pixels, 0) + channelRange(pixels, 1)
            + channelRange(pixels, 2) > 10,
          `${theme.id}: ${texture.name} must not be a flat fill`,
        );
        assert.equal(texture.image.width, maps.map.image.width);
        assert.deepEqual(texture.repeat.toArray(), maps.map.repeat.toArray());
      }
      assert.equal(maps.map.colorSpace, THREE.SRGBColorSpace);
      assert.equal(maps.normalMap.colorSpace, THREE.NoColorSpace);
      assert.equal(maps.roughnessMap.colorSpace, THREE.NoColorSpace);
    } finally {
      maps.dispose();
    }
  }
});

test('all arena normal-mapped materials have their matching roughness map', () => {
  for (const theme of MAP_THEMES) {
    const scene = new THREE.Scene();
    const stage = buildMap(scene, theme.id, {
      quality: 'low',
      canvasFactory,
    });
    try {
      let count = 0;
      scene.traverse((object) => {
        const materials = Array.isArray(object.material)
          ? object.material : [object.material];
        for (const material of materials) {
          if (!material?.normalMap) continue;
          count++;
          assert.equal(material.normalMap, stage.surfaces.maps.normalMap);
          assert.equal(material.roughnessMap, stage.surfaces.maps.roughnessMap);
          assert.equal(material.map, stage.surfaces.maps.map);
        }
      });
      assert.ok(count > 0, theme.id);
    } finally {
      stage.dispose();
    }
  }
});

test('decal pool has a hard cap, recycles oldest first, and frees old geometry', () => {
  const parent = new THREE.Group();
  const geometry = new THREE.PlaneGeometry(10, 10);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial();
  const receiver = new THREE.Mesh(geometry, material);
  const pool = createDecalPool({
    parent,
    receiver,
    materials: { scorch: material, crack: material, scuff: material },
    capacity: 2,
  });
  try {
    const first = pool.add('scorch', new THREE.Vector3(), 1);
    const second = pool.add('crack', new THREE.Vector3(), 1);
    assert.ok(first.geometry.getAttribute('position').count > 0);
    let released = 0;
    first.geometry.addEventListener('dispose', () => released++);
    const third = pool.add('scuff', new THREE.Vector3(), 1);
    assert.equal(third, first);
    assert.equal(released, 1);
    assert.equal(pool.size, 2);
    assert.deepEqual(pool.oldestFirst, [second, third]);

    for (let i = 0; i < 200; i++) {
      pool.add('scorch', new THREE.Vector3(), 1);
    }
    assert.equal(pool.size, 2);
    assert.equal(parent.children.length, 2);

    const heights = pool.oldestFirst.map((mesh) => {
      mesh.geometry.computeBoundingBox();
      return mesh.geometry.boundingBox.min.y;
    });
    assert.notEqual(heights[0], heights[1]);
    assert.ok(heights.every((y) => y > MAP_ART.surfaceLift * 6));
  } finally {
    pool.dispose();
    pool.dispose();
    geometry.dispose();
    material.dispose();
  }
  assert.equal(parent.children.length, 0);
  assert.equal(pool.add('scorch', new THREE.Vector3(), 1), null);
});

test('street reflector shrinks with quality, releases targets, and is absent on low', () => {
  const theme = MAP_THEMES.find((item) => item.id === 'neon-street');
  const root = new THREE.Group();
  const surfaces = createSurfaces(root, theme, {
    quality: 'high',
    canvasFactory,
  });
  try {
    surfaces.install();
    const high = surfaces.reflector;
    assert.ok(high?.isReflector);
    assert.equal(high.getRenderTarget().width, reflectorResolution('high'));
    let highTargetDisposed = 0;
    high.getRenderTarget().addEventListener('dispose', () => highTargetDisposed++);

    surfaces.setQuality('medium');
    assert.equal(highTargetDisposed, 1);
    const medium = surfaces.reflector;
    assert.ok(medium.getRenderTarget().width < high.getRenderTarget().width);
    assert.equal(medium.getRenderTarget().width, reflectorResolution('medium'));

    surfaces.setQuality('low');
    assert.equal(surfaces.reflector, null);
    assert.equal(reflectorResolution('low'), 0);
    assert.equal(root.children.some((item) => item.isReflector), false);

    surfaces.setQuality('high');
    assert.ok(surfaces.reflector);
  } finally {
    surfaces.dispose();
  }

  for (const other of MAP_THEMES.filter((item) => item !== theme)) {
    const dry = createSurfaces(new THREE.Group(), other, {
      quality: 'high',
      canvasFactory,
    });
    try {
      dry.install();
      assert.equal(dry.reflector, null);
    } finally {
      dry.dispose();
    }
  }
});

test('stage disposal releases every generated canvas texture exactly once', () => {
  const scene = new THREE.Scene();
  const stage = buildMap(scene, 'neon-street', { canvasFactory });
  const textures = [...stage.surfaces.textures];
  const counts = new Map(textures.map((texture) => [texture, 0]));
  for (const texture of textures) {
    assert.equal(texture.isCanvasTexture, true);
    texture.addEventListener('dispose', () => {
      counts.set(texture, counts.get(texture) + 1);
    });
  }
  stage.addMark('scorch', new THREE.Vector3(), 1);
  stage.dispose();
  stage.dispose();
  for (const [texture, count] of counts) {
    assert.equal(count, 1, texture.name);
  }
  assert.equal(stage.surfaces, null);
  assert.equal(scene.children.length, 0);
});
