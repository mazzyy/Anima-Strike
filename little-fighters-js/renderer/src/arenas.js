/**
 * Procedural stages. Each build owns one scene child and all resources beneath
 * it. No textures, external assets, browser APIs, or renderer are required.
 *
 * buildMap() and MAPS[n].build() return a callable disposer. It also exposes
 * .dispose() and .mapId for callers that prefer an object-style handle.
 *
 * Neon reflections are deliberately stylized, broken pools of signage colour,
 * not a second rendering of the scene.
 */

import * as THREE from 'three';
import { ARENA, BODY, MAP_ART, MAP_THEMES } from './config.js';

function fraction(value) {
  return value - Math.floor(value);
}

// Stable decoration without sharing or changing the game's random stream.
function noise(index) {
  return fraction(Math.sin(index * 127.1 + 311.7) * 43758.5453);
}

function createKit(root) {
  const geometries = new Map();
  const materials = new Map();

  function geometry(kind) {
    if (!geometries.has(kind)) {
      let result;
      if (kind === 'sphere') {
        result = new THREE.SphereGeometry(
          1, MAP_ART.radialSegments, MAP_ART.sphereRows,
        );
      } else if (kind === 'column') {
        result = new THREE.CylinderGeometry(
          1, 1, 1, MAP_ART.radialSegments,
        );
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
      : {
        color,
        roughness: MAP_ART.roughness,
        metalness: 0,
        ...options,
      };
    const key = JSON.stringify([basic, properties]);
    if (!materials.has(key)) {
      materials.set(key, basic
        ? new THREE.MeshBasicMaterial(properties)
        : new THREE.MeshStandardMaterial(properties));
    }
    return materials.get(key);
  }

  function mesh(kind, mat, x, y, z, sx, sy, sz) {
    const object = new THREE.Mesh(geometry(kind), mat);
    object.position.set(x, ARENA.floorY + y, z);
    object.scale.set(sx, sy, sz);
    object.castShadow = !mat.isMeshBasicMaterial && !mat.transparent;
    object.receiveShadow = !mat.isMeshBasicMaterial;
    root.add(object);
    return object;
  }

  function box(mat, x, y, z, width, height, depth) {
    return mesh('box', mat, x, y, z, width, height, depth);
  }

  function patch(mat, x, y, z, width, depth) {
    const object = mesh('plane', mat, x, y, z, width, depth, 1);
    object.rotation.x = -Math.PI / 2;
    return object;
  }

  function point(color, intensity, distance, x, y, z) {
    const light = new THREE.PointLight(color, intensity, distance);
    light.position.set(x, ARENA.floorY + y, z);
    root.add(light);
    return light;
  }

  function dispose() {
    for (const item of geometries.values()) item.dispose();
    for (const item of materials.values()) item.dispose();
    geometries.clear();
    materials.clear();
  }

  return { material, mesh, box, patch, point, dispose };
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
      light.position.y += ARENA.floorY;
      light.target.position.y = ARENA.floorY;
      root.add(light.target);

      if (spec.shadow) {
        light.castShadow = true;
        const settings = MAP_ART.shadow;
        light.shadow.mapSize.set(settings.size, settings.size);
        Object.assign(light.shadow.camera, {
          near: settings.near,
          far: settings.far,
          left: -settings.extent,
          right: settings.extent,
          top: settings.extent,
          bottom: -settings.extent,
        });
        light.shadow.bias = settings.bias;
      }
    }
    root.add(light);
  }
}

