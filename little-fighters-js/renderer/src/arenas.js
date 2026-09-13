/**
 * Procedural stages. Each build owns one scene child and all its resources.
 * No external assets, browser APIs, or renderer are required.
 *
 * buildMap() and MAPS[n].build() return a callable disposer, also exposed as
 * .dispose(). Repeated geometry/material pairs become static instanced batches.
 * .update(dt, camera) places and advances the owned atmospheric sky.
 * .setQuality(tier) changes planar reflection quality without rebuilding.
 * .addMark(kind, position, size, angle) projects a persistent pooled mark.
 */

import * as THREE from 'three';
import { ARENA, BODY, MAP_ART } from './config.js';
import { MAP_THEMES } from './map-themes.js';
import { createSky } from './sky.js';
import { createSurfaces } from './surfaces.js';

function fraction(value) {
  return value - Math.floor(value);
}

// Stable decoration without changing the game's random stream.
function noise(index) {
  return fraction(Math.sin(index * 127.1 + 311.7) * 43758.5453);
}

/**
 * Distribute whole props across the width, never scale a prop to fill a cell.
 * Padding reserves half a prop at each end; jitter cannot accumulate.
 */
function repeatXs(spacing, padding = 0, seed = 0) {
  const span = Math.max(0, MAP_ART.floorWidth - padding * 2);
  const count = Math.max(1, Math.ceil(span / spacing));
  const cell = span / count;
  return Array.from({ length: count }, (_, index) => (
    -span / 2 + (index + 0.5) * cell
      + (noise(seed + index) - 0.5) * cell * MAP_ART.repeatJitter
  ));
}

function variation(seed) {
  return 1 + (noise(seed) - 0.5) * MAP_ART.detailVariation;
}

// Evenly distributed accent lights: geometry count must not multiply lights.
function hasAccentLight(index, count) {
  const lights = Math.min(count, MAP_ART.maxPropLights);
  for (let slot = 0; slot < lights; slot++) {
    if (index === Math.floor((slot + 0.5) * count / lights)) return true;
  }
  return false;
}

function createKit(root, surfaces) {
  const geometries = new Map();
  const materials = new Map();
  const batches = new Map();
  const instances = new Set();

  function geometry(kind) {
    if (!geometries.has(kind)) {
      let result;
      if (kind === 'sphere') {
        result = new THREE.SphereGeometry(
          1, MAP_ART.radialSegments, MAP_ART.sphereRows,
        );
      } else if (kind === 'column') {
        result = new THREE.CylinderGeometry(1, 1, 1, MAP_ART.radialSegments);
      } else if (kind === 'plane') {
        result = new THREE.PlaneGeometry(1, 1);
      } else {
        result = new THREE.BoxGeometry(1, 1, 1);
      }
      geometries.set(kind, result);
    }
    return geometries.get(kind);
  }

  function material(color, options = {}, basic = false) {
    const properties = basic
      ? { color, toneMapped: false, ...options }
      : { color, roughness: MAP_ART.roughness, metalness: 0, ...options };

    // Do not serialize textures: Texture.toJSON may serialize a canvas and
    // would also turn this small cache key into an entire image payload.
    const key = JSON.stringify([
      basic,
      Object.entries(properties).sort(([a], [b]) => a.localeCompare(b))
        .map(([name, value]) => [
          name,
          value?.isTexture ? value.uuid
            : value?.isVector2 ? value.toArray() : value,
        ]),
    ]);
    if (!materials.has(key)) {
      materials.set(key, basic
        ? new THREE.MeshBasicMaterial(properties)
        : new THREE.MeshStandardMaterial(properties));
    }
    return materials.get(key);
  }

  function surfaceMaterial(color, options = {}) {
    return material(color, {
      ...options,
      ...surfaces.materialProperties(),
    });
  }

  // Return a staging transform so callers can rotate before finalize().
  function mesh(kind, mat, x, y, z, sx, sy, sz) {
    if (!batches.has(mat)) batches.set(mat, new Map());
    const kinds = batches.get(mat);
    if (!kinds.has(kind)) kinds.set(kind, []);

    const transform = new THREE.Object3D();
    transform.position.set(x, ARENA.floorY + y, z);
    transform.scale.set(sx, sy, sz);
    kinds.get(kind).push(transform);
    return transform;
  }

  function box(mat, x, y, z, width, height, depth) {
    return mesh('box', mat, x, y, z, width, height, depth);
  }

  function patch(mat, x, y, z, width, depth) {
    const transform = mesh('plane', mat, x, y, z, width, depth, 1);
    transform.rotation.x = -Math.PI / 2;
    return transform;
  }

  function point(color, intensity, distance, x, y, z) {
    const light = new THREE.PointLight(color, intensity, distance);
    light.position.set(x, ARENA.floorY + y, z);
    root.add(light);
    return light;
  }

  function finalize() {
    for (const [mat, kinds] of batches) {
      for (const [kind, transforms] of kinds) {
        const geo = geometry(kind);
        let object;
        if (transforms.length > 1) {
          object = new THREE.InstancedMesh(geo, mat, transforms.length);
          instances.add(object);
          transforms.forEach((transform, index) => {
            transform.updateMatrix();
            object.setMatrixAt(index, transform.matrix);
          });
          object.instanceMatrix.needsUpdate = true;
          object.computeBoundingBox();
          object.computeBoundingSphere();
          object.name = `${kind}:instances`;
        } else {
          const [transform] = transforms;
          object = new THREE.Mesh(geo, mat);
          object.position.copy(transform.position);
          object.quaternion.copy(transform.quaternion);
          object.scale.copy(transform.scale);
        }
        object.castShadow = !mat.isMeshBasicMaterial && !mat.transparent;
        object.receiveShadow = !mat.isMeshBasicMaterial;
        root.add(object);
      }
    }
    batches.clear();
  }

  function dispose() {
    for (const item of instances) item.dispose();
    for (const item of geometries.values()) item.dispose();
    for (const item of materials.values()) item.dispose();
    instances.clear();
    geometries.clear();
    materials.clear();
    batches.clear();
  }

  return {
    material, surfaceMaterial, mesh, box, patch, point, finalize, dispose,
  };
}

