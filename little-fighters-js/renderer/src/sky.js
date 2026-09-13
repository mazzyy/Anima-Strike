/**
 * Camera-centred stage skies. No browser APIs, asset loading, PMREM, or
 * render targets are needed. All generated textures have explicit ownership.
 *
 * Coordinates: elevation is degrees above the horizon; azimuth runs from +Z
 * towards +X. The sun direction points TOWARDS the light, not along its rays.
 */
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import {
  Lensflare, LensflareElement,
} from 'three/addons/objects/Lensflare.js';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';

const LIMITS = {
  elevation: [-90, 90],
  azimuth: [0, 360],
  turbidity: [0, 20],
  rayleigh: [0, 4],
  mieCoefficient: [0, 0.1],
  mieDirectionalG: [0, 1],
};

export function validateSkySpec(spec) {
  if (!spec || typeof spec !== 'object') {
    throw new TypeError('A complete sky specification is required');
  }
  for (const [field, [min, max]] of Object.entries(LIMITS)) {
    const value = spec[field];
    if (!Number.isFinite(value) || value < min || value > max
      || (field === 'mieDirectionalG' && value === 1)) {
      throw new RangeError(`Invalid sky.${field}: ${value}`);
    }
  }
  return true;
}

export function getSunDirection(spec, target = new THREE.Vector3()) {
  const elevation = THREE.MathUtils.degToRad(spec.elevation);
  const azimuth = THREE.MathUtils.degToRad(spec.azimuth);
  return target.set(
    Math.cos(elevation) * Math.sin(azimuth),
    Math.sin(elevation),
    Math.cos(elevation) * Math.cos(azimuth),
  ).normalize();
}

// End of nautical twilight. Blue hour still uses the atmospheric shader.
export function isNightSky(spec) {
  return spec.elevation <= -12;
}

/**
 * Approximate RGB atmospheric transmittance using optical air mass.
 * The spectral coefficients are in red/green/blue order; blue extinguishes
 * fastest as the sun approaches the horizon. Colours are linear until getHex.
 */
export function getSunLight(spec, distance = 1) {
  validateSkySpec(spec);
  const direction = getSunDirection(spec);
  const elevation = Math.max(0, spec.elevation);
  const airMass = 1 / (
    Math.max(0, direction.y) + 0.15 * (elevation + 3.885) ** -1.253
  );
  const transmission = [0.0058, 0.0135, 0.0331].map((coefficient, index) => (
    Math.exp(-airMass * (
      coefficient * spec.rayleigh
      + spec.mieCoefficient * spec.turbidity * (1 + index * 0.1)
    ))
  ));
  const peak = Math.max(...transmission);
  const color = new THREE.Color().setRGB(
    transmission[0] / peak,
    transmission[1] / peak,
    transmission[2] / peak,
  );
  const aboveHorizon = spec.elevation > 0;

  return {
    type: 'directional',
    role: 'key',
    direction: direction.toArray(),
    position: direction.multiplyScalar(distance).toArray(),
    color: color.getHex(),
    intensity: aboveHorizon
      ? Math.PI * Math.max(0, Math.sin(
        THREE.MathUtils.degToRad(spec.elevation),
      )) ** 0.25 * peak
      : 0,
    shadow: aboveHorizon,
  };
}

