import * as THREE from 'three';
import { ARENA, BODY, MOVE_RULES, VFX } from './config.js';

const TYPES = new Set([
  'flash', 'sparks', 'shockwave', 'lightning', 'projectile', 'afterimage', 'dust',
]);
const MOVE_IDS = new Set([
  ...Object.keys(MOVE_RULES.colors),
  ...TYPES,
  'dash', 'landing', 'shake',
]);

export function hitSparkColor(weight = 0) {
  for (const band of VFX.weights) {
    if (weight <= band.max) return band.color;
  }
  return VFX.weights[VFX.weights.length - 1].color;
}

/**
 * Write an ordered, connected path into caller-owned storage. Endpoints are
 * exact; degenerate and vertical bolts are valid. No temporary allocations.
 */
export function generateLightning(
  output, start, end,
  amplitude = VFX.lightning.jitter,
  random = Math.random,
) {
  const count = output.length / 3;
  if (count < 2 || !Number.isInteger(count)) return false;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dy, dz);
  const nx = length ? dx / length : 1;
  const ny = length ? dy / length : 0;
  const nz = length ? dz / length : 0;
  const sideLength = Math.hypot(nx, nz);
  const ux = sideLength ? nz / sideLength : 1;
  const uy = 0;
  const uz = sideLength ? -nx / sideLength : 0;
  const vx = ny * uz - nz * uy;
  const vy = nz * ux - nx * uz;
  const vz = nx * uy - ny * ux;

  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const envelope = Math.sin(Math.PI * t) * Math.min(amplitude, length);
    const a = i === 0 || i === count - 1 ? 0 : (random() * 2 - 1) * envelope;
    const b = i === 0 || i === count - 1 ? 0 : (random() * 2 - 1) * envelope;
    const j = i * 3;
    output[j] = start.x + dx * t + ux * a + vx * b;
    output[j + 1] = start.y + dy * t + uy * a + vy * b;
    output[j + 2] = start.z + dz * t + uz * a + vz * b;
  }
  output[0] = start.x;
  output[1] = start.y;
  output[2] = start.z;
  output[output.length - 3] = end.x;
  output[output.length - 2] = end.y;
  output[output.length - 1] = end.z;
  return true;
}