function addLighting(root, theme) {
  for (const spec of theme.lights) {
    let light;
    if (spec.type === 'hemisphere') {
      light = new THREE.HemisphereLight(
        spec.color, spec.groundColor, spec.intensity,
      );
    } else {
      light = new THREE.DirectionalLight(spec.color, spec.intensity);
      light.position.set(...spec.position);

      if (spec.shadow) {
        const settings = MAP_ART.shadow;
        light.position.multiplyScalar(settings.lightDistanceScale);
        light.castShadow = true;
        light.shadow.mapSize.set(settings.size, settings.size);
        Object.assign(light.shadow.camera, {
          near: settings.near,
          far: settings.far,
          left: -settings.extent,
          right: settings.extent,
          top: settings.extent,
          bottom: -settings.extent,
        });
        light.shadow.camera.updateProjectionMatrix();
        light.shadow.bias = settings.bias;
      }

      light.position.y += ARENA.floorY;
      light.target.position.y = ARENA.floorY;
      root.add(light.target);
    }
    if (spec.role) {
      light.name = `arena:${spec.role}`;
      light.userData.role = spec.role;
    }
    root.add(light);
  }
}

function addFloor(kit, theme) {
  const { floorWidth, floorDepth, floorThickness, deckSink } = MAP_ART;
  // Slab top remains below the y=0 decking.
  kit.box(
    kit.surfaceMaterial(theme.floorColor, {
      metalness: theme.metalness,
    }),
    0, -deckSink - floorThickness / 2, 0,
    floorWidth, floorThickness, floorDepth,
  );
}

function addBoundary(kit, theme) {
  const mat = kit.material(theme.boundaryColor, {
    transparent: true,
    opacity: MAP_ART.boundaryOpacity,
    depthWrite: false,
  }, true);
  const x = ARENA.limitX + BODY.radius;
  const z = ARENA.limitZ + BODY.radius;
  const width = MAP_ART.boundaryWidth;
  const y = MAP_ART.surfaceLift * 3;

  for (const sign of [-1, 1]) {
    kit.patch(mat, 0, y, sign * z, x * 2, width);
    kit.patch(mat, sign * x, y, 0, width, z * 2);
  }
}

function addTiles(kit, theme, settings) {
  const countX = Math.max(1, Math.round(MAP_ART.floorWidth / settings.tileSize));
  const countZ = Math.max(1, Math.round(MAP_ART.floorDepth / settings.tileSize));
  const sizeX = MAP_ART.floorWidth / countX;
  const sizeZ = MAP_ART.floorDepth / countZ;
  const mats = settings.colors.map((color) => kit.surfaceMaterial(color, {
    metalness: theme.metalness,
  }));

  for (let x = 0; x < countX; x++) {
    for (let z = 0; z < countZ; z++) {
      const mat = mats[Math.floor(noise(x * countZ + z) * mats.length)];
      kit.box(
        mat,
        -MAP_ART.floorWidth / 2 + (x + 0.5) * sizeX,
        -settings.thickness / 2,
        -MAP_ART.floorDepth / 2 + (z + 0.5) * sizeZ,
        sizeX - settings.gap, settings.thickness, sizeZ - settings.gap,
      );
    }
  }
}

