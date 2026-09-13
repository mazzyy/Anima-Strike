/**
 * Arena-owned surface resources. Browser builds generate CanvasTextures;
 * headless builds use identical pixel data in DataTextures.
 *
 * No renderer, DOM, or game random stream is required to build a stage.
 * Artistic budgets derive from the existing MAP_ART configuration.
 */

import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import { ARENA, MAP_ART } from './config.js';

const noise = new ImprovedNoise();
const clamp = THREE.MathUtils.clamp;
const mix = THREE.MathUtils.lerp;

function powerOfTwo(value) {
  return 2 ** Math.floor(Math.log2(Math.max(2, value)));
}

export function reflectorResolution(tier) {
  if (tier === 'low') return 0;
  return powerOfTwo(MAP_ART.shadow.size / (tier === 'medium' ? 2 : 1));
}

function validateTier(tier) {
  if (!['low', 'medium', 'high'].includes(tier)) {
    throw new RangeError(`Unknown surface quality tier: ${tier}`);
  }
  return tier;
}

function randomGenerator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Periodic noise, including the derivatives at tile boundaries. */
function periodic(u, v, frequency, seed) {
  const x = u * frequency;
  const y = v * frequency;
  const sx = u * u * (3 - 2 * u);
  const sy = v * v * (3 - 2 * v);
  return mix(
    mix(noise.noise(x, y, seed), noise.noise(x - frequency, y, seed), sx),
    mix(
      noise.noise(x, y - frequency, seed),
      noise.noise(x - frequency, y - frequency, seed),
      sx,
    ),
    sy,
  );
}

function canvasFor(size, factory) {
  if (factory) return factory(size, size);
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    return canvas;
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(size, size);
  }
  return null;
}

