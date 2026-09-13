import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MAPS, buildMap } from '../renderer/src/arenas.js';
import { MAP_THEMES } from '../renderer/src/map-themes.js';
import {
  createSky, getSunDirection, getSunLight, isNightSky, validateSkySpec,
} from '../renderer/src/sky.js';

function closeVector(actual, expected, label) {
  assert.ok(actual.distanceTo(expected) < 1e-9, label);
}

test('every map declares a complete, valid atmospheric specification', () => {
  const ranges = {
    elevation: [-90, 90],
    azimuth: [0, 360],
    turbidity: [0, 20],
    rayleigh: [0, 4],
    mieCoefficient: [0, 0.1],
    mieDirectionalG: [0, 1],
  };
  for (const map of MAPS) {
    assert.equal(validateSkySpec(map.sky), true);
    for (const [field, [min, max]] of Object.entries(ranges)) {
      const value = map.sky[field];
      assert.ok(Number.isFinite(value), `${map.id}: ${field}`);
      assert.ok(value >= min && value <= max, `${map.id}: ${field}`);
    }
    assert.ok(map.sky.mieDirectionalG < 1, 'avoid the forward-scattering pole');
    for (const field of Object.keys(ranges)) {
      const incomplete = { ...map.sky };
      delete incomplete[field];
      assert.throws(() => validateSkySpec(incomplete));
    }
  }
  assert.throws(() => validateSkySpec(null));
  assert.throws(() => validateSkySpec({ ...MAPS[0].sky, mieDirectionalG: 1 }));
  assert.throws(() => validateSkySpec({ ...MAPS[0].sky, rayleigh: NaN }));
  assert.throws(() => validateSkySpec({ ...MAPS[0].sky, turbidity: -1 }));

  const byId = Object.fromEntries(MAPS.map((map) => [map.id, map.sky]));
  assert.ok(byId.dojo.elevation > 0 && byId.dojo.elevation < 25);
  assert.ok(byId['temple-courtyard'].elevation > 0);
  assert.ok(byId['temple-courtyard'].elevation < 5);
  assert.ok(byId.rooftop.elevation < 0 && byId.rooftop.elevation > -12);
  assert.equal(isNightSky(byId['neon-street']), true);
});

test('declared and built key lights point towards the shader sun', () => {
  for (const map of MAPS) {
    const scene = new THREE.Scene();
    const handle = buildMap(scene, map.id);
    try {
      // Independent spherical-coordinate calculation, not just comparison of
      // two callers of the same helper.
      const elevation = map.sky.elevation * Math.PI / 180;
      const azimuth = map.sky.azimuth * Math.PI / 180;
      const expected = new THREE.Vector3(
        Math.cos(elevation) * Math.sin(azimuth),
        Math.sin(elevation),
        Math.cos(elevation) * Math.cos(azimuth),
      );
      closeVector(getSunDirection(map.sky), expected, map.id);

      const spec = map.lights.find((light) => light.role === 'key');
      assert.ok(spec);
      closeVector(new THREE.Vector3(...spec.position).normalize(), expected, map.id);

      scene.updateMatrixWorld(true);
      const light = scene.getObjectByName('arena:key');
      assert.ok(light?.isDirectionalLight);
      const actual = light.getWorldPosition(new THREE.Vector3())
        .sub(light.target.getWorldPosition(new THREE.Vector3()))
        .normalize();
      closeVector(actual, expected, `${map.id}: actual target-relative direction`);
      assert.equal(light.color.getHex(), getSunLight(map.sky).color);

      if (map.sky.elevation <= 0) {
        assert.equal(light.intensity, 0, 'no sunlight coming through the floor');
        assert.equal(light.castShadow, false);
      } else {
        assert.ok(light.intensity > 0);
        assert.equal(light.castShadow, true);
        // Projecting a vertical object away from this sun produces the
        // opposite horizontal direction, not a shadow toward the sun.
        const shadow = new THREE.Vector3(
          -actual.x / actual.y, 0, -actual.z / actual.y,
        );
        assert.ok(shadow.dot(new THREE.Vector3(actual.x, 0, actual.z)) < 0);
      }
    } finally {
      handle.dispose();
    }
  }
});

test('lower elevation warms the computed direct light', () => {
  const spec = MAPS[0].sky;
  const high = new THREE.Color(getSunLight({ ...spec, elevation: 60 }).color);
  const low = new THREE.Color(getSunLight({ ...spec, elevation: 2 }).color);
  assert.ok(low.r / low.b > high.r / high.b);
});

test('night has deterministic stars; atmospheric stages do not', () => {
  for (const theme of MAP_THEMES) {
    const scene = new THREE.Scene();
    const sky = createSky(scene, theme);
    try {
      assert.equal(Boolean(sky.stars), theme.id === 'neon-street');
      if (sky.stars) {
        assert.ok(sky.stars.isPoints);
        const positions = sky.stars.geometry.getAttribute('position');
        assert.ok(positions.count > 0);
        for (let i = 0; i < positions.count; i++) {
          assert.ok(positions.getY(i) > 0);
        }
        const second = createSky(scene, theme);
        try {
          assert.deepEqual(
            second.stars.geometry.getAttribute('position').array,
            positions.array,
          );
        } finally {
          second.dispose();
        }
      } else {
        assert.equal(sky.atmosphere.name, 'sky:atmosphere');
        const uniforms = sky.atmosphere.material.uniforms;
        closeVector(uniforms.sunPosition.value, getSunDirection(theme.sky), theme.id);
        for (const field of [
          'turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG',
        ]) {
          assert.equal(uniforms[field].value, theme.sky[field]);
        }
      }
      assert.equal(
        sky.haze.material.uniforms.hazeColor.value.getHex(),
        theme.fog.color,
      );
      const texture = sky.clouds.material.uniforms.noiseMap.value;
      assert.ok(texture.isDataTexture);
      assert.equal(texture.wrapS, THREE.RepeatWrapping);
      const alphas = new Set();
      for (let i = 3; i < texture.image.data.length; i += 4) {
        alphas.add(texture.image.data[i]);
      }
      assert.ok(alphas.size > 16, 'cloud alpha must contain actual noise');
    } finally {
      sky.dispose();
    }
    assert.equal(scene.children.length, 0);
  }
});