function buildDojo(kit, theme) {
  const d = theme.decor;
  const halfX = MAP_ART.floorWidth / 2;
  const wood = d.woodColors.map((color) => kit.surfaceMaterial(color));
  const rows = Math.max(1, Math.round(MAP_ART.floorDepth / d.boardWidth));
  const width = MAP_ART.floorDepth / rows;

  // Planks retain authored lengths, alternating seams, and clipped ends.
  for (let row = 0; row < rows; row++) {
    const offset = (row % 2) * d.boardLength / 2;
    let column = 0;
    for (let start = -halfX - offset; start < halfX; start += d.boardLength) {
      const left = Math.max(-halfX, start);
      const right = Math.min(halfX, start + d.boardLength);
      const mat = wood[Math.floor(noise(row * 1000 + column++) * wood.length)];
      kit.box(
        mat,
        (left + right) / 2,
        -d.boardThickness / 2,
        -MAP_ART.floorDepth / 2 + (row + 0.5) * width,
        right - left - d.boardGap,
        d.boardThickness,
        width - d.boardGap,
      );
    }
  }

  const frame = kit.material(d.frameColor);
  const paper = kit.material(d.paperColor, {
    emissive: d.paperColor,
    emissiveIntensity: d.paperGlow,
    roughness: 1,
  });

  repeatXs(d.screenSpacing, 0, 100).forEach((x, index) => {
    const height = d.screenHeight * variation(index + 150);
    kit.box(
      paper, x, height / 2, d.screenZ,
      d.screenWidth, height, d.frameWidth,
    );
    for (let i = 0; i <= d.screenColumns; i++) {
      kit.box(
        frame,
        x - d.screenWidth / 2 + i * d.screenWidth / d.screenColumns,
        height / 2, d.screenZ + d.frameWidth,
        d.frameWidth, height, d.frameWidth,
      );
    }
    for (let i = 0; i <= d.screenRows; i++) {
      kit.box(
        frame, x, i * height / d.screenRows,
        d.screenZ + d.frameWidth,
        d.screenWidth, d.frameWidth, d.frameWidth,
      );
    }
  });

  const lantern = kit.material(d.lanternColor, {
    emissive: d.lanternColor,
    emissiveIntensity: d.lanternGlow,
  });
  const lanternXs = repeatXs(d.lanternSpacing, d.lanternRadius, 200);
  lanternXs.forEach((x, index) => {
    const y = d.lanternY * variation(index + 250);
    const z = d.lanternZ;
    kit.box(
      frame, x, y + d.lanternRadius + d.cordLength / 2, z,
      d.cordWidth, d.cordLength, d.cordWidth,
    );
    kit.mesh(
      'sphere', lantern, x, y, z,
      d.lanternRadius, d.lanternRadius, d.lanternRadius,
    );
    for (const sign of [-1, 1]) {
      kit.mesh(
        'column', frame, x, y + sign * d.lanternRadius, z,
        d.lanternRadius * d.capScale, d.capHeight,
        d.lanternRadius * d.capScale,
      );
    }
    if (hasAccentLight(index, lanternXs.length)) {
      kit.point(d.lanternColor, d.lightIntensity, d.lightDistance, x, y, z);
    }
  });
}