function textureFromPixels(size, pixels, factory, color = false) {
  const canvas = canvasFor(size, factory);
  let texture;
  if (canvas) {
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('A 2D canvas context is required for surfaces.');
    const image = context.createImageData(size, size);
    image.data.set(pixels);
    context.putImageData(image, 0, 0);
    texture = new THREE.CanvasTexture(canvas);
  } else {
    texture = new THREE.DataTexture(
      new Uint8Array(pixels), size, size, THREE.RGBAFormat,
    );
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
  }
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

function surfaceKind(theme) {
  return {
    dojo: 'wood',
    'neon-street': 'asphalt',
    'temple-courtyard': 'stone',
    rooftop: 'concrete',
  }[theme.id];
}

function field(kind, u, v) {
  const broad = periodic(u, v, 5, 7);
  const fine = periodic(u, v, 71, 19);
  const medium = periodic(u, v, 19, 31);
  let height;
  let shade;
  let roughness;
  let moss = 0;

  if (kind === 'wood') {
    // Grain runs along the plank. A periodic oval knot bends the grain
    // instead of looking like a painted circle on top of straight lines.
    const dx = Math.sin(Math.PI * (u - 0.36)) * 1.8;
    const dy = Math.sin(Math.PI * (v - 0.54)) * 0.7;
    const knotDistance = Math.hypot(dx, dy);
    const knot = Math.exp(-knotDistance * knotDistance * 38);
    const grain = Math.sin(
      v * Math.PI * 48 + broad * 3 + knot * 15,
    );
    const rings = Math.sin(knotDistance * 110) * knot;
    height = grain * 0.05 + rings * 0.045 + fine * 0.018;
    shade = 0.78 + grain * 0.12 + rings * 0.09 + broad * 0.14 - knot * 0.22;
    roughness = 0.55 + fine * 0.17 - grain * 0.08 + knot * 0.12;
  } else if (kind === 'asphalt') {
    const aggregate = Math.abs(fine) + Math.abs(medium) * 0.4;
    // Periodic parallel polished tracks: low relief and low roughness.
    const track = Math.exp(-(Math.sin(v * Math.PI * 2) ** 2) * 32);
    height = aggregate * (0.19 - track * 0.12) + broad * 0.025;
    shade = 0.65 + aggregate * 0.8 + broad * 0.16 - track * 0.12;
    roughness = 0.43 + aggregate * 0.48 - track * 0.31;
  } else if (kind === 'stone') {
    const edge = Math.min(u, v, 1 - u, 1 - v);
    const joint = Math.exp(-edge * 75);
    moss = joint * clamp(0.55 + broad * 1.4 + medium, 0, 1);
    height = broad * 0.08 + fine * 0.05 - joint * 0.12;
    shade = 0.81 + broad * 0.27 + fine * 0.16 - joint * 0.3;
    roughness = 0.79 + fine * 0.18 + moss * 0.13;
  } else {
    const stain = clamp(broad * 2 + 0.2, 0, 1);
    const patch = THREE.MathUtils.smoothstep(
      periodic(u, v, 3, 53), 0.08, 0.22,
    );
    const streak = periodic(u, v, 12, 61)
      * (0.5 + 0.5 * Math.cos(u * Math.PI * 16));
    height = fine * 0.06 + medium * 0.025 + patch * 0.035;
    shade = 0.84 + fine * 0.15 - stain * 0.29 + patch * 0.13 + streak * 0.12;
    roughness = 0.81 + fine * 0.18 - stain * 0.19 - patch * 0.1;
  }
  return { height, shade: clamp(shade, 0.15, 1), roughness, moss };
}

/**
 * A triplet shares noise, UVs, dimensions, repeat, and lifetime. Materials
 * multiply these neutral maps by their existing authored palette colours.
 */
export function createSurfaceMaps(theme, { canvasFactory } = {}) {
  const size = powerOfTwo(MAP_ART.shadow.size / 4);
  const kind = surfaceKind(theme);
  const heights = new Float32Array(size * size);
  const albedo = new Uint8ClampedArray(size * size * 4);
  const normal = new Uint8ClampedArray(albedo.length);
  const rough = new Uint8ClampedArray(albedo.length);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = y * size + x;
      const result = field(kind, x / size, y / size);
      heights[index] = result.height;
      const shade = result.shade * 255;
      const moss = result.moss;
      albedo.set([
        shade * (1 - moss * 0.53),
        shade * (1 - moss * 0.15),
        shade * (1 - moss * 0.65),
        255,
      ], index * 4);
      const r = clamp(result.roughness, 0.04, 1) * 255;
      rough.set([r, r, r, 255], index * 4);
    }
  }

  const height = (x, y) => heights[
    ((y + size) % size) * size + (x + size) % size
  ];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // V runs opposite canvas Y. Encode tangent-space +Y accordingly.
      const dx = (height(x + 1, y) - height(x - 1, y)) * size / 2;
      const dy = (height(x, y + 1) - height(x, y - 1)) * size / 2;
      const length = Math.hypot(dx, dy, 1);
      normal.set([
        (-dx / length * 0.5 + 0.5) * 255,
        (dy / length * 0.5 + 0.5) * 255,
        (1 / length * 0.5 + 0.5) * 255,
        255,
      ], (y * size + x) * 4);
    }
  }

  const map = textureFromPixels(size, albedo, canvasFactory, true);
  const normalMap = textureFromPixels(size, normal, canvasFactory);
  const roughnessMap = textureFromPixels(size, rough, canvasFactory);
  const textures = [map, normalMap, roughnessMap];
  const repeat = kind === 'asphalt'
    ? new THREE.Vector2(
      MAP_ART.floorWidth / theme.decor.signSpacing,
      MAP_ART.floorDepth / theme.decor.signSpacing,
    )
    : new THREE.Vector2(1, 1);

  for (const texture of textures) {
    texture.repeat.copy(repeat);
    texture.name = `surface:${kind}:${texture === map
      ? 'albedo' : texture === normalMap ? 'normal' : 'roughness'}`;
  }

  let disposed = false;
  return {
    map,
    normalMap,
    roughnessMap,
    textures,
    // A scalar of one lets the full authored roughness field reach the shader.
    roughness: 1,
    normalScale: new THREE.Vector2(
      MAP_ART.detailVariation, MAP_ART.detailVariation,
    ),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const texture of textures) texture.dispose();
    },
  };
}

