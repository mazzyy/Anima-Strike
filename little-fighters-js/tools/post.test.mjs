import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MAPS, buildMap } from '../renderer/src/arenas.js';
import { MAP_THEMES, POST } from '../renderer/src/config.js';
import {
  createPost, createQualityMeter, chooseTier, validateGrade,
} from '../renderer/src/post.js';

/**
 * Real composers, passes, shaders, textures and targets; only the WebGL
 * renderer is replaced. These tests require neither a DOM nor a GL context.
 * GPU appearance still needs an Electron visual smoke test.
 */
function fakeRenderer() {
  const size = new THREE.Vector2(800, 600);
  let ratio = 1;
  return {
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 1,
    outputColorSpace: THREE.SRGBColorSpace,
    getSize: (out) => out.copy(size),
    getPixelRatio: () => ratio,
    setPixelRatio(value) { ratio = value; },
    setSize(w, h) { size.set(w, h); },
  };
}

function build(tier, autoQuality = false) {
  const renderer = fakeRenderer();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 4 / 3, 1, 220);
  const post = createPost(renderer, scene, camera, { tier, autoQuality });
  return { renderer, scene, camera, post };
}

function ownedResources(object) {
  const resources = new Set();
  function inspect(value) {
    if (Array.isArray(value)) {
      value.forEach(inspect);
    } else if (
      value?.isWebGLRenderTarget || value?.isMaterial || value?.isTexture
    ) {
      resources.add(value);
    }
  }
  Object.values(object).forEach(inspect);
  return resources;
}

function pipelineResources(post) {
  const resources = ownedResources(post.composer);
  for (const pass of post.composer.passes) {
    for (const resource of ownedResources(pass)) resources.add(resource);
  }
  return resources;
}

function watchDisposal(resources) {
  const counts = new Map();
  for (const resource of resources) {
    counts.set(resource, 0);
    resource.addEventListener('dispose', () => {
      counts.set(resource, counts.get(resource) + 1);
    });
  }
  return counts;
}

test('every public map declares a complete, bounded grade from config', () => {
  assert.equal(MAPS.length, MAP_THEMES.length);
  for (const map of MAPS) {
    const theme = MAP_THEMES.find((candidate) => candidate.id === map.id);
    assert.equal(map.grade, theme.grade);
    assert.equal(validateGrade(map.grade), true, map.id);

    const built = buildMap(new THREE.Scene(), map.id);
    assert.equal(built.grade, map.grade);
    built.dispose();
  }
  const grade = MAPS[0].grade;
  assert.equal(validateGrade({ ...grade, exposure: NaN }), false);
  assert.equal(validateGrade({ ...grade, tint: [1, 1] }), false);
  assert.equal(validateGrade({ ...grade, saturation: 2 }), false);
  assert.equal(validateGrade({ ...grade, bloom: { ...grade.bloom, radius: -1 } }), false);
});

test('tier pass lists are ordered subsets, with output last', () => {
  const { high, medium, low } = POST.tiers;
  assert.deepEqual(high.passes, [
    'render', 'bloom', 'ao', 'fxaa', 'vignette', 'saturation', 'tint', 'output',
  ]);
  for (const [lower, higher] of [[low, medium], [medium, high]]) {
    assert.deepEqual(
      higher.passes.filter((name) => lower.passes.includes(name)),
      lower.passes,
    );
    assert.ok(lower.maxPixelRatio <= higher.maxPixelRatio);
    assert.ok(lower.resolutionScale <= higher.resolutionScale);
  }
  assert.ok(!low.passes.includes('ao'));
  assert.ok(!low.passes.includes('bloom'));
});

for (const tier of ['high', 'medium', 'low']) {
  test(`${tier} builds real passes and releases all owned resources once`, () => {
    for (let cycle = 0; cycle < 3; cycle++) {
      const { post, renderer } = build(tier);
      assert.deepEqual(post.passNames, POST.tiers[tier].passes);
      assert.equal(post.composer.passes.length, post.passNames.length);
      assert.equal(post.composer.renderTarget1.texture.type, THREE.HalfFloatType);
      const resources = pipelineResources(post);
      const targets = [...resources].filter((item) => item.isWebGLRenderTarget);
      assert.ok(targets.length >= 2);
      if (tier === 'low') assert.equal(targets.length, 2);
      if (tier === 'high') assert.ok(targets.length > 2);
      const counts = watchDisposal(resources);

      post.dispose();
      post.dispose();
      for (const [resource, count] of counts) {
        assert.equal(count, 1, `${tier}: ${resource.constructor.name}`);
      }
      assert.equal(post.composer.passes.length, 0);
      assert.equal(renderer.toneMappingExposure, 1);
      assert.doesNotThrow(() => post.render(100));
      assert.doesNotThrow(() => post.setSize(100, 100));
    }
  });

  test(`${tier} setSize updates every pass in physical pixels`, () => {
    const { post, renderer } = build(tier);
    try {
      const received = new Map();
      for (const pass of post.composer.passes) {
        const original = pass.setSize.bind(pass);
        pass.setSize = (w, h) => {
          received.set(pass, [w, h]);
          original(w, h);
        };
      }
      post.setSize(1000, 800, 2);
      const ratio = POST.tiers[tier].maxPixelRatio * POST.tiers[tier].resolutionScale;
      assert.equal(renderer.getPixelRatio(), ratio);
      assert.deepEqual(renderer.getSize(new THREE.Vector2()).toArray(), [1000, 800]);
      for (const pass of post.composer.passes) {
        assert.deepEqual(received.get(pass), [1000 * ratio, 800 * ratio]);
      }
      assert.equal(post.composer.renderTarget1.width, 1000 * ratio);
      assert.equal(post.composer.renderTarget2.height, 800 * ratio);

      const fxaa = post.composer.passes[post.passNames.indexOf('fxaa')];
      assert.deepEqual(
        fxaa.uniforms.resolution.value.toArray(),
        [1 / (1000 * ratio), 1 / (800 * ratio)],
      );

      post.setSize(0, 0, 1);
      assert.ok(post.composer.renderTarget1.width > 0);
      assert.ok(post.composer.renderTarget1.height > 0);
    } finally {
      post.dispose();
    }
  });
}