test('clouds drift and flare visibility follows the final camera', () => {
  const theme = MAP_THEMES.find((map) => map.id === 'dojo');
  const sky = createSky(new THREE.Scene(), theme);
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 500);
  camera.position.set(30, 12, 8);
  const direction = getSunDirection(theme.sky);
  try {
    camera.lookAt(camera.position.clone().add(direction));
    sky.update(0, camera);
    assert.equal(sky.flare.visible, true);
    closeVector(sky.root.position, camera.position, 'camera-centred sky');

    const before = sky.clouds.material.uniforms.offset.value.clone();
    sky.update(10, camera);
    assert.ok(before.distanceTo(sky.clouds.material.uniforms.offset.value) > 0);

    camera.position.add(new THREE.Vector3(100, 20, -80));
    camera.far = 900;
    camera.aspect = 0.5;
    camera.updateProjectionMatrix();
    camera.lookAt(camera.position.clone().add(direction));
    sky.update(0, camera);
    assert.equal(sky.flare.visible, true);
    closeVector(sky.root.position, camera.position, 'translation and resize');
    assert.ok(sky.root.scale.x * Math.sqrt(3) < camera.far);

    camera.lookAt(camera.position.clone().sub(direction));
    sky.update(0, camera);
    assert.equal(sky.flare.visible, false, 'sun behind the camera');

    camera.lookAt(camera.position.clone().add(new THREE.Vector3(0, 1, 0)));
    sky.update(0, camera);
    assert.equal(sky.flare.visible, false, 'sun outside the shot');
  } finally {
    sky.dispose();
  }
});

test('sky disposal releases owned and private Lensflare textures exactly once', () => {
  const originalDispose = THREE.Texture.prototype.dispose;
  const disposedTextures = [];
  THREE.Texture.prototype.dispose = function () {
    disposedTextures.push(this);
    return originalDispose.call(this);
  };

  try {
    for (let cycle = 0; cycle < 2; cycle++) {
      for (const theme of MAP_THEMES) {
        const start = disposedTextures.length;
        const scene = new THREE.Scene();
        const sky = createSky(scene, theme);
        const owned = [...sky.resources.textures];
        const observed = new Map();
        for (const set of Object.values(sky.resources)) {
          for (const resource of set) {
            observed.set(resource, 0);
            resource.addEventListener('dispose', () => {
              observed.set(resource, observed.get(resource) + 1);
            });
          }
        }

        sky.dispose();
        sky.dispose();
        sky.update(1, new THREE.PerspectiveCamera());
        assert.equal(scene.children.length, 0);
        for (const set of Object.values(sky.resources)) assert.equal(set.size, 0);
        for (const count of observed.values()) assert.equal(count, 1);

        const released = disposedTextures.slice(start);
        assert.equal(new Set(released).size, released.length);
        for (const texture of owned) assert.ok(released.includes(texture));
        const privateTextures = released.filter((texture) => !owned.includes(texture));
        assert.equal(privateTextures.length, theme.sky.elevation > 0 ? 2 : 0);
        for (const texture of privateTextures) {
          assert.ok(texture.isFramebufferTexture, 'Lensflare occlusion/copy texture');
        }
      }
    }
  } finally {
    THREE.Texture.prototype.dispose = originalDispose;
  }
});

test('map switching cleans sky resources and allocated shadow render targets', () => {
  const scene = new THREE.Scene();
  const background = new THREE.Color(0x123456);
  const fog = new THREE.Fog(0x234567, 1, 20);
  const sentinel = new THREE.Group();
  scene.background = background;
  scene.fog = fog;
  scene.add(sentinel);

  for (const spec of MAPS) {
    const map = buildMap(scene, spec.id);
    const skyRoot = scene.getObjectByName(`sky:${spec.id}`);
    assert.ok(skyRoot);
    let releasedTextures = 0;
    const textures = new Set();
    skyRoot.traverse((object) => {
      for (const uniform of Object.values(object.material?.uniforms ?? {})) {
        if (uniform.value?.isTexture) textures.add(uniform.value);
      }
    });
    for (const texture of textures) {
      texture.addEventListener('dispose', () => releasedTextures++);
    }

    // Headless stand-ins for the targets WebGLRenderer allocates lazily.
    // Light.dispose must release both a shadow map and its filtering pass.
    let targets = 0;
    let releasedTargets = 0;
    scene.traverse((object) => {
      if (!object.isLight || !object.shadow) return;
      for (const field of ['map', 'mapPass']) {
        const target = new THREE.WebGLRenderTarget(4, 4);
        object.shadow[field] = target;
        targets++;
        target.addEventListener('dispose', () => releasedTargets++);
      }
    });

    map.update(0, new THREE.PerspectiveCamera(45, 1, 0.1, 500));
    map.dispose();
    map.dispose();
    assert.equal(releasedTextures, textures.size);
    assert.equal(releasedTargets, targets);
    assert.equal(skyRoot.parent, null);
    assert.equal(skyRoot.children.length, 0);
    assert.deepEqual(scene.children, [sentinel]);
    assert.equal(scene.background, background);
    assert.equal(scene.fog, fog);
  }
});