function glowTexture() {
  const size = VFX.textureSize;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size * 2 - 1;
      const v = (y + 0.5) / size * 2 - 1;
      const radius = Math.hypot(u, v);
      const alpha = Math.max(0, 1 - radius) ** VFX.glowPower;
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(alpha * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.needsUpdate = true;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

/**
 * Slots are universal: an expired lightning slot can become a dust puff.
 * Allocation happens only on spawn, never in update(). Saturation drops new
 * particles rather than growing the pool or stealing a live projectile.
 *
 * clear() is deliberately stronger than expiration: it disposes everything
 * owned by this system. The instance can lazily rebuild on the next round.
 */
export class VFXSystem {
  constructor(scene, { cap = VFX.poolCap, onShake = null, random = Math.random } = {}) {
    this.cap = Math.max(0, Math.min(VFX.poolCap, Math.floor(cap)));
    this.root = new THREE.Group();
    this.root.name = 'Little Fighters VFX';
    scene.add(this.root);
    this.slots = [];
    this.resources = null;
    this.random = random;
    this.onShake = onShake;
    this.shakeOffset = new THREE.Vector3();
    this.shakeTime = 0;
    this.shakeDuration = 0;
    this.shakeStrength = 0;
    this.disposed = false;

    this.a = new THREE.Vector3();
    this.b = new THREE.Vector3();
    this.c = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
    this.zero = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.matrix = new THREE.Matrix4();
    this.size = new THREE.Vector3();
    this.poseOrigin = new THREE.Vector3();
  }

  get poolSize() { return this.slots.length; }
  get activeCount() {
    let count = 0;
    for (let i = 0; i < this.slots.length; i++) {
      if (this.slots[i].active) count++;
    }
    return count;
  }
  get freeCount() { return this.poolSize - this.activeCount; }

  #resources() {
    if (!this.resources) {
      this.resources = {
        texture: glowTexture(),
        cylinder: new THREE.CylinderGeometry(1, 1, 1, VFX.radialSegments, 1, true),
        ring: new THREE.RingGeometry(
          VFX.ring.innerRadius, 1, VFX.ring.segments,
        ),
      };
    }
    return this.resources;
  }

  #createSlot() {
    const resources = this.#resources();
    const group = new THREE.Group();
    group.visible = false;
    this.root.add(group);
    const common = {
      transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    };
    const coreMaterial = new THREE.SpriteMaterial({
      ...common, map: resources.texture,
    });
    const haloMaterial = new THREE.SpriteMaterial({
      ...common, map: resources.texture,
    });
    const solidMaterial = new THREE.MeshBasicMaterial({
      ...common, side: THREE.DoubleSide,
    });
    const glowMaterial = new THREE.MeshBasicMaterial({
      ...common, side: THREE.DoubleSide,
    });
    const core = new THREE.Sprite(coreMaterial);
    const halo = new THREE.Sprite(haloMaterial);
    const ring = new THREE.Mesh(resources.ring, solidMaterial);
    ring.rotation.x = -Math.PI / 2;
    const capacity = Math.max(
      VFX.sparks.count,
      VFX.lightning.segments + VFX.lightning.branches * VFX.lightning.branchSegments,
      VFX.projectile.tailSegments,
    );
    const streaks = new THREE.InstancedMesh(resources.cylinder, solidMaterial, capacity);
    const glow = new THREE.InstancedMesh(resources.cylinder, glowMaterial, capacity);
    streaks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    glow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    streaks.frustumCulled = glow.frustumCulled = false;
    group.add(core, halo, ring, streaks, glow);

    const slot = {
      active: false, type: '', age: 0, life: 0, scale: 1,
      group, core, halo, ring, streaks, glow,
      materials: [coreMaterial, haloMaterial, solidMaterial, glowMaterial],
      direction: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      end: new THREE.Vector3(),
      path: new Float32Array((VFX.lightning.segments + 1) * 3),
      velocities: new Float32Array(VFX.sparks.count * 3),
      trail: new Float32Array((VFX.projectile.tailSegments + 1) * 3),
      crackle: 0, trailClock: 0, speed: 0,
      projectile: null, owner: null,
      poses: [],
    };
    this.slots.push(slot);
    return slot;
  }

  #acquire() {
    for (let i = 0; i < this.slots.length; i++) {
      if (!this.slots[i].active) return this.slots[i];
    }
    return this.slots.length < this.cap ? this.#createSlot() : null;
  }

  #release(slot) {
    slot.active = false;
    slot.group.visible = false;
    slot.projectile = null;
    slot.owner = null;
  }

  /**
   * Primitive API. position/direction/end are copied, never retained.
   * A projectile may optionally follow an authoritative Fighter projectile.
   */
  spawn(type, options = {}) {
    if (this.disposed || !TYPES.has(type)) return false;
    if (type === 'afterimage' && !options.model) return false;
    const slot = this.#acquire();
    if (!slot) return false;

    slot.active = true;
    slot.type = type;
    slot.age = 0;
    slot.life = Number.isFinite(options.life) && options.life > 0
      ? options.life : VFX.life[type];
    slot.scale = Number.isFinite(options.scale) && options.scale > 0 ? options.scale : 1;
    slot.group.position.copy(options.position ?? this.zero);
    slot.group.scale.setScalar(1);
    slot.group.quaternion.identity();
    slot.direction.copy(options.direction ?? this.up);
    if (slot.direction.lengthSq() === 0) slot.direction.set(1, 0, 0);
    slot.direction.normalize();
    slot.velocity.copy(slot.direction);
    slot.projectile = options.projectile ?? null;
    slot.owner = options.owner ?? null;
    slot.crackle = 0;
    slot.trailClock = 0;

    for (let i = 0; i < slot.materials.length; i++) {
      const material = slot.materials[i];
      material.color.set(options.color ?? hitSparkColor(options.weight));
      material.opacity = 1;
      const blending = type === 'dust' ? THREE.NormalBlending : THREE.AdditiveBlending;
      if (material.blending !== blending) {
        material.blending = blending;
        material.needsUpdate = true;
      }
    }
    slot.core.material.color.lerp(this.#white(), VFX.coreWhiteMix);
    slot.core.visible = type === 'flash' || type === 'projectile' || type === 'dust';
    slot.halo.visible = type === 'flash' || type === 'projectile';
    slot.ring.visible = type === 'shockwave';
    slot.streaks.visible = type === 'sparks' || type === 'lightning' || type === 'projectile';
    slot.glow.visible = type === 'lightning' || type === 'projectile';
    slot.streaks.count = slot.glow.count = 0;
    slot.core.position.set(0, 0, 0);
    slot.halo.position.set(0, 0, 0);
    slot.core.scale.setScalar(slot.scale * VFX.flash.startSize);
    slot.halo.scale.setScalar(slot.scale * VFX.flash.startSize * VFX.haloScale);
    for (let i = 0; i < slot.poses.length; i++) slot.poses[i].mesh.visible = false;

    if (type === 'shockwave') {
      slot.group.position.y = ARENA.floorY + VFX.ring.floorLift;
      slot.ring.scale.setScalar(slot.scale * VFX.ring.startSize);
    } else if (type === 'sparks') {
      for (let i = 0; i < VFX.sparks.count; i++) {
        const j = i * 3;
        this.a.set(
          slot.direction.x * VFX.sparks.forward + (this.random() * 2 - 1),
          slot.direction.y * VFX.sparks.forward + this.random() * VFX.sparks.lift,
          slot.direction.z * VFX.sparks.forward + (this.random() * 2 - 1),
        ).normalize().multiplyScalar(
          slot.scale * (VFX.sparks.speedMin + this.random() * VFX.sparks.speedRange),
        );
        this.a.toArray(slot.velocities, j);
      }
      this.#sparks(slot);
    } else if (type === 'lightning') {
      slot.end.copy(options.end ?? slot.group.position)
        .sub(slot.group.position);
      if (!options.end) slot.end.copy(slot.direction).multiplyScalar(VFX.lightning.length * slot.scale);
      this.#lightning(slot);
    } else if (type === 'dust') {
      slot.velocity.multiplyScalar(VFX.dust.speed * slot.scale);
      slot.velocity.y += VFX.dust.rise * slot.scale;
    } else if (type === 'projectile') {
      slot.speed = options.speed ?? VFX.projectile.speed;
      for (let i = 0; i < slot.trail.length; i += 3) {
        slot.group.position.toArray(slot.trail, i);
      }
      this.#projectile(slot, 0);
    } else if (type === 'afterimage') {
      if (!this.#snapshot(slot, options.model)) {
        this.#release(slot);
        return false;
      }
    }
    slot.group.visible = true;
    return true;
  }

  #white() {
    if (!this.white) this.white = new THREE.Color(0xffffff);
    return this.white;
  }

  #segment(slot, index, from, to, width, glowWidth = 0) {
    this.c.subVectors(to, from);
    const length = this.c.length();
    if (length > 0) this.c.multiplyScalar(1 / length);
    else this.c.copy(this.up);
    this.quaternion.setFromUnitVectors(this.up, this.c);
    this.c.addVectors(from, to).multiplyScalar(0.5);
    this.size.set(width, length, width);
    this.matrix.compose(this.c, this.quaternion, this.size);
    slot.streaks.setMatrixAt(index, this.matrix);
    if (glowWidth > 0) {
      this.size.set(glowWidth, length, glowWidth);
      this.matrix.compose(this.c, this.quaternion, this.size);
      slot.glow.setMatrixAt(index, this.matrix);
    }
  }

  #sparks(slot) {
    const time = slot.age;
    for (let i = 0; i < VFX.sparks.count; i++) {
      const j = i * 3;
      this.a.fromArray(slot.velocities, j).multiplyScalar(time);
      this.a.y -= VFX.sparks.gravity * time * time / 2;
      this.b.fromArray(slot.velocities, j)
        .multiplyScalar(Math.max(0, time - VFX.sparks.streakSeconds));
      const tailTime = Math.max(0, time - VFX.sparks.streakSeconds);
      this.b.y -= VFX.sparks.gravity * tailTime * tailTime / 2;
      this.#segment(slot, i, this.a, this.b, VFX.sparks.width * slot.scale);
    }
    slot.streaks.count = VFX.sparks.count;
    slot.streaks.instanceMatrix.needsUpdate = true;
  }

  #lightning(slot) {
    generateLightning(
      slot.path, this.zero, slot.end,
      VFX.lightning.jitter * slot.scale, this.random,
    );
    let index = 0;
    for (let i = 0; i < VFX.lightning.segments; i++) {
      this.a.fromArray(slot.path, i * 3);
      this.b.fromArray(slot.path, (i + 1) * 3);
      this.#segment(
        slot, index++, this.a, this.b,
        VFX.lightning.width * slot.scale,
        VFX.lightning.glowWidth * slot.scale,
      );
    }
    for (let branch = 0; branch < VFX.lightning.branches; branch++) {
      const point = 1 + Math.floor(
        (branch + 1) / (VFX.lightning.branches + 1) * (VFX.lightning.segments - 1),
      );
      this.a.fromArray(slot.path, point * 3);
      for (let segment = 0; segment < VFX.lightning.branchSegments; segment++) {
        this.b.copy(this.a);
        this.b.x += (this.random() * 2 - 1) * VFX.lightning.branchLength * slot.scale;
        this.b.y += (this.random() * 2 - 1) * VFX.lightning.branchLength * slot.scale;
        this.b.z += (this.random() * 2 - 1) * VFX.lightning.branchLength * slot.scale;
        this.#segment(
          slot, index++, this.a, this.b,
          VFX.lightning.width * slot.scale * VFX.lightning.branchWidth,
          VFX.lightning.glowWidth * slot.scale * VFX.lightning.branchWidth,
        );
        this.a.copy(this.b);
      }
    }
    slot.streaks.count = slot.glow.count = index;
    slot.streaks.instanceMatrix.needsUpdate = true;
    slot.glow.instanceMatrix.needsUpdate = true;
  }

  #projectile(slot, dt) {
    if (slot.projectile) {
      slot.group.position.copy(slot.projectile.position);
      slot.group.position.y += BODY.hitbox.offsetY;
    } else {
      slot.group.position.addScaledVector(slot.direction, slot.speed * dt);
    }
    slot.trailClock += dt;
    if (slot.trailClock >= VFX.projectile.tailSampleSeconds) {
      slot.trailClock %= VFX.projectile.tailSampleSeconds;
      for (let i = slot.trail.length - 1; i >= 3; i--) {
        slot.trail[i] = slot.trail[i - 3];
      }
    }
    slot.group.position.toArray(slot.trail, 0);
    for (let i = 0; i < VFX.projectile.tailSegments; i++) {
      this.a.fromArray(slot.trail, i * 3).sub(slot.group.position);
      this.b.fromArray(slot.trail, (i + 1) * 3).sub(slot.group.position);
      const taper = 1 - i / VFX.projectile.tailSegments;
      this.#segment(
        slot, i, this.a, this.b,
        slot.scale * VFX.projectile.tailWidth * taper,
        slot.scale * VFX.projectile.tailWidth * taper * VFX.haloScale,
      );
    }
    slot.streaks.count = slot.glow.count = VFX.projectile.tailSegments;
    slot.streaks.instanceMatrix.needsUpdate = true;
    slot.glow.instanceMatrix.needsUpdate = true;
    slot.core.scale.setScalar(slot.scale * VFX.projectile.coreSize);
    slot.halo.scale.setScalar(slot.scale * VFX.projectile.coreSize * VFX.haloScale);
  }

  /**
   * Bake the current skinned/morphed pose, not a bind-pose clone. Only these
   * private position/index buffers are owned here; model assets are untouched.
   * Snapshot work and buffer allocation happen exclusively during spawn().
   */
  #snapshot(slot, model) {
    model.updateWorldMatrix(true, true);
    model.getWorldPosition(this.poseOrigin);
    let used = 0;
    let vertices = 0;
    model.traverse((source) => {
      if (
        !source.isMesh || !source.visible || !source.geometry?.attributes.position
        || used >= VFX.afterimage.maxMeshes
      ) return;
      const count = source.geometry.attributes.position.count;
      if (vertices + count > VFX.afterimage.maxVertices) return;
      vertices += count;
      if (source.isSkinnedMesh) source.skeleton.update();

      let entry = slot.poses[used];
      if (!entry) {
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), slot.materials[2]);
        mesh.frustumCulled = false;
        slot.group.add(mesh);
        entry = { mesh, sourceGeometry: null };
        slot.poses.push(entry);
      }
      if (entry.sourceGeometry !== source.geometry) {
        entry.mesh.geometry.dispose();
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          'position',
          new THREE.BufferAttribute(new Float32Array(count * 3), 3),
        );
        if (source.geometry.index) geometry.setIndex(source.geometry.index.clone());
        geometry.setDrawRange(source.geometry.drawRange.start, source.geometry.drawRange.count);
        entry.mesh.geometry = geometry;
        entry.sourceGeometry = source.geometry;
      }
      const positions = entry.mesh.geometry.attributes.position;
      for (let i = 0; i < count; i++) {
        source.getVertexPosition(i, this.a);
        this.a.applyMatrix4(source.matrixWorld).sub(this.poseOrigin)
          .multiplyScalar(slot.scale);
        positions.setXYZ(i, this.a.x, this.a.y, this.a.z);
      }
      positions.needsUpdate = true;
      entry.mesh.visible = true;
      used++;
    });
    return used > 0;
  }

  #dust(options) {
    let spawned = false;
    const direction = new THREE.Vector3();
    const position = new THREE.Vector3().copy(options.feet ?? options.position ?? this.zero);
    position.y = ARENA.floorY + VFX.dust.floorLift;
    for (let i = 0; i < VFX.dust.count; i++) {
      const angle = i / VFX.dust.count * Math.PI * 2;
      direction.set(Math.cos(angle), 0, Math.sin(angle));
      if (options.direction) direction.addScaledVector(options.direction, VFX.dust.directionBias);
      spawned = this.spawn('dust', {
        ...options, position, direction, color: VFX.dust.color,
      }) || spawned;
    }
    return spawned;
  }

  #afterimages(options) {
    if (!options.model) return false;
    const position = new THREE.Vector3().copy(options.feet ?? options.position ?? this.zero);
    const direction = new THREE.Vector3().copy(options.direction ?? this.up).normalize();
    let spawned = false;
    for (let i = 0; i < VFX.afterimage.count; i++) {
      position.addScaledVector(direction, -VFX.afterimage.spacing);
      spawned = this.spawn('afterimage', {
        ...options, position, scale: 1,
        life: VFX.life.afterimage + i * VFX.afterimage.lifeStep,
      }) || spawned;
    }
    return spawned;
  }

  /**
   * Move/event API. All authored IDs are explicitly recognised; an unknown
   * ID has no particles, shake, allocation, or fallback side effects.
   */
  emit(id, options = {}) {
    if (this.disposed || !MOVE_IDS.has(id)) return false;
    const weight = Math.max(0, options.weight ?? 0);
    const scale = (options.scale ?? 1) * THREE.MathUtils.clamp(
      VFX.weightScale.base + weight / VFX.weightScale.divisor,
      VFX.weightScale.min, VFX.weightScale.max,
    );
    const style = {
      ...options, scale,
      color: options.color ?? MOVE_RULES.colors[id] ?? hitSparkColor(weight),
    };

    if (id === 'shake') {
      this.shake(weight);
      return true;
    }
    if (id === 'dash') {
      this.#dust(style);
      return this.#afterimages(style);
    }
    if (id === 'landing') {
      this.#dust(style);
      if (weight >= VFX.landing.heavySpeed) {
        this.spawn('shockwave', style);
        this.shake(weight * VFX.landing.shakeWeight);
      }
      return true;
    }
    if (options.phase === 'projectile') {
      return this.spawn('projectile', {
        ...style,
        life: options.projectile?.life ?? VFX.life.projectile,
        speed: options.move?.effects.projectile?.speed ?? VFX.projectile.speed,
      });
    }
    if (options.phase === 'hit' || options.phase === 'block') {
      const blocked = options.phase === 'block';
      this.spawn('flash', style);
      this.spawn('sparks', {
        ...style, color: blocked ? MOVE_RULES.colors.guard : hitSparkColor(weight),
      });
      if (!blocked && id === 'shockwave') this.spawn('shockwave', style);
      if (!blocked && id === 'reach') this.spawn('lightning', style);
      this.shake(weight * (blocked ? VFX.shake.blockMultiplier : 1));
      return true;
    }

    switch (id) {
      case 'impact':
      case 'guard':
        return this.spawn('flash', style);
      case 'flash':
        this.#afterimages(style);
        return this.spawn('flash', style);
      case 'reach':
        return this.spawn('lightning', style);
      case 'flame':
        this.spawn('flash', style);
        return this.spawn('sparks', style);
      case 'shockwave':
        this.#dust(style);
        return this.spawn('shockwave', style);
      case 'dust':
        return this.#dust(style);
      case 'afterimage':
        return this.#afterimages(style);
      default:
        return this.spawn(id, style);
    }
  }

  shake(weight = VFX.shake.weightUnit) {
    if (this.disposed || !Number.isFinite(weight) || weight <= 0) return;
    this.shakeStrength = Math.max(
      this.shakeStrength,
      Math.min(VFX.shake.maxStrength, weight / VFX.shake.weightUnit * VFX.shake.strength),
    );
    this.shakeTime = 0;
    this.shakeDuration = VFX.shake.seconds;
  }

  /** One allocation-free particle/shake update, in simulation seconds. */
  update(dt) {
    if (this.disposed || !Number.isFinite(dt) || dt < 0) return;
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (!slot.active) continue;
      slot.age += dt;
      if (
        slot.age >= slot.life
        || (slot.projectile && (
          slot.projectile.life <= 0
          || !slot.owner?.projectiles.includes(slot.projectile)
        ))
      ) {
        this.#release(slot);
        continue;
      }
      const t = slot.age / slot.life;
      const fade = 1 - t;
      slot.materials[0].opacity = fade;
      slot.materials[1].opacity = fade * VFX.haloOpacity;
      slot.materials[2].opacity = fade;
      slot.materials[3].opacity = fade * VFX.lightning.glowOpacity;
      switch (slot.type) {
        case 'flash': {
          const size = slot.scale * (
            VFX.flash.startSize + t * VFX.flash.expansion
          );
          slot.core.scale.setScalar(size);
          slot.halo.scale.setScalar(size * VFX.haloScale);
          break;
        }
        case 'sparks':
          this.#sparks(slot);
          break;
        case 'shockwave':
          slot.ring.scale.setScalar(slot.scale * (
            VFX.ring.startSize + t * VFX.ring.expansion
          ));
          break;
        case 'lightning':
          slot.crackle += dt;
          if (slot.crackle >= VFX.lightning.regenerateSeconds) {
            slot.crackle %= VFX.lightning.regenerateSeconds;
            this.#lightning(slot);
          }
          break;
        case 'projectile':
          this.#projectile(slot, dt);
          break;
        case 'dust':
          slot.group.position.addScaledVector(slot.velocity, dt);
          slot.core.scale.setScalar(slot.scale * (
            VFX.dust.startSize + t * VFX.dust.expansion
          ));
          slot.materials[0].opacity = fade * fade * VFX.dust.opacity;
          break;
        case 'afterimage':
          slot.materials[2].opacity = fade * VFX.afterimage.opacity;
          break;
      }
    }

    if (this.shakeDuration > 0) {
      this.shakeTime += dt;
      if (this.shakeTime >= this.shakeDuration) {
        this.shakeDuration = this.shakeStrength = 0;
        this.shakeOffset.set(0, 0, 0);
      } else {
        const envelope = (1 - this.shakeTime / this.shakeDuration) ** VFX.shake.decayPower;
        const amplitude = this.shakeStrength * envelope;
        this.shakeOffset.set(
          Math.sin(this.shakeTime * VFX.shake.frequencyX) * amplitude,
          Math.sin(this.shakeTime * VFX.shake.frequencyY) * amplitude * VFX.shake.vertical,
          0,
        );
      }
    } else {
      this.shakeOffset.set(0, 0, 0);
    }
    this.onShake?.(this.shakeOffset);
  }

  clear() {
    this.shakeTime = this.shakeDuration = this.shakeStrength = 0;
    this.shakeOffset.set(0, 0, 0);
    this.onShake?.(this.shakeOffset);
    for (const slot of this.slots) {
      this.#release(slot);
      slot.group.removeFromParent();
      slot.streaks.dispose();
      slot.glow.dispose();
      for (const material of slot.materials) material.dispose();
      for (const pose of slot.poses) pose.mesh.geometry.dispose();
      slot.poses.length = 0;
    }
    this.slots.length = 0;
    if (this.resources) {
      this.resources.texture.dispose();
      this.resources.cylinder.dispose();
      this.resources.ring.dispose();
      this.resources = null;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.clear();
    this.root.removeFromParent();
    this.disposed = true;
  }
}