function addFloor(kit, theme) {
  const { floorSize, floorThickness } = MAP_ART;
  kit.box(
    kit.material(theme.floorColor, {
      roughness: theme.roughness,
      metalness: theme.metalness,
    }),
    0, -floorThickness / 2, 0,
    floorSize, floorThickness, floorSize,
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
  const count = Math.round(MAP_ART.floorSize / settings.tileSize);
  const size = MAP_ART.floorSize / count;
  const half = MAP_ART.floorSize / 2;
  const mats = settings.colors.map((color) => kit.material(color, {
    roughness: theme.roughness,
    metalness: theme.metalness,
  }));

  for (let x = 0; x < count; x++) {
    for (let z = 0; z < count; z++) {
      const mat = mats[Math.floor(noise(x * count + z) * mats.length)];
      kit.box(
        mat,
        -half + (x + 0.5) * size,
        -settings.thickness / 2,
        -half + (z + 0.5) * size,
        size - settings.gap, settings.thickness, size - settings.gap,
      );
    }
  }
}

function buildDojo(kit, theme) {
  const d = theme.decor;
  const half = MAP_ART.floorSize / 2;
  const wood = d.woodColors.map((color) => kit.material(color));
  const rows = Math.round(MAP_ART.floorSize / d.boardWidth);
  const width = MAP_ART.floorSize / rows;

  for (let row = 0; row < rows; row++) {
    const offset = (row % 2) * d.boardLength / 2;
    for (let start = -half - offset; start < half; start += d.boardLength) {
      const left = Math.max(-half, start);
      const right = Math.min(half, start + d.boardLength);
      kit.box(
        wood[(row + Math.floor((start + half + offset) / d.boardLength)) % wood.length],
        -half + (row + 0.5) * width,
        -d.boardThickness / 2,
        (left + right) / 2,
        width - d.boardGap,
        d.boardThickness,
        right - left - d.boardGap,
      );
    }
  }

  const frame = kit.material(d.frameColor);
  const paper = kit.material(d.paperColor, {
    emissive: d.paperColor,
    emissiveIntensity: d.paperGlow,
    roughness: 1,
  });

  for (const x of d.screenXs) {
    kit.box(
      paper, x, d.screenHeight / 2, d.screenZ,
      d.screenWidth, d.screenHeight, d.frameWidth,
    );
    for (let i = 0; i <= d.screenColumns; i++) {
      kit.box(
        frame,
        x - d.screenWidth / 2 + i * d.screenWidth / d.screenColumns,
        d.screenHeight / 2, d.screenZ + d.frameWidth,
        d.frameWidth, d.screenHeight, d.frameWidth,
      );
    }
    for (let i = 0; i <= d.screenRows; i++) {
      kit.box(
        frame, x, i * d.screenHeight / d.screenRows,
        d.screenZ + d.frameWidth,
        d.screenWidth, d.frameWidth, d.frameWidth,
      );
    }
  }

  const lantern = kit.material(d.lanternColor, {
    emissive: d.lanternColor,
    emissiveIntensity: d.lanternGlow,
  });
  for (const [x, y, z] of d.lanterns) {
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
    kit.point(d.lanternColor, d.lightIntensity, d.lightDistance, x, y, z);
  }
}

function buildStreet(kit, theme) {
  const d = theme.decor;
  const building = kit.material(d.buildingColor);
  const signBacking = kit.material(d.signBackingColor);

  d.signXs.forEach((x, index) => {
    const color = d.signColors[index % d.signColors.length];
    const neon = kit.material(color, {
      emissive: color,
      emissiveIntensity: d.signGlow,
      roughness: d.signRoughness,
    });

    kit.box(
      building, x, d.buildingHeight / 2, d.buildingZ,
      d.buildingWidth, d.buildingHeight, d.buildingDepth,
    );
    kit.box(
      signBacking, x, d.signY, d.signZ,
      d.signWidth, d.signHeight, d.signDepth,
    );

    // Lit borders and abstract, geometric lettering.
    for (const sign of [-1, 1]) {
      kit.box(
        neon, x, d.signY + sign * d.signHeight / 2, d.signZ + d.signDepth,
        d.signWidth, d.strokeWidth, d.strokeWidth,
      );
      kit.box(
        neon, x + sign * d.signWidth / 2, d.signY, d.signZ + d.signDepth,
        d.strokeWidth, d.signHeight, d.strokeWidth,
      );
    }
    for (let glyph = 0; glyph < d.glyphCount; glyph++) {
      const gx = x + (glyph - (d.glyphCount - 1) / 2) * d.glyphSpacing;
      kit.box(
        neon, gx, d.signY, d.signZ + d.signDepth,
        d.strokeWidth, d.glyphHeight, d.strokeWidth,
      );
      kit.box(
        neon, gx, d.signY + (glyph % 2 ? -1 : 1) * d.glyphHeight / 2,
        d.signZ + d.signDepth,
        d.glyphWidth, d.strokeWidth, d.strokeWidth,
      );
    }

    kit.point(
      color, d.lightIntensity, d.lightDistance,
      x, d.signY, d.signZ + d.lightOffset,
    );

    // Broken, widening reflection streaks lie just above the asphalt.
    for (let row = 0; row < d.reflectionRows; row++) {
      const t = row / d.reflectionRows;
      const ripple = noise(index * d.reflectionRows + row);
      const reflected = kit.material(color, {
        transparent: true,
        opacity: d.reflectionOpacity * (1 - t),
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }, true);
      kit.patch(
        reflected,
        x + (ripple - 0.5) * d.reflectionJitter,
        MAP_ART.surfaceLift,
        d.reflectionStartZ + t * d.reflectionLength,
        d.signWidth * (d.reflectionMinWidth + ripple * d.reflectionWidthRange),
        d.reflectionStripDepth,
      );
    }
  });

  const curb = kit.material(d.curbColor);
  for (const sign of [-1, 1]) {
    kit.box(
      curb, sign * d.curbX, d.curbHeight / 2, 0,
      d.curbWidth, d.curbHeight, MAP_ART.floorSize,
    );
  }

  const puddle = kit.material(d.puddleColor, {
    roughness: d.puddleRoughness,
    metalness: d.puddleMetalness,
    transparent: true,
    opacity: d.puddleOpacity,
    depthWrite: false,
  });
  for (let i = 0; i < d.puddles; i++) {
    const patch = kit.patch(
      puddle,
      (noise(i + 100) - 0.5) * d.puddleSpread,
      MAP_ART.surfaceLift / 2,
      (noise(i + 200) - 0.5) * d.puddleSpread,
      d.puddleWidth * (1 + noise(i + 300)),
      d.puddleDepth,
    );
    patch.rotation.z = noise(i + 400) * Math.PI;
  }
}

function buildTemple(kit, theme) {
  const d = theme.decor;
  addTiles(kit, theme, d);
  const stone = kit.material(d.pillarColor);
  const trim = kit.material(d.trimColor);

  for (const x of d.pillarXs) {
    for (const z of d.pillarZs) {
      kit.box(
        trim, x, d.baseHeight / 2, z,
        d.baseWidth, d.baseHeight, d.baseWidth,
      );
      kit.mesh(
        'column', stone, x, d.baseHeight + d.pillarHeight / 2, z,
        d.pillarRadius, d.pillarHeight, d.pillarRadius,
      );
      kit.box(
        trim, x, d.baseHeight + d.pillarHeight + d.capHeight / 2, z,
        d.baseWidth, d.capHeight, d.baseWidth,
      );
    }
  }

  for (let step = 0; step < d.steps; step++) {
    kit.box(
      trim, 0, d.stepHeight * (step + 1) / 2,
      d.stepsZ - step * d.stepDepth / 2,
      d.stepsWidth - step * d.stepInset,
      d.stepHeight * (step + 1),
      d.stepsDepth - step * d.stepDepth,
    );
  }
}

function buildRooftop(kit, theme) {
  const d = theme.decor;
  addTiles(kit, theme, d);
  const concrete = kit.material(d.parapetColor);

  kit.box(
    concrete, 0, d.parapetHeight / 2, -d.parapetOffset,
    MAP_ART.floorSize, d.parapetHeight, d.parapetWidth,
  );
  for (const sign of [-1, 1]) {
    kit.box(
      concrete, sign * d.parapetOffset, d.parapetHeight / 2, 0,
      d.parapetWidth, d.parapetHeight, MAP_ART.floorSize,
    );
  }

  const tower = kit.material(d.cityColor);
  const windows = d.windowColors.map((color) => kit.material(color, {}, true));
  for (let i = 0; i < d.towers; i++) {
    const x = (i - (d.towers - 1) / 2) * d.towerSpacing;
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
  }

  const equipment = kit.material(d.equipmentColor);
  const vent = kit.material(d.ventColor);
  for (const x of d.equipmentXs) {
    kit.box(
      equipment, x, d.equipmentHeight / 2, d.equipmentZ,
      d.equipmentWidth, d.equipmentHeight, d.equipmentDepth,
    );
    for (let i = 0; i < d.ventCount; i++) {
      kit.box(
        vent, x, (i + 1) * d.equipmentHeight / (d.ventCount + 1),
        d.equipmentZ + d.equipmentDepth / 2 + MAP_ART.surfaceLift,
        d.equipmentWidth * d.ventWidthScale, d.ventHeight,
        MAP_ART.surfaceLift,
      );
    }
  }
}

const BUILDERS = {
  dojo: buildDojo,
  'neon-street': buildStreet,
  'temple-courtyard': buildTemple,
  rooftop: buildRooftop,
};

function buildTheme(scene, theme) {
  const root = new THREE.Group();
  root.name = `arena:${theme.id}`;
  const kit = createKit(root);
  const previousBackground = scene.background;
  const previousFog = scene.fog;
  const background = new THREE.Color(theme.skyColor);
  const fog = new THREE.Fog(theme.fog.color, theme.fog.near, theme.fog.far);
  let disposed = false;

  function dispose() {
    if (disposed) return;
    disposed = true;
    root.removeFromParent();

    // Three's light disposal also releases any allocated shadow render target.
    root.traverse((object) => {
      if (object.isLight) object.dispose?.();
    });
    kit.dispose();
    root.clear();

    // Do not overwrite an environment another owner installed after this map.
    if (scene.background === background) scene.background = previousBackground;
    if (scene.fog === fog) scene.fog = previousFog;
  }

  dispose.dispose = dispose;
  dispose.mapId = theme.id;

  try {
    addLighting(root, theme);
    addFloor(kit, theme);
    BUILDERS[theme.id](kit, theme);
    addBoundary(kit, theme);
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
  fog: theme.fog,
  lights: theme.lights,
  build: (scene) => buildTheme(scene, theme),
}));

/** Unknown or omitted IDs select the first map. Dispose before replacing it. */
export function buildMap(scene, mapId) {
  const map = MAPS.find((candidate) => candidate.id === mapId) ?? MAPS[0];
  return map.build(scene);
}
