/**
 * HDR post-processing. Sizes are CSS pixels; pixel ratio is applied once.
 * No browser globals are needed to construct, resize, or dispose this module.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';
import { HueSaturationShader } from 'three/addons/shaders/HueSaturationShader.js';
import {
  POST,
} from './config.js';
import { MAP_THEMES } from './map-themes.js';

const tierNames = ['low', 'medium', 'high'];

const TintShader = {
  uniforms: {
    tDiffuse: { value: null },
    tint: { value: new THREE.Vector3(1, 1, 1) },
    contrast: { value: 1 },
    pivot: { value: POST.contrastPivot },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec3 tint;
    uniform float contrast;
    uniform float pivot;
    varying vec2 vUv;
    void main() {
      vec4 source = texture2D(tDiffuse, vUv);
      vec3 graded = (source.rgb * tint - pivot) * contrast + pivot;
      gl_FragColor = vec4(max(graded, vec3(0.0)), source.a);
    }
  `,
};

/** RGB tint values are linear multipliers, not display-space hex colors. */
export function validateGrade(grade) {
  if (!grade || !grade.bloom) return false;
  const within = (value, range) => (
    Number.isFinite(value) && value >= range[0] && value <= range[1]
  );
  for (const key of ['strength', 'radius', 'threshold']) {
    if (!within(grade.bloom[key], POST.gradeRanges.bloom[key])) return false;
  }
  for (const key of ['exposure', 'vignette', 'saturation', 'contrast']) {
    if (!within(grade[key], POST.gradeRanges[key])) return false;
  }
  return Array.isArray(grade.tint)
    && grade.tint.length === 3
    && grade.tint.every((value) => within(value, POST.gradeRanges.tint));
}

export function chooseTier(frameMs, sustained = false) {
  if (!Number.isFinite(frameMs) || frameMs <= 0) return 'low';
  const limits = sustained ? POST.sustainedFrameMs : POST.initialFrameMs;
  if (frameMs <= limits.high) return 'high';
  if (frameMs <= limits.medium) return 'medium';
  return 'low';
}

/**
 * Samples start-to-start presentation intervals, not simulation dt or CPU
 * submission duration. That includes vsync and GPU back-pressure.
 *
 * Initial calibration may promote medium to high. Subsequent windows only
 * downgrade, preventing oscillation between cheap and expensive pipelines.
 * Hidden windows are excluded; genuinely slow visible frames are not clamped.
 */
export function createQualityMeter(initialTier = POST.initialTier) {
  let tier = initialTier;
  let calibrated = false;
  let last = null;
  let warmup = POST.warmupMs;
  let elapsed = 0;
  let frames = 0;

  function reset(nextTier = tier, recalibrate = false) {
    tier = nextTier;
    if (recalibrate) calibrated = false;
    last = null;
    warmup = POST.warmupMs;
    elapsed = 0;
    frames = 0;
  }

  function sample(now, visible = true) {
    if (!visible || !Number.isFinite(now)) {
      reset();
      return null;
    }
    if (last === null) {
      last = now;
      return null;
    }
    const dt = now - last;
    last = now;
    if (dt <= 0) return null;
    if (warmup > 0) {
      warmup -= dt;
      return null;
    }

    elapsed += dt;
    frames++;
    const mean = elapsed / frames;
    const emergency = elapsed >= POST.emergencyWindowMs
      && mean > POST.emergencyFrameMs;
    if (!emergency && elapsed < POST.sampleMs) return null;

    let next = emergency ? 'low' : chooseTier(mean, calibrated);
    if (calibrated && tierNames.indexOf(next) > tierNames.indexOf(tier)) {
      next = tier;
    }
    calibrated = true;
    elapsed = 0;
    frames = 0;
    if (next === tier) return null;
    reset(next);
    return next;
  }

  return { sample, reset, get tier() { return tier; } };
}

/**
 * Composer does NOT dispose its passes. Some addon revisions also omit a
 * directly owned noise texture/material from dispose(). Release those too,
 * without double-disposing resources handled by the addon itself.
 *
 * Do not traverse scenes or uniforms: their resources belong to somebody else.
 */
function disposePass(pass) {
  const owned = new Set();
  function collect(value) {
    if (Array.isArray(value)) {
      value.forEach(collect);
    } else if (
      value?.isWebGLRenderTarget || value?.isMaterial || value?.isTexture
    ) {
      owned.add(value);
    }
  }
  Object.values(pass).forEach(collect);
  const released = new Set();
  const onDispose = (event) => released.add(event.target);
  for (const resource of owned) resource.addEventListener('dispose', onDispose);
  try {
    pass.dispose();
    for (const resource of owned) {
      if (!released.has(resource)) resource.dispose();
    }
  } finally {
    for (const resource of owned) {
      resource.removeEventListener('dispose', onDispose);
    }
  }
}