function buildStreet(kit, theme) {
  const d = theme.decor;
  const building = kit.material(d.buildingColor);
  const signBacking = kit.material(d.signBackingColor);
  const signXs = repeatXs(d.signSpacing, 0, 300);

  signXs.forEach((x, index) => {
    const color = d.signColors[Math.floor(noise(index + 350) * d.signColors.length)];
    const neon = kit.material(color, {
      emissive: color,
      emissiveIntensity: d.signGlow,
      roughness: d.signRoughness,
    });
    const height = d.buildingHeight * variation(index + 400);
    const signY = d.signY * variation(index + 450);

    kit.box(
      building, x, height / 2, d.buildingZ,
      d.buildingWidth, height, d.buildingDepth,
    );
    kit.box(
      signBacking, x, signY, d.signZ,
      d.signWidth, d.signHeight, d.signDepth,
    );

    for (const sign of [-1, 1]) {
      kit.box(
        neon, x, signY + sign * d.signHeight / 2, d.signZ + d.signDepth,
        d.signWidth, d.strokeWidth, d.strokeWidth,
      );
      kit.box(
        neon, x + sign * d.signWidth / 2, signY, d.signZ + d.signDepth,
        d.strokeWidth, d.signHeight, d.strokeWidth,
      );
    }
    for (let glyph = 0; glyph < d.glyphCount; glyph++) {
      const gx = x + (glyph - (d.glyphCount - 1) / 2) * d.glyphSpacing;
      const up = noise(index * d.glyphCount + glyph + 500) > 0.5 ? 1 : -1;
      kit.box(
        neon, gx, signY, d.signZ + d.signDepth,
        d.strokeWidth, d.glyphHeight, d.strokeWidth,
      );
      kit.box(
        neon, gx, signY + up * d.glyphHeight / 2, d.signZ + d.signDepth,
        d.glyphWidth, d.strokeWidth, d.strokeWidth,
      );
    }

    if (hasAccentLight(index, signXs.length)) {
      kit.point(
        color, d.lightIntensity, d.lightDistance,
        x, signY, d.signZ + d.lightOffset,
      );
    }
  });

  const curb = kit.material(d.curbColor);
  for (const sign of [-1, 1]) {
    kit.box(
      curb, sign * (MAP_ART.floorWidth / 2 - d.curbWidth / 2),
      d.curbHeight / 2, 0,
      d.curbWidth, d.curbHeight, MAP_ART.floorDepth,
    );
  }
  repeatXs(d.curbLength, 0, 550).forEach((x, index) => {
    const height = d.curbHeight * variation(index + 600);
    kit.box(
      curb, x, height / 2, -MAP_ART.floorDepth / 2,
      d.curbLength - d.curbGap, height, d.curbWidth,
    );
  });

  // Real reflection replaces the additive sign strips and flat puddle boxes.
  // Low quality retains the wet normal/roughness response, without a reflector.
}

function buildTemple(kit, theme) {
  const d = theme.decor;
  addTiles(kit, theme, d);
  const stone = kit.material(d.pillarColor);
  const trim = kit.material(d.trimColor);

  function pillar(x, z, seed) {
    const height = d.pillarHeight * variation(seed);
    kit.box(
      trim, x, d.baseHeight / 2, z,
      d.baseWidth, d.baseHeight, d.baseWidth,
    );
    kit.mesh(
      'column', stone, x, d.baseHeight + height / 2, z,
      d.pillarRadius, height, d.pillarRadius,
    );
    kit.box(
      trim, x, d.baseHeight + height + d.capHeight / 2, z,
      d.baseWidth, d.capHeight, d.baseWidth,
    );
  }

  repeatXs(d.pillarSpacing, d.baseWidth / 2, 1100).forEach((x, index) => {
    pillar(x, d.pillarZ, index + 1150);
  });
  for (const sign of [-1, 1]) {
    d.sidePillarZs.forEach((z, index) => {
      pillar(
        sign * (MAP_ART.floorWidth / 2 + d.baseWidth / 2),
        z, index + (sign + 1) * 100 + 1200,
      );
    });
  }

  repeatXs(d.stepsSpacing, 0, 1300).forEach((x, index) => {
    const z = d.stepsZ - noise(index + 1350) * d.stepDepth;
    for (let step = 0; step < d.steps; step++) {
      kit.box(
        trim, x, d.stepHeight * (step + 1) / 2,
        z - step * d.stepDepth / 2,
        d.stepsWidth - step * d.stepInset,
        d.stepHeight * (step + 1),
        d.stepsDepth - step * d.stepDepth,
      );
    }
  });
}