function detailPixels(kind, size) {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1);
      const v = y / (size - 1);
      const px = u * 2 - 1;
      const py = v * 2 - 1;
      const n = periodic(u, v, 23, 83);
      const radius = Math.hypot(px, py);
      let alpha = 0;
      let color = [47, 42, 36];

      if (kind === 'leaf') {
        const shape = px * px * 4 + py * py;
        alpha = clamp((1 - shape) * 9, 0, 1);
        const vein = Math.exp(-Math.abs(px) * 100);
        color = [116 + vein * 36, 83 + n * 40 + vein * 20, 31];
      } else if (kind === 'grit') {
        alpha = clamp((n - 0.12) * 7, 0, 1) * clamp(1 - radius, 0, 1);
        color = [120 + n * 70, 116 + n * 65, 110 + n * 60];
      } else if (kind === 'drain') {
        const inside = Math.max(Math.abs(px), Math.abs(py));
        const border = inside > 0.72;
        const bar = Math.abs(Math.sin(px * Math.PI * 6)) < 0.3;
        alpha = inside < 0.94 ? 1 : 0;
        const value = border || bar ? 82 + n * 28 : 13;
        color = [value, value * 1.04, value * 1.08];
      } else if (kind === 'crack') {
        const main = Math.abs(px - Math.sin(py * 8) * 0.16);
        const branch = Math.abs(px + py * 0.6 - 0.1 - Math.sin(py * 19) * 0.04);
        alpha = clamp(1 - Math.min(main, branch) * 55, 0, 1)
          * clamp((1 - radius) * 5, 0, 1);
      } else if (kind === 'scuff') {
        alpha = clamp(1 - radius, 0, 1)
          * Math.abs(Math.sin(py * 75 + n * 2)) ** 8;
        color = [30, 28, 27];
      } else if (kind === 'scorch') {
        alpha = clamp((1 - radius + n * 0.35) * 1.5, 0, 1);
        color = [19, 15, 13];
      } else {
        alpha = clamp((1 - radius + n * 0.6) * 0.6, 0, 0.6);
        color = [165 + n * 35, 157 + n * 35, 144 + n * 35];
      }
      // Transparent border prevents neighbouring repeated texels leaking in.
      if (x === 0 || y === 0 || x === size - 1 || y === size - 1) alpha = 0;
      pixels.set([...color, alpha * 255], (y * size + x) * 4);
    }
  }
  return pixels;
}

/**
 * Bounded ring buffer. Reusing a slot destroys its old geometry immediately.
 * Each slot owns a distinct physical height, not merely polygonOffset.
 */
export function createDecalPool({
  parent,
  receiver,
  materials,
  capacity = Math.max(1, Math.ceil(MAP_ART.maxPropLights * 8)),
}) {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new RangeError('Decal capacity must be a positive integer.');
  }

  const slots = [];
  let cursor = 0;
  let serial = 0;
  let disposed = false;

  return {
    capacity,
    get size() {
      return slots.length;
    },
    get oldestFirst() {
      return [...slots].sort((a, b) => a.userData.serial - b.userData.serial);
    },
    add(kind, position, size, angle = 0) {
      if (disposed) return null;
      const material = materials[kind];
      if (!material || !Number.isFinite(size) || size <= 0
          || !Number.isFinite(angle)
          || ![position.x, position.z].every(Number.isFinite)) return null;
      if (Math.abs(position.x) > MAP_ART.floorWidth / 2
          || Math.abs(position.z) > MAP_ART.floorDepth / 2) return null;

      receiver.updateMatrixWorld(true);
      const center = new THREE.Vector3(
        position.x, receiver.position.y, position.z,
      );
      const geometry = new DecalGeometry(
        receiver,
        center,
        new THREE.Euler(-Math.PI / 2, 0, angle),
        new THREE.Vector3(size, size, MAP_ART.deckSink * 2),
      );
      const slot = slots.length < capacity ? slots.length : cursor;
      geometry.translate(
        0, MAP_ART.surfaceLift * (6 + (slot + 1) / (capacity + 1)), 0,
      );

      let mesh = slots[slot];
      if (mesh) {
        mesh.geometry.dispose();
        mesh.geometry = geometry;
        mesh.material = material;
      } else {
        mesh = new THREE.Mesh(geometry, material);
        mesh.name = `surface:decal:${slot}`;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        slots.push(mesh);
        parent.add(mesh);
      }
      mesh.userData.serial = serial++;
      mesh.userData.kind = kind;
      cursor = (slot + 1) % capacity;
      return mesh;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const mesh of slots) {
        mesh.removeFromParent();
        mesh.geometry.dispose();
      }
      slots.length = 0;
    },
  };
}