const domeVertex = `
  varying float vHeight;
  void main() {
    vHeight = normalize(position).y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const nightFragment = `
  uniform vec3 zenithColor;
  uniform vec3 horizonColor;
  varying float vHeight;
  void main() {
    float height = smoothstep(0.0, 0.85, max(vHeight, 0.0));
    gl_FragColor = vec4(mix(horizonColor, zenithColor, height), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const hazeFragment = `
  uniform vec3 hazeColor;
  varying float vHeight;
  void main() {
    float alpha = exp(-pow(abs(vHeight) / 0.09, 2.0));
    gl_FragColor = vec4(hazeColor, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const cloudVertex = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const cloudFragment = `
  uniform sampler2D noiseMap;
  uniform vec2 offset;
  uniform vec3 cloudColor;
  uniform float opacity;
  varying vec2 vUv;
  void main() {
    float edge = max(abs(vUv.x - 0.5), abs(vUv.y - 0.5));
    float fade = 1.0 - smoothstep(0.25, 0.5, edge);
    float density = texture2D(noiseMap, vUv * 3.0 + offset).a;
    gl_FragColor = vec4(cloudColor, density * fade * opacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const starVertex = `
  attribute float brightness;
  varying float vBrightness;
  void main() {
    vBrightness = brightness;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = 1.0 + 2.0 * brightness;
  }
`;

const starFragment = `
  varying float vBrightness;
  void main() {
    float radius = length(gl_PointCoord - vec2(0.5));
    float alpha = (1.0 - smoothstep(0.1, 0.5, radius)) * vBrightness;
    gl_FragColor = vec4(vec3(0.72, 0.83, 1.0), alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function fraction(value) {
  return value - Math.floor(value);
}

function randomAt(index) {
  return fraction(Math.sin(index * 127.1 + 311.7) * 43758.5453);
}

function cloudTexture() {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  const noise = new ImprovedNoise();

  // Blend opposite sides of each octave: scrolling across RepeatWrapping
  // has no discontinuity. This does not use the game's random stream.
  function periodic(u, v, frequency, z) {
    const x = u * frequency;
    const y = v * frequency;
    return THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(
        noise.noise(x, y, z),
        noise.noise(x - frequency, y, z),
        u,
      ),
      THREE.MathUtils.lerp(
        noise.noise(x, y - frequency, z),
        noise.noise(x - frequency, y - frequency, z),
        u,
      ),
      v,
    );
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      let weight = 0;
      for (let octave = 0; octave < 4; octave++) {
        const amplitude = 2 ** -octave;
        sum += periodic(
          x / size, y / size, 4 * 2 ** octave, 17 + octave * 13,
        ) * amplitude;
        weight += amplitude;
      }
      const density = 0.5 + sum / weight;
      const index = (y * size + x) * 4;
      data[index] = data[index + 1] = data[index + 2] = 255;
      data[index + 3] = Math.round(
        255 * THREE.MathUtils.smoothstep(density, 0.38, 0.68),
      );
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = 'sky:cloud-noise';
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function flareTexture(ghost) {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const radius = Math.hypot(
        (x + 0.5) / size * 2 - 1,
        (y + 0.5) / size * 2 - 1,
      );
      const alpha = ghost
        ? Math.exp(-(((radius - 0.58) / 0.12) ** 2)) * 0.25
        : Math.exp(-radius * radius * 9)
          * (1 - THREE.MathUtils.smoothstep(radius, 0.7, 1));
      const index = (y * size + x) * 4;
      data[index] = data[index + 1] = data[index + 2] = 255;
      data[index + 3] = Math.round(alpha * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = ghost ? 'sky:flare-ring' : 'sky:flare-glow';
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function starGeometry() {
  const count = 1024;
  const positions = new Float32Array(count * 3);
  const brightness = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    // Uniform solid-angle distribution over the upper hemisphere.
    const height = 0.02 + randomAt(i * 3) * 0.98;
    const azimuth = randomAt(i * 3 + 1) * Math.PI * 2;
    const radius = Math.sqrt(1 - height * height);
    positions.set([
      radius * Math.sin(azimuth) * 0.94,
      height * 0.94,
      radius * Math.cos(azimuth) * 0.94,
    ], i * 3);
    brightness[i] = 0.2 + randomAt(i * 3 + 2) ** 3 * 0.8;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('brightness', new THREE.BufferAttribute(brightness, 1));
  return geometry;
}

/**
 * The parent owns the returned controller. update() uses the final render
 * camera; dt is seconds and may be zero for a resize or initial placement.
 */
export function createSky(parent, theme) {
  validateSkySpec(theme.sky);

  const root = new THREE.Group();
  root.name = `sky:${theme.id}`;
  root.scale.setScalar(theme.fog.far);
  const resources = {
    geometries: new Set(),
    materials: new Set(),
    textures: new Set(),
  };
  const sunDirection = getSunDirection(theme.sky);
  const night = isNightSky(theme.sky);
  const sunLight = getSunLight(theme.sky);
  const fogColor = new THREE.Color(theme.fog.color);
  const cameraPosition = new THREE.Vector3();
  const projectedSun = new THREE.Vector3();
  let atmosphere = null;
  let stars = null;
  let clouds = null;
  let haze = null;
  let flare = null;
  let disposed = false;

  // Lensflare also disposes its element textures. Removing resources on their
  // disposal event avoids double disposal while retaining exception cleanup.
  function own(kind, resource) {
    const set = resources[kind];
    set.add(resource);
    function released() {
      set.delete(resource);
      resource.removeEventListener('dispose', released);
    }
    resource.addEventListener('dispose', released);
    return resource;
  }

  function mesh(name, geometry, material, order) {
    const object = new THREE.Mesh(geometry, own('materials', material));
    object.name = name;
    object.renderOrder = order;
    root.add(object);
    return object;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    root.removeFromParent();
    // Includes the addon's private framebuffer-copy/occlusion textures.
    // Lensflare's shared static geometry belongs to the addon, not this sky.
    flare?.dispose();
    for (const resource of [...resources.textures]) resource.dispose();
    for (const resource of [...resources.materials]) resource.dispose();
    for (const resource of [...resources.geometries]) resource.dispose();
    root.clear();
  }

  function update(dt, camera) {
    if (disposed || !camera) return;
    if (Number.isFinite(dt) && dt > 0) {
      const offset = clouds.material.uniforms.offset.value;
      offset.x = (offset.x + dt / 1800) % 1;
      offset.y = (offset.y + dt / 4500) % 1;
    }

    camera.updateWorldMatrix(true, false);
    camera.getWorldPosition(cameraPosition);
    root.position.copy(cameraPosition);
    // The cube's furthest corner remains inside the camera's far plane.
    // Camera-relative placement removes translation parallax and horizon bob.
    root.scale.setScalar(camera.far * 0.45);
    root.updateWorldMatrix(true, true);

    if (flare) {
      flare.getWorldPosition(projectedSun);
      projectedSun.project(camera);
      flare.visible = theme.sky.elevation > 0
        && Number.isFinite(projectedSun.x)
        && Number.isFinite(projectedSun.y)
        && projectedSun.z >= -1 && projectedSun.z <= 1
        && Math.abs(projectedSun.x) < 1
        && Math.abs(projectedSun.y) < 1;
    }
  }

  try {
    const dome = own(
      'geometries', new THREE.SphereGeometry(1, 48, 24),
    );

    if (night) {
      atmosphere = mesh('sky:night-dome', dome, new THREE.ShaderMaterial({
        uniforms: {
          zenithColor: { value: new THREE.Color(theme.skyColor) },
          horizonColor: { value: fogColor.clone() },
        },
        vertexShader: domeVertex,
        fragmentShader: nightFragment,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }), -1000);

      stars = new THREE.Points(
        own('geometries', starGeometry()),
        own('materials', new THREE.ShaderMaterial({
          vertexShader: starVertex,
          fragmentShader: starFragment,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          fog: false,
        })),
      );
      stars.name = 'sky:stars';
      stars.renderOrder = -900;
      root.add(stars);
    } else {
      atmosphere = new Sky();
      atmosphere.name = 'sky:atmosphere';
      atmosphere.scale.setScalar(2);
      atmosphere.renderOrder = -1000;
      own('geometries', atmosphere.geometry);
      own('materials', atmosphere.material);
      atmosphere.material.depthWrite = false;
      const uniforms = atmosphere.material.uniforms;
      for (const field of [
        'turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG',
      ]) {
        uniforms[field].value = theme.sky[field];
      }
      uniforms.sunPosition.value.copy(sunDirection);
      root.add(atmosphere);
    }

    const cloudColor = night
      ? fogColor.clone()
      : new THREE.Color(sunLight.color)
        .lerp(new THREE.Color(0xffffff), 0.5)
        .lerp(fogColor, theme.sky.elevation < 0 ? 0.85 : 0.2);
    clouds = mesh(
      'sky:clouds',
      own('geometries', new THREE.PlaneGeometry(1.7, 1.7)),
      new THREE.ShaderMaterial({
        uniforms: {
          noiseMap: { value: own('textures', cloudTexture()) },
          offset: { value: new THREE.Vector2() },
          cloudColor: { value: cloudColor },
          opacity: { value: night ? 0.2 : 0.45 },
        },
        vertexShader: cloudVertex,
        fragmentShader: cloudFragment,
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
        fog: false,
      }),
      -800,
    );
    clouds.rotation.x = -Math.PI / 2;
    clouds.position.y = 0.25;

    haze = mesh('sky:haze', dome, new THREE.ShaderMaterial({
      uniforms: { hazeColor: { value: fogColor.clone() } },
      vertexShader: domeVertex,
      fragmentShader: hazeFragment,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      fog: false,
    }), -700);
    haze.scale.setScalar(0.97);

    if (theme.sky.elevation > 0) {
      flare = new Lensflare();
      flare.name = 'sky:sun-flare';
      own('materials', flare.material);
      flare.position.copy(sunDirection).multiplyScalar(0.8);
      flare.visible = false;
      const color = new THREE.Color(sunLight.color);
      flare.addElement(new LensflareElement(
        own('textures', flareTexture(false)), 110, 0, color,
      ));
      flare.addElement(new LensflareElement(
        own('textures', flareTexture(true)), 52, 0.6, color,
      ));
      // Lensflare's own framebuffer depth test additionally rejects a sun
      // hidden by opaque stage geometry. The update gate rejects offscreen suns.
      root.add(flare);
    }

    parent.add(root);
  } catch (error) {
    dispose();
    throw error;
  }

  return {
    root, atmosphere, stars, clouds, haze, flare, sunDirection,
    resources, update, dispose,
  };
}