function buildRooftop(kit, theme) {
  const d = theme.decor;
  addTiles(kit, theme, d);
  const concrete = kit.material(d.parapetColor);

  kit.box(
    concrete, 0, d.parapetHeight / 2,
    -MAP_ART.floorDepth / 2 + d.parapetInset,
    MAP_ART.floorWidth, d.parapetHeight, d.parapetWidth,
  );
  for (const sign of [-1, 1]) {
    kit.box(
      concrete, sign * (MAP_ART.floorWidth / 2 - d.parapetInset),
      d.parapetHeight / 2, 0,
      d.parapetWidth, d.parapetHeight, MAP_ART.floorDepth,
    );
  }

  const tower = kit.material(d.cityColor);
  const windows = d.windowColors.map((color) => kit.material(color, {}, true));
  repeatXs(d.towerSpacing, 0, 1400).forEach((x, i) => {
    const height = d.towerMinHeight + noise(i) * d.towerHeightRange;
    const z = d.cityZ - noise(i + 50) * d.cityDepth;
    kit.box(
      tower, x, d.cityBaseY + height / 2, z,
      d.towerWidth, height, d.towerDepth,
    );

    const rows = Math.floor(height / d.windowSpacingY);
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < d.windowColumns; column++) {
        const seed = i * 1000 + row * d.windowColumns + column;
        if (noise(seed) < d.unlitFraction) continue;
        kit.box(
          windows[(i + row + column) % windows.length],
          x + (column - (d.windowColumns - 1) / 2) * d.windowSpacingX,
          d.cityBaseY + (row + 0.5) * d.windowSpacingY,
          z + d.towerDepth / 2 + MAP_ART.surfaceLift,
          d.windowWidth, d.windowHeight, MAP_ART.surfaceLift,
        );
      }
    }
  });

  const equipment = kit.material(d.equipmentColor);
  const vent = kit.material(d.ventColor);
  repeatXs(d.equipmentSpacing, d.equipmentWidth / 2, 1500).forEach((x, index) => {
    const height = d.equipmentHeight * variation(index + 1550);
    kit.box(
      equipment, x, height / 2, d.equipmentZ,
      d.equipmentWidth, height, d.equipmentDepth,
    );
    for (let i = 0; i < d.ventCount; i++) {
      kit.box(
        vent, x, (i + 1) * height / (d.ventCount + 1),
        d.equipmentZ + d.equipmentDepth / 2 + MAP_ART.surfaceLift,
        d.equipmentWidth * d.ventWidthScale, d.ventHeight,
        MAP_ART.surfaceLift,
      );
    }
  });
}

const BUILDERS = {
  dojo: buildDojo,
  'neon-street': buildStreet,
  'temple-courtyard': buildTemple,
  rooftop: buildRooftop,
};

function buildTheme(scene, theme, options = {}) {
  const root = new THREE.Group();
  root.name = `arena:${theme.id}`;
  const previousBackground = scene.background;
  const previousFog = scene.fog;
  const background = new THREE.Color(theme.skyColor);
  const fog = new THREE.Fog(theme.fog.color, theme.fog.near, theme.fog.far);
  let sky = null;
  let surfaces = null;
  let kit = null;
  let disposed = false;

  function dispose() {
    if (disposed) return;
    disposed = true;
    root.removeFromParent();
    sky?.dispose();
    surfaces?.dispose();

    root.traverse((object) => {
      if (object.isLight) object.dispose?.();
    });
    kit?.dispose();
    root.clear();

    if (scene.background === background) scene.background = previousBackground;
    if (scene.fog === fog) scene.fog = previousFog;
  }

  dispose.dispose = dispose;
  dispose.mapId = theme.id;
  dispose.grade = theme.grade;
  dispose.update = (dt, camera) => {
    if (!disposed) sky?.update(dt, camera);
  };
  dispose.setQuality = (tier) => {
    if (!disposed) surfaces?.setQuality(tier);
  };
  dispose.addMark = (kind, position, size, angle = 0) => (
    disposed ? null : surfaces?.addMark(kind, position, size, angle)
  );
  Object.defineProperty(dispose, 'surfaces', {
    get: () => disposed ? null : surfaces,
  });

  try {
    surfaces = createSurfaces(root, theme, options);
    kit = createKit(root, surfaces);
    sky = createSky(root, theme);
    addLighting(root, theme);
    addFloor(kit, theme);
    BUILDERS[theme.id](kit, theme);
    addBoundary(kit, theme);
    kit.finalize();
    surfaces.install();
    scene.add(root);
    scene.background = background;
    scene.fog = fog;
  } catch (error) {
    dispose();
    throw error;
  }

  return dispose;
}

export const MAPS = MAP_THEMES.map((theme) => ({
  id: theme.id,
  name: theme.name,
  floorColor: theme.floorColor,
  skyColor: theme.skyColor,
  sky: theme.sky,
  fog: theme.fog,
  lights: theme.lights,
  grade: theme.grade,
  build: (scene, options) => buildTheme(scene, theme, options),
}));

/** Unknown or omitted IDs select the first map. Dispose before replacing it. */
export function buildMap(scene, mapId, options) {
  const map = MAPS.find((candidate) => candidate.id === mapId) ?? MAPS[0];
  return map.build(scene, options);
}