test('downgrading disposes removed targets and upgrading recreates only missing passes', () => {
  const { post } = build('high');
  try {
    const originalPasses = new Map(
      post.passNames.map((name, index) => [name, post.composer.passes[index]]),
    );
    const removed = new Set([
      ...ownedResources(originalPasses.get('ao')),
      ...ownedResources(originalPasses.get('bloom')),
    ]);
    const counts = watchDisposal(removed);
    post.setTier('low');
    for (const count of counts.values()) assert.equal(count, 1);
    for (const [index, name] of post.passNames.entries()) {
      assert.equal(post.composer.passes[index], originalPasses.get(name));
    }

    post.setGrade(MAPS[1].grade);
    post.setTier('high');
    const bloom = post.composer.passes[post.passNames.indexOf('bloom')];
    assert.notEqual(bloom, originalPasses.get('bloom'));
    assert.equal(bloom.strength, MAPS[1].grade.bloom.strength);
    assert.equal(bloom.threshold, MAPS[1].grade.bloom.threshold);
    assert.equal(bloom.radius, MAPS[1].grade.bloom.radius);

    post.dispose();
    for (const count of counts.values()) assert.equal(count, 1);
  } finally {
    post.dispose();
  }
});

test('map changes update grading without allocating new targets', () => {
  const { post, renderer } = build('high');
  try {
    const before = pipelineResources(post);
    for (const map of MAPS) {
      post.setGrade(map.grade);
      assert.equal(renderer.toneMappingExposure, map.grade.exposure);
      const saturation = post.composer.passes[post.passNames.indexOf('saturation')];
      const tint = post.composer.passes[post.passNames.indexOf('tint')];
      assert.equal(saturation.uniforms.saturation.value, map.grade.saturation);
      assert.deepEqual(tint.uniforms.tint.value.toArray(), map.grade.tint);
      assert.equal(tint.uniforms.contrast.value, map.grade.contrast);
      assert.deepEqual(pipelineResources(post), before);
    }
  } finally {
    post.dispose();
  }
});

function measure(frameMs) {
  const meter = createQualityMeter();
  for (let now = 0; now < 3000; now += frameMs) meter.sample(now);
  return meter.tier;
}

test('slow measured frames select a lower tier than fast measured frames', () => {
  assert.equal(chooseTier(16.7), 'high');
  assert.equal(chooseTier(25), 'medium');
  assert.equal(chooseTier(60), 'low');
  assert.equal(measure(16.7), 'high');
  assert.equal(measure(25), 'medium');
  assert.equal(measure(60), 'low');
});

test('quality monitor excludes hidden time and does not oscillate after a downgrade', () => {
  const meter = createQualityMeter();
  for (let now = 0; now < 2500; now += 16) meter.sample(now);
  assert.equal(meter.tier, 'high');
  meter.sample(3000, false);
  meter.sample(60000);
  assert.equal(meter.tier, 'high');

  for (let now = 60016; now < 63000; now += 60) meter.sample(now);
  assert.equal(meter.tier, 'low');
  for (let now = 64000; now < 69000; now += 8) meter.sample(now);
  assert.equal(meter.tier, 'low');
});

test('render routes through the composer and applies measured quality', () => {
  const { post } = build('medium', true);
  let renders = 0;
  post.composer.render = () => { renders++; };
  try {
    post.render(0, false);
    assert.equal(renders, 0);
    for (let now = 0; now < 2500; now += 60) post.render(now);
    assert.ok(renders > 0);
    assert.equal(post.tier, 'low');
    assert.ok(!post.passNames.includes('bloom'));
    assert.ok(!post.passNames.includes('ao'));
  } finally {
    post.dispose();
  }
});
