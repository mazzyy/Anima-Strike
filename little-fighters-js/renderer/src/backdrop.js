/**
 * Decorative, instanced depth layers. No renderer, DOM, textures or lights
 * are required.
 *
 * Parallax factors describe WORLD translation / camera X translation.
 * Background placement is absolute, not integrated, so resets cannot drift.
 *
 * Optional sources are synchronous, ownership-transferring factories:
 *   city()       -> CityGenerator Object3D or BufferGeometry
 *   skyscraper() -> SkyscraperGenerator Object3D or BufferGeometry
 *   forest()     -> ForestGenerator Object3D or BufferGeometry
 *   tree()       -> TreeGenerator Object3D or BufferGeometry
 *
 * Generator output is reduced to a bounded silhouette before instancing.
 * Never pass a live/shared game asset: returned geometry, materials and
 * material textures belong to this backdrop and are disposed with it.
 */
import * as THREE from 'three';
import { ARENA, BODY, BACKDROP } from './config.js';

function noise(index) {
  const value = Math.sin(index * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function geometryTriangles(geometry) {
  return (geometry.index?.count ?? geometry.attributes.position.count) / 3;
}

function fallbackProfile(kind) {
  // Normalized authored silhouettes, not per-instance meshes.
  switch (kind) {
    case 'mountain':
      return [
        [-0.5, 0], [-0.5, 0.18], [-0.34, 0.45], [-0.19, 0.35],
        [-0.04, 1], [0.13, 0.61], [0.24, 0.76], [0.5, 0.22], [0.5, 0],
      ];
    case 'roof':
      return [
        [-0.5, 0], [-0.5, 0.64], [-0.35, 0.72], [-0.08, 1],
        [0.08, 1], [0.35, 0.72], [0.5, 0.64], [0.5, 0],
      ];
    case 'forest':
      return [
        [-0.5, 0], [-0.5, 0.35], [-0.4, 0.75], [-0.3, 0.43],
        [-0.17, 1], [-0.04, 0.42], [0.08, 0.82], [0.2, 0.4],
        [0.34, 0.92], [0.5, 0.3], [0.5, 0],
      ];
    case 'tree':
      return [
        [-0.05, 0], [-0.05, 0.18], [-0.5, 0.18], [-0.23, 0.48],
        [-0.4, 0.48], [-0.15, 0.73], [-0.27, 0.73], [0, 1],
        [0.27, 0.73], [0.15, 0.73], [0.4, 0.48], [0.23, 0.48],
        [0.5, 0.18], [0.05, 0.18], [0.05, 0],
      ];
    case 'skyscraper':
      return [
        [-0.5, 0], [-0.5, 0.72], [-0.33, 0.72], [-0.33, 0.9],
        [-0.14, 0.9], [-0.14, 1], [0.14, 1], [0.14, 0.9],
        [0.33, 0.9], [0.33, 0.72], [0.5, 0.72], [0.5, 0],
      ];
    default:
      return [
        [-0.5, 0], [-0.5, 0.62], [-0.3, 0.62], [-0.3, 1],
        [-0.03, 1], [-0.03, 0.7], [0.18, 0.7], [0.18, 0.85],
        [0.5, 0.85], [0.5, 0],
      ];
  }
}

function extrudeProfile(points) {
  const shape = new THREE.Shape();
  points.forEach(([x, y], index) => {
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 1,
    steps: 1,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -0.5);
  // A single material/batch, including the extrusion's side faces.
  geometry.clearGroups();
  return geometry;
}

/**
 * Sample the upper envelope of projected triangles. Unlike a bounding box
 * or convex hull, this retains gaps and roof/canopy profiles. The sample
 * count bounds the resulting geometry regardless of generator complexity.
 */
function sourceProfile(parts) {
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();

  for (const { geometry, matrix } of parts) {
    const position = geometry.attributes.position;
    if (!position) continue;
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(matrix);
      bounds.expandByPoint(point);
    }
  }

  if (bounds.isEmpty()) return null;
  const width = bounds.max.x - bounds.min.x;
  const height = bounds.max.y - bounds.min.y;
  if (width <= Number.EPSILON || height <= Number.EPSILON) return null;

  const samples = BACKDROP.sourceSamples;
  const tops = new Float64Array(samples + 1).fill(bounds.min.y);
  const vertices = [
    new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(),
  ];

  for (const { geometry, matrix } of parts) {
    const position = geometry.attributes.position;
    if (!position) continue;
    const index = geometry.index;
    const count = index?.count ?? position.count;

    for (let offset = 0; offset + 2 < count; offset += 3) {
      for (let corner = 0; corner < 3; corner++) {
        const vertex = index ? index.getX(offset + corner) : offset + corner;
        vertices[corner].fromBufferAttribute(position, vertex).applyMatrix4(matrix);
      }

      const left = Math.min(...vertices.map((v) => v.x));
      const right = Math.max(...vertices.map((v) => v.x));
      const first = Math.max(0, Math.ceil((left - bounds.min.x) / width * samples));
      const last = Math.min(samples, Math.floor((right - bounds.min.x) / width * samples));

      for (let sample = first; sample <= last; sample++) {
        const x = bounds.min.x + sample / samples * width;
        for (let edge = 0; edge < 3; edge++) {
          const a = vertices[edge];
          const b = vertices[(edge + 1) % 3];
          const dx = b.x - a.x;
          if (Math.abs(dx) <= Number.EPSILON) {
            if (Math.abs(x - a.x) <= BACKDROP.sampleEpsilon) {
              tops[sample] = Math.max(tops[sample], a.y, b.y);
            }
            continue;
          }
          const t = (x - a.x) / dx;
          if (t >= 0 && t <= 1) {
            tops[sample] = Math.max(tops[sample], a.y + (b.y - a.y) * t);
          }
        }
      }
    }
  }

  const profile = [[-0.5, 0]];
  for (let i = 0; i <= samples; i++) {
    profile.push([
      i / samples - 0.5,
      Math.max(BACKDROP.minimumProfileHeight, (tops[i] - bounds.min.y) / height),
    ]);
  }
  profile.push([0.5, 0]);
  return profile;
}

function foregroundMaterial(foliage) {
  return new THREE.ShaderMaterial({
    uniforms: {
      color: { value: new THREE.Color(BACKDROP.foreground.color) },
      opacity: { value: BACKDROP.foreground.opacity },
      softness: { value: BACKDROP.foreground.softness },
      foliage: { value: foliage ? 1 : 0 },
    },
    transparent: true,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 p = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * p;
      }
    `,
    fragmentShader: `
      uniform vec3 color;
      uniform float opacity;
      uniform float softness;
      uniform float foliage;
      varying vec2 vUv;

      float ellipse(vec2 p, vec2 centre, vec2 radius) {
        float d = length((p - centre) / radius);
        return 1.0 - smoothstep(1.0 - softness, 1.0 + softness, d);
      }

      void main() {
        vec2 p = vUv;
        float column = 1.0 - smoothstep(
          0.25 - softness, 0.25 + softness, abs(p.x - 0.5)
        );
        float rail = 1.0 - smoothstep(
          0.035, 0.035 + softness, abs(p.y - 0.27)
        );
        float leaves = max(
          ellipse(p, vec2(0.44, 0.25), vec2(0.28, 0.31)),
          max(
            ellipse(p, vec2(0.59, 0.58), vec2(0.34, 0.29)),
            ellipse(p, vec2(0.37, 0.85), vec2(0.3, 0.26))
          )
        );
        float silhouette = mix(max(column, rail), leaves, foliage);
        vec2 edge = min(p, 1.0 - p);
        float feather = smoothstep(0.0, softness, edge.x)
                      * smoothstep(0.0, softness, edge.y);
        gl_FragColor = vec4(color, opacity * silhouette * feather);
        #include <colorspace_fragment>
      }
    `,
  });
}

/**
 * Returns { root, layers, stats, update(camera), dispose() }.
 * Sources are optional; local profiles keep missing vendors from breaking
 * map selection or headless operation.
 */
export function createBackdrop(scene, mapId, { sources = {} } = {}) {
  const theme = BACKDROP.maps[mapId] ?? BACKDROP.maps.dojo;
  const root = new THREE.Group();
  root.name = `backdrop:${mapId}`;
  root.userData.decoration = true;

  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const instances = new Set();
  const cache = new Map();
  const layers = [];
  const stats = { drawCalls: 0, triangles: 0 };
  const transform = new THREE.Object3D();
  const identity = new THREE.Matrix4();
  let foreground;
  let foregroundMesh;
  let disposed = false;

  function ownMaterial(material) {
    materials.add(material);
    for (const value of Object.values(material)) {
      if (value?.isTexture) textures.add(value);
    }
    for (const uniform of Object.values(material.uniforms ?? {})) {
      if (uniform.value?.isTexture) textures.add(uniform.value);
    }
    return material;
  }

  function collectSource(source) {
    const parts = [];
    if (source?.isBufferGeometry) {
      geometries.add(source);
      parts.push({ geometry: source, matrix: identity });
    } else if (source?.isObject3D) {
      source.updateMatrixWorld(true);
      source.traverse((object) => {
        if (object.geometry) geometries.add(object.geometry);
        if (object.material) {
          const list = Array.isArray(object.material) ? object.material : [object.material];
          list.forEach(ownMaterial);
        }
        if (object.isInstancedMesh) instances.add(object);
        if (!object.isMesh || !object.geometry?.attributes.position) return;

        if (object.isInstancedMesh) {
          const matrix = new THREE.Matrix4();
          for (let i = 0; i < object.count; i++) {
            object.getMatrixAt(i, matrix);
            parts.push({
              geometry: object.geometry,
              matrix: object.matrixWorld.clone().multiply(matrix),
            });
          }
        } else {
          parts.push({ geometry: object.geometry, matrix: object.matrixWorld.clone() });
        }
      });
    } else if (source != null) {
      throw new TypeError('Backdrop source factories must return an Object3D or BufferGeometry.');
    }
    return parts;
  }

  function geometry(kind) {
    if (cache.has(kind)) return cache.get(kind);
    const source = typeof sources[kind] === 'function' ? sources[kind]() : null;
    const profile = source ? sourceProfile(collectSource(source)) : null;
    const result = extrudeProfile(profile ?? fallbackProfile(kind));
    geometries.add(result);
    cache.set(kind, result);
    return result;
  }

  function basic(color) {
    return ownMaterial(new THREE.MeshBasicMaterial({
      color,
      // Aerial perspective is authored per layer, independent of warm map fog.
      fog: false,
      toneMapped: true,
    }));
  }

  function batch(parent, geo, material, placements, name) {
    const mesh = new THREE.InstancedMesh(geo, material, placements.length);
    mesh.name = name;
    mesh.userData.decoration = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    placements.forEach(({ position, scale }, index) => {
      transform.position.set(...position);
      transform.rotation.set(0, 0, 0);
      transform.scale.set(...scale);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    instances.add(mesh);
    parent.add(mesh);
    stats.drawCalls++;
    stats.triangles += geometryTriangles(geo) * mesh.count;
    return mesh;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    root.removeFromParent();
    for (const item of instances) item.dispose();
    for (const item of geometries) item.dispose();
    for (const item of materials) item.dispose();
    for (const item of textures) item.dispose();
    root.clear();
    instances.clear();
    geometries.clear();
    materials.clear();
    textures.clear();
    cache.clear();
  }

  try {
    const windowGeometry = new THREE.PlaneGeometry(1, 1);
    geometries.add(windowGeometry);

    BACKDROP.layers.forEach((spec, depthIndex) => {
      const layer = new THREE.Group();
      layer.name = `backdrop:${spec.name}`;
      layer.position.z = spec.z;
      layer.userData.parallax = spec.parallax;
      layer.userData.depth = -spec.z;
      root.add(layer);
      layers.push(layer);

      const color = new THREE.Color(theme.color)
        .lerp(new THREE.Color(BACKDROP.hazeColor), spec.blueMix)
        .multiplyScalar(spec.brightness);
      const kind = theme.kinds[depthIndex];
      const placements = [];
      const windows = [];
      const cell = spec.span / spec.count;

      for (let i = 0; i < spec.count; i++) {
        const seed = theme.seed + depthIndex * 1000 + i * 17;
        const x = -spec.span / 2 + (i + 0.5) * cell
          + (noise(seed) - 0.5) * cell * BACKDROP.jitter;
        const width = cell * (BACKDROP.widthMin + noise(seed + 1) * BACKDROP.widthRange);
        let height = spec.height
          * (BACKDROP.heightMin + noise(seed + 2) * BACKDROP.heightRange);

        // Lower central buildings and taller flanks establish a street canyon.
        if (mapId === 'neon-street') {
          height *= BACKDROP.canyon.base
            + Math.abs(x) / (spec.span / 2) * BACKDROP.canyon.flanks;
        }

        placements.push({
          position: [x, ARENA.floorY + spec.baseY, 0],
          scale: [width, height, spec.thickness],
        });

        if (!theme.windows || spec.windowRows === 0) continue;
        for (let row = 0; row < spec.windowRows; row++) {
          for (let column = 0; column < spec.windowColumns; column++) {
            if (noise(seed + row * 71 + column * 137) < BACKDROP.unlitFraction) continue;
            windows.push({
              position: [
                x + (column / Math.max(1, spec.windowColumns - 1) - 0.5)
                  * width * BACKDROP.windowSpread,
                ARENA.floorY + spec.baseY
                  + height * (BACKDROP.windowBottom
                    + row / spec.windowRows * BACKDROP.windowVerticalSpan),
                spec.thickness / 2 + BACKDROP.windowLift,
              ],
              scale: [
                width * BACKDROP.windowWidth,
                height / spec.windowRows * BACKDROP.windowHeight,
                1,
              ],
            });
          }
        }
      }

      batch(layer, geometry(kind), basic(color), placements, `${kind}:instances`);
      if (windows.length) {
        const windowColor = new THREE.Color(BACKDROP.windowColor)
          .lerp(new THREE.Color(BACKDROP.hazeColor), spec.blueMix)
          .multiplyScalar(spec.windowBrightness);
        batch(layer, windowGeometry, basic(windowColor), windows, 'windows:instances');
      }
    });

    foreground = new THREE.Group();
    foreground.name = 'backdrop:foreground';
    foreground.userData.parallax = BACKDROP.foreground.parallax;
    foreground.userData.foreground = true;
    root.add(foreground);
    layers.push(foreground);

    const plane = new THREE.PlaneGeometry(1, 1);
    geometries.add(plane);
    const material = ownMaterial(foregroundMaterial(mapId === 'temple-courtyard'));
    const parkedZ = ARENA.limitZ + BODY.radius + BACKDROP.clearance * 2;
    foregroundMesh = batch(foreground, plane, material, [-1, 1].map(() => ({
      position: [0, ARENA.floorY, parkedZ],
      scale: [1, 1, 1],
    })), 'foreground:instances');
    foregroundMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    foreground.visible = false;

    if (stats.drawCalls > BACKDROP.drawCallBudget || stats.triangles > BACKDROP.triangleBudget) {
      throw new RangeError('Backdrop exceeds its decoration budget.');
    }
    scene.add(root);
  } catch (error) {
    dispose();
    throw error;
  }

  const cameraPosition = new THREE.Vector3();
  const cameraRotation = new THREE.Quaternion();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const centre = new THREE.Vector3();
  const corner = new THREE.Vector3();
  const instanceMatrices = [new THREE.Matrix4(), new THREE.Matrix4()];

  function update(camera) {
    if (disposed || !camera?.isPerspectiveCamera) return;
    camera.updateMatrixWorld(true);
    camera.getWorldPosition(cameraPosition);
    camera.getWorldQuaternion(cameraRotation);

    const dx = cameraPosition.x - ARENA.camera.x;
    for (const layer of layers) {
      layer.position.x = layer.userData.parallax * dx;
    }

    const f = BACKDROP.foreground;
    const depth = camera.near * f.nearScale;
    const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.getEffectiveFOV()) / 2) * depth;
    const halfWidth = halfHeight * camera.aspect;
    right.set(1, 0, 0).applyQuaternion(cameraRotation);
    up.set(0, 1, 0).applyQuaternion(cameraRotation);
    forward.set(0, 0, -1).applyQuaternion(cameraRotation);

    let safe = true;
    const safeZ = ARENA.limitZ + BODY.radius + BACKDROP.clearance;
    [-1, 1].forEach((side, index) => {
      // Follow at the authored fraction until the edge guard takes priority.
      // Clamp the WHOLE quad, including its feather, not just its centre.
      const desired = side * f.edgeNdc - (1 - f.parallax) * dx / halfWidth;
      const ndcX = side * THREE.MathUtils.clamp(side * desired, f.minEdgeNdc, f.maxEdgeNdc);
      centre.copy(cameraPosition)
        .addScaledVector(forward, depth)
        .addScaledVector(right, ndcX * halfWidth);

      const width = halfWidth * f.widthNdc;
      const height = halfHeight * f.heightNdc;
      for (const x of [-0.5, 0.5]) {
        for (const y of [-0.5, 0.5]) {
          corner.copy(centre)
            .addScaledVector(right, width * x)
            .addScaledVector(up, height * y);
          if (corner.z <= safeZ) safe = false;
        }
      }

      transform.position.copy(centre);
      transform.position.x -= foreground.position.x;
      transform.quaternion.copy(cameraRotation);
      transform.scale.set(width, height, 1);
      transform.updateMatrix();
      instanceMatrices[index].copy(transform.matrix);
    });

    foreground.visible = safe;
    if (!safe) {
      // A camera close to the front boundary may have no safe space between
      // its near plane and the arena. Park (and hide) rather than clip through
      // a fighter or retain last frame's unsafe transforms.
      transform.position.set(
        -foreground.position.x, ARENA.floorY, safeZ + BACKDROP.clearance,
      );
      transform.rotation.set(0, 0, 0);
      transform.scale.set(1, 1, 1);
      transform.updateMatrix();
      instanceMatrices.forEach((matrix) => matrix.copy(transform.matrix));
    }

    instanceMatrices.forEach((matrix, index) => foregroundMesh.setMatrixAt(index, matrix));
    foregroundMesh.instanceMatrix.needsUpdate = true;
    foregroundMesh.computeBoundingBox();
    foregroundMesh.computeBoundingSphere();
    root.updateMatrixWorld(true);
  }

  return { root, layers, stats, update, dispose };
}