function scatter(parent, receiver, materials, theme) {
  const geometry = receiver.geometry;
  const positions = geometry.getAttribute('position');
  const edgeWeights = [];
  const lineWeights = [];
  const cell = theme.decor.boardWidth
    ?? theme.decor.tileSize
    ?? theme.decor.curbWidth;

  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const edgeDistance = Math.min(
      MAP_ART.floorWidth / 2 - Math.abs(x),
      MAP_ART.floorDepth / 2 - Math.abs(z),
    );
    edgeWeights.push(Math.exp(-edgeDistance / cell));
    lineWeights.push(Math.exp(-Math.abs(z) / cell));
  }
  geometry.setAttribute('edge', new THREE.Float32BufferAttribute(edgeWeights, 1));
  geometry.setAttribute('line', new THREE.Float32BufferAttribute(lineWeights, 1));

  const random = randomGenerator(0x1f527);
  const edge = new MeshSurfaceSampler(receiver)
    .setWeightAttribute('edge').setRandomGenerator(random).build();
  const line = new MeshSurfaceSampler(receiver)
    .setWeightAttribute('line').setRandomGenerator(random).build();
  const kinds = ['leaf', 'grit', 'crack', 'drain', 'worn'];
  const perKind = Math.max(1, Math.ceil(MAP_ART.maxPropLights * 4));
  const total = perKind * kinds.length;
  const plane = new THREE.PlaneGeometry(1, 1);
  const objects = [];
  const transform = new THREE.Object3D();
  const point = new THREE.Vector3();
  let ordinal = 0;

  kinds.forEach((kind) => {
    // Drain covers belong to paved stages, not the wooden dojo.
    if (kind === 'drain' && theme.id === 'dojo') return;
    const count = kind === 'drain'
      ? Math.max(1, MAP_ART.maxPropLights)
      : perKind;
    const mesh = new THREE.InstancedMesh(plane, materials[kind], count);
    mesh.name = `surface:scatter:${kind}`;
    mesh.castShadow = false;
    mesh.receiveShadow = false;

    for (let i = 0; i < count; i++) {
      (kind === 'worn' || kind === 'crack' ? line : edge).sample(point);
      const inset = cell;
      point.x = clamp(
        point.x, -MAP_ART.floorWidth / 2 + inset,
        MAP_ART.floorWidth / 2 - inset,
      );
      point.z = clamp(
        point.z, -MAP_ART.floorDepth / 2 + inset,
        MAP_ART.floorDepth / 2 - inset,
      );
      transform.position.set(
        point.x,
        receiver.position.y
          + MAP_ART.surfaceLift * (4 + (++ordinal) / (total + 1)),
        point.z,
      );
      transform.rotation.set(-Math.PI / 2, 0, random() * Math.PI * 2);
      const size = cell * (0.5 + random());
      const scale = kind === 'leaf' || kind === 'grit' ? 0.35 : 1;
      transform.scale.set(size * scale, size * scale, 1);
      transform.updateMatrix();
      mesh.setMatrixAt(i, transform.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    parent.add(mesh);
    objects.push(mesh);
  });

  return () => {
    for (const object of objects) {
      object.removeFromParent();
      object.dispose();
    }
    plane.dispose();
  };
}

/**
 * Create before staging arena materials. install() adds only flat detail;
 * it does not replace or move the authored slab/planks/tiles.
 */
export function createSurfaces(root, theme, {
  quality = 'high',
  canvasFactory,
} = {}) {
  let tier = validateTier(quality);
  const maps = createSurfaceMaps(theme, { canvasFactory });
  const textures = new Set(maps.textures);
  const detailMaterials = {};
  const detailSize = powerOfTwo(MAP_ART.shadow.size / 8);

  for (const kind of ['leaf', 'grit', 'crack', 'drain', 'worn', 'scorch', 'scuff']) {
    const map = textureFromPixels(
      detailSize, detailPixels(kind, detailSize), canvasFactory, true,
    );
    map.name = `surface:detail:${kind}`;
    map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
    textures.add(map);
    detailMaterials[kind] = new THREE.MeshBasicMaterial({
      map,
      transparent: true,
      depthWrite: false,
      toneMapped: true,
    });
  }

  // Sampling/projection receiver is deliberately NOT added to the scene.
  // Only real decking is rendered; there is no coplanar invisible overlay.
  const segmentsX = Math.max(2, Math.ceil(MAP_ART.floorWidth));
  const segmentsZ = Math.max(2, Math.ceil(MAP_ART.floorDepth));
  const receiverGeometry = new THREE.PlaneGeometry(
    MAP_ART.floorWidth, MAP_ART.floorDepth, segmentsX, segmentsZ,
  );
  receiverGeometry.rotateX(-Math.PI / 2);
  const receiverMaterial = new THREE.MeshBasicMaterial();
  const receiver = new THREE.Mesh(receiverGeometry, receiverMaterial);
  receiver.position.y = ARENA.floorY
    - (theme.id === 'neon-street' ? MAP_ART.deckSink : 0);
  receiver.updateMatrixWorld(true);

  const decals = createDecalPool({
    parent: root,
    receiver,
    materials: detailMaterials,
  });
  let reflector = null;
  let removeScatter = null;
  let installed = false;
  let disposed = false;

  function removeReflector() {
    if (!reflector) return;
    reflector.removeFromParent();
    reflector.geometry.dispose();
    // Reflector.dispose owns both its material and offscreen render target.
    reflector.dispose();
    reflector = null;
  }

  function updateReflector() {
    removeReflector();
    const resolution = reflectorResolution(tier);
    if (!installed || theme.id !== 'neon-street' || !resolution) return;

    reflector = new Reflector(
      new THREE.PlaneGeometry(MAP_ART.floorWidth, MAP_ART.floorDepth),
      {
        textureWidth: resolution,
        textureHeight: resolution,
        color: 0x7f7f7f,
        // Avoid silently allocating the addon's default multisample target.
        multisample: 0,
        clipBias: MAP_ART.surfaceLift,
      },
    );
    reflector.name = 'surface:street-reflector';
    reflector.userData.resolution = resolution;
    reflector.rotation.x = -Math.PI / 2;
    reflector.position.y = receiver.position.y + MAP_ART.surfaceLift / 4;

    const material = reflector.material;
    material.transparent = true;
    material.depthWrite = false;
    material.uniforms.surfaceRoughness = { value: maps.roughnessMap };
    material.uniforms.surfaceRepeat = { value: maps.map.repeat.clone() };
    material.uniforms.surfaceOpacity = { value: theme.decor.puddleOpacity };
    material.vertexShader = `
      varying vec2 vSurfaceUv;
      ${material.vertexShader}
    `.replace(/void main\(\)\s*{/, 'void main() { vSurfaceUv = uv;');
    material.fragmentShader = `
      varying vec2 vSurfaceUv;
      uniform sampler2D surfaceRoughness;
      uniform vec2 surfaceRepeat;
      uniform float surfaceOpacity;
      ${material.fragmentShader}
    `.replace(/}\s*$/, `
      gl_FragColor.a = surfaceOpacity * (
        1.0 - texture2D(surfaceRoughness, vSurfaceUv * surfaceRepeat).g
      );
    }`);
    material.needsUpdate = true;
    root.add(reflector);
  }

  return {
    maps,
    textures,
    decals,
    get reflector() {
      return reflector;
    },
    get quality() {
      return tier;
    },
    materialProperties() {
      return {
        map: maps.map,
        normalMap: maps.normalMap,
        roughnessMap: maps.roughnessMap,
        normalScale: maps.normalScale,
        roughness: maps.roughness,
      };
    },
    install() {
      if (disposed || installed) return;
      installed = true;
      removeScatter = scatter(root, receiver, detailMaterials, theme);
      updateReflector();
    },
    setQuality(nextTier) {
      if (disposed) return;
      validateTier(nextTier);
      if (nextTier === tier) return;
      tier = nextTier;
      updateReflector();
    },
    /**
     * World X/Z; Y is projected onto the deck. Unknown kinds are harmless.
     * The caller chooses a world-space size appropriate to its impact.
     */
    addMark(kind, position, size, angle = 0) {
      if (disposed) return null;
      return decals.add(kind, position, size, angle);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      removeReflector();
      removeScatter?.();
      decals.dispose();
      receiverGeometry.dispose();
      receiverMaterial.dispose();
      for (const material of Object.values(detailMaterials)) material.dispose();
      maps.dispose();
      for (const texture of textures) {
        if (!maps.textures.includes(texture)) texture.dispose();
      }
      textures.clear();
    },
  };
}