export function createPost(renderer, scene, camera, {
  grade = MAP_THEMES[0].grade,
  tier = POST.initialTier,
  autoQuality = true,
} = {}) {
  if (!POST.tiers[tier]) throw new RangeError(`Unknown post tier: ${tier}`);
  if (!validateGrade(grade)) throw new RangeError('Invalid map grade');

  const previousExposure = renderer.toneMappingExposure;
  const composer = new EffectComposer(renderer);
  const initialSize = renderer.getSize(new THREE.Vector2());
  const passes = new Map();
  const meter = createQualityMeter(tier);
  let width = initialSize.x;
  let height = initialSize.y;
  let devicePixelRatio = renderer.getPixelRatio();
  let pixelRatio = 1;
  let currentTier = null;
  let currentGrade = grade;
  let disposed = false;

  function makePass(name) {
    switch (name) {
      case 'render':
        return new RenderPass(scene, camera);
      case 'bloom':
        return new UnrealBloomPass(
          new THREE.Vector2(1, 1),
          currentGrade.bloom.strength,
          currentGrade.bloom.radius,
          currentGrade.bloom.threshold,
        );
      case 'ao': {
        const pass = new GTAOPass(scene, camera, 1, 1);
        pass.output = GTAOPass.OUTPUT.Default;
        pass.updateGtaoMaterial(POST.ao);
        return pass;
      }
      case 'fxaa': {
        const pass = new ShaderPass(FXAAShader);
        pass.setSize = (w, h) => {
          pass.uniforms.resolution.value.set(1 / w, 1 / h);
        };
        return pass;
      }
      case 'vignette':
        return new ShaderPass(VignetteShader);
      case 'saturation':
        return new ShaderPass(HueSaturationShader);
      case 'tint':
        return new ShaderPass(TintShader);
      case 'output':
        return new OutputPass();
      default:
        throw new RangeError(`Unknown post pass: ${name}`);
    }
  }

  function setGrade(nextGrade) {
    if (disposed) return;
    if (!validateGrade(nextGrade)) throw new RangeError('Invalid map grade');
    currentGrade = nextGrade;
    renderer.toneMappingExposure = nextGrade.exposure;

    const bloom = passes.get('bloom');
    if (bloom) Object.assign(bloom, nextGrade.bloom);
    const vignette = passes.get('vignette');
    if (vignette) {
      // VignetteShader's corner distance squared is 0.5 at offset=1.
      // This maps authored vignette directly to the corner attenuation.
      vignette.uniforms.offset.value = Math.sqrt(2 * nextGrade.vignette);
      vignette.uniforms.darkness.value = 1;
    }
    const saturation = passes.get('saturation');
    if (saturation) {
      saturation.uniforms.hue.value = 0;
      saturation.uniforms.saturation.value = nextGrade.saturation;
    }
    const tint = passes.get('tint');
    if (tint) {
      tint.uniforms.tint.value.set(...nextGrade.tint);
      tint.uniforms.contrast.value = nextGrade.contrast;
    }
  }

  function setSize(w, h, dpr = devicePixelRatio) {
    if (disposed) return;
    width = Math.max(1, Math.floor(Number.isFinite(w) ? w : 1));
    height = Math.max(1, Math.floor(Number.isFinite(h) ? h : 1));
    devicePixelRatio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    const settings = POST.tiers[currentTier];
    pixelRatio = Math.min(devicePixelRatio, settings.maxPixelRatio)
      * settings.resolutionScale;

    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    composer.setPixelRatio(pixelRatio);
    // Composer forwards physical dimensions to EVERY pass, including FXAA.
    composer.setSize(width, height);
  }

  function setTier(nextTier) {
    if (disposed || nextTier === currentTier) return;
    const settings = POST.tiers[nextTier];
    if (!settings) throw new RangeError(`Unknown post tier: ${nextTier}`);

    for (const [name, pass] of passes) {
      if (!settings.passes.includes(name)) {
        composer.removePass(pass);
        disposePass(pass);
        passes.delete(name);
      }
    }
    for (const name of settings.passes) {
      if (!passes.has(name)) passes.set(name, makePass(name));
    }

    composer.passes.length = 0;
    for (const name of settings.passes) composer.addPass(passes.get(name));
    currentTier = nextTier;
    meter.reset(nextTier);
    setGrade(currentGrade);
    setSize(width, height, devicePixelRatio);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const pass of passes.values()) disposePass(pass);
    passes.clear();
    composer.passes.length = 0;
    composer.dispose();
    renderer.toneMappingExposure = previousExposure;
  }

  try {
    setTier(tier);
  } catch (error) {
    dispose();
    throw error;
  }

  return {
    composer,
    setSize,
    setGrade,
    setTier,
    dispose,
    get tier() { return currentTier; },
    get pixelRatio() { return pixelRatio; },
    get passNames() { return [...POST.tiers[currentTier].passes]; },
    render(now = performance.now(), visible = true) {
      if (disposed) return;
      if (autoQuality) {
        const nextTier = meter.sample(now, visible);
        if (nextTier) setTier(nextTier);
      }
      if (visible) {
        // None of these passes require a simulation clock.
        composer.render(0);
      }
    },
  };
}
