/**
 * The fighter: a faithful port of Fighter.gd's state machine.
 *
 * Attack timing windows are measured as a fraction of the animation clip,
 * adjusted by playback speed. Godot's Area3D overlap callbacks become an
 * explicit hitbox test each frame, and move_and_slide becomes
 * integrate-then-resolve.
 *
 * Light/heavy/kick presses use a single short-lived buffer. The legacy
 * 'attack' action remains supported for older controllers. Combos belong
 * to the defender and last until hit reactions end or the timer expires.
 *
 * A missing animation clip is skipped rather than fatal, so the game runs
 * with whatever clips happen to be present.
 */

import * as THREE from 'three';
import {
  MOVEMENT, COMBAT, BODY, ARENA, HEALTH, FIGHTER_STATS,
  STATE_CLIP, LOOPING_STATES, MODEL_YAW_OFFSET,
} from './config.js';

export const State = {
  IDLE: 'IDLE', WALK: 'WALK', RUN: 'RUN', JUMP: 'JUMP',
  ATTACK: 'ATTACK', LIGHT_ATTACK: 'LIGHT_ATTACK', HEAVY_ATTACK: 'HEAVY_ATTACK',
  KICK: 'KICK', DROPKICK: 'DROPKICK',
  HIT: 'HIT', BLOCK: 'BLOCK', DASH: 'DASH',
  KNOCKDOWN: 'KNOCKDOWN', GETUP: 'GETUP', KO: 'KO',
};

const PUNCH_STATE_FOR = {
  attack: State.ATTACK,
  light: State.LIGHT_ATTACK,
  heavy: State.HEAVY_ATTACK,
};

const SWING_STATES = new Set([
  State.ATTACK, State.LIGHT_ATTACK, State.HEAVY_ATTACK,
  State.KICK, State.DROPKICK,
]);

/** Godot's move_toward: step `delta` from `current` toward `target`, no overshoot. */
export function moveToward(current, target, delta) {
  if (Math.abs(target - current) <= delta) return target;
  return current + Math.sign(target - current) * delta;
}

/** Shortest-path angle lerp, matching Godot's lerp_angle. */
export function lerpAngle(from, to, weight) {
  let diff = (to - from) % (Math.PI * 2);
  const short = ((2 * diff) % (Math.PI * 2)) - diff;
  return from + short * weight;
}

export class HealthComponent {
  constructor(max = HEALTH.max) {
    this.max = max;
    this.current = max;
    this.onChanged = null;
    this.onDied = null;
  }

  applyDamage(amount) {
    if (this.current <= 0) return;
    this.current = Math.max(this.current - amount, 0);
    this.onChanged?.(this.current, this.max);
    if (this.current === 0) this.onDied?.();
  }

  get fraction() { return this.max > 0 ? this.current / this.max : 1; }
  isAlive() { return this.current > 0; }
}

export class Fighter {
  /**
   * @param {object}  opts
   * @param {THREE.Object3D} opts.model     the knight, already cloned
   * @param {object}  opts.animator         from createAnimator()
   * @param {object}  opts.controller       { move(), pressed(action), held(action) }
   * @param {object}  opts.spawn            { x, y, z }
   * @param {string}  opts.name
   * @param {object}  [opts.stats]          partial overrides of FIGHTER_STATS
   * @param {number}  [opts.stats.maxHealth]
   * @param {number}  [opts.stats.walkSpeed]
   * @param {number}  [opts.stats.runSpeed]
   * @param {number}  [opts.stats.jumpSpeed] vertical takeoff velocity
   * @param {number}  [opts.stats.damageScale] outgoing damage multiplier
   * @param {number}  [opts.stats.defenceScale] positive incoming damage divisor
   * @param {(pos: THREE.Vector3, color: number) => void} [opts.onHitEffect]
   * @param {(name: string) => void} [opts.onSound]
   */
  constructor({
    model, animator, controller, spawn, name = 'Fighter', stats = {},
    onHitEffect, onSound,
  }) {
    this.name = name;
    this.model = model;
    this.animator = animator;
    this.controller = controller;
    this.onHitEffect = onHitEffect ?? (() => {});
    this.onSound = onSound ?? (() => {});

    // Own a resolved copy, never the caller's roster entry or config object.
    this.stats = {
      maxHealth: stats.maxHealth ?? FIGHTER_STATS.maxHealth,
      walkSpeed: stats.walkSpeed ?? FIGHTER_STATS.walkSpeed,
      runSpeed: stats.runSpeed ?? FIGHTER_STATS.runSpeed,
      jumpSpeed: stats.jumpSpeed ?? FIGHTER_STATS.jumpSpeed,
      damageScale: stats.damageScale ?? FIGHTER_STATS.damageScale,
      defenceScale: stats.defenceScale ?? FIGHTER_STATS.defenceScale,
    };

    this.position = new THREE.Vector3(spawn.x, spawn.y, spawn.z);
    this.velocity = new THREE.Vector3();
    this.rotationY = 0;
    this.facingSign = spawn.x <= 0 ? 1 : -1;
    this.rotationY = this.facingSign > 0 ? Math.PI / 2 : -Math.PI / 2;

    this.state = State.IDLE;
    this.stateTime = 0;
    this.onFloor = false;

    this.health = new HealthComponent(this.stats.maxHealth);
    this.health.onDied = () => this.#enterState(State.KO);

    // Per-swing values, set when a swing state is entered.
    this.hitboxLive = false;
    this.attackKnocksDown = false;
    this.attackDamage = COMBAT.attackDamage * this.stats.damageScale;
    this.attackKnockback = COMBAT.knockbackForce;
    this.dropkickConnected = false;
    this.swingLength = COMBAT.attackDuration;
    this.swingConnected = false;
    this.swingSoundPlayed = false;
    this.reactionLength = COMBAT.hitStun;
    this.alreadyHit = new Set();

    this.resetCombatTracking();

    this.dashDir = new THREE.Vector3();
    this.onStateChanged = null;
    this.debug = false;

    this.#enterState(State.IDLE);
    this.syncModel();
  }

  // -- main loop ----------------------------------------------------------

  update(dt, world) {
    this.updateCombatTimers(dt);
    this.#bufferAttackInput();
    this.stateTime += dt;

    if (!this.onFloor) this.velocity.y -= MOVEMENT.gravity * dt;

    switch (this.state) {
      case State.IDLE:
      case State.WALK:
      case State.RUN:
        this.#processGrounded(dt); break;
      case State.JUMP:
        this.#processJump(dt); break;
      case State.ATTACK:
      case State.LIGHT_ATTACK:
      case State.HEAVY_ATTACK:
      case State.KICK:
      case State.DROPKICK:
        this.#processSwing(dt, world); break;
      case State.BLOCK:
        this.#processBlock(dt); break;
      case State.DASH:
        this.#processDash(dt); break;
      case State.HIT:
        this.#decelerate(dt);
        if (this.stateTime >= this.reactionLength) this.#enterState(State.IDLE);
        break;
      case State.KNOCKDOWN:
        this.#decelerate(dt);
        if (this.stateTime >= this.reactionLength) this.#enterState(State.GETUP);
        break;
      case State.GETUP:
        this.#decelerate(dt);
        if (this.stateTime >= this.reactionLength) this.#enterState(State.IDLE);
        break;
      case State.KO:
        this.#decelerate(dt); break;
    }

    // A move/reaction may have finished this frame. Consume immediately,
    // without a mandatory idle frame or a second read of pressed().
    if (this.state === State.IDLE && !this.#held('block')) {
      this.#tryBufferedAttack(this.#moveInput());
    }

    this.#integrate(dt, world);
    this.animator.update(dt);
    this.syncModel();
  }

  /** Also called during intermissions, when simulation/input are stopped. */
  updateCombatTimers(dt) {
    this.attackBufferLeft = Math.max(0, this.attackBufferLeft - dt);
    if (this.attackBufferLeft === 0) this.bufferedAttack = null;

    this.comboTimeLeft = Math.max(0, this.comboTimeLeft - dt);
    if (this.comboTimeLeft === 0) this.comboCount = 0;
  }

  /** Round-boundary reset; no animation, controller, or health side effects. */
  resetCombatTracking() {
    this.bufferedAttack = null;
    this.attackBufferLeft = 0;
    this.comboCount = 0;
    this.comboTimeLeft = 0;
  }

  /** Position/rotation from simulation state onto the three.js object. */
  syncModel() {
    this.model.position.copy(this.position);
    this.model.rotation.y = this.rotationY + MODEL_YAW_OFFSET;
  }

  // -- input buffering ----------------------------------------------------

  #bufferAttackInput() {
    if (this.state === State.KO) return;

    // Read each edge once, even for controllers whose pressed() consumes it.
    // The latest frame replaces the pending action. Simultaneous presses
    // resolve heavy > light > legacy attack > kick. Holds never refresh it.
    const heavy = this.#pressed('heavy');
    const light = this.#pressed('light');
    const attack = this.#pressed('attack');
    const kick = this.#pressed('kick');
    if (!heavy && !light && !attack && !kick) return;

    this.bufferedAttack = heavy ? 'heavy' : light ? 'light' : attack ? 'attack' : 'kick';
    this.attackBufferLeft = COMBAT.attackBufferSeconds;
  }

  #tryBufferedAttack(dir, airborne = false) {
    const action = this.bufferedAttack;
    if (!action) return false;
    const punchState = PUNCH_STATE_FOR[action];
    if (airborne && !punchState) return false;

    this.bufferedAttack = null;
    this.attackBufferLeft = 0;

    if (punchState) {
      this.#enterState(punchState);
      if (airborne) this.attackKnocksDown = true;
    } else {
      // Resolve run/movement at execution time, just like a fresh kick.
      const moving = dir.x !== 0 || dir.y !== 0;
      this.#enterState(this.#held('run') && moving ? State.DROPKICK : State.KICK);
    }
    return true;
  }

  // -- state behaviours ---------------------------------------------------

  #processGrounded(dt) {
    const dir = this.#moveInput();
    const moving = dir.x !== 0 || dir.y !== 0;

    if (this.#held('block')) {
      this.velocity.x = 0; this.velocity.z = 0;
      this.#enterState(State.BLOCK);
      return;
    }
    if (this.#tryBufferedAttack(dir)) return;

    if (this.#pressed('dash')) {
      this.dashDir.set(dir.x, 0, dir.y);
      if (moving) this.dashDir.normalize();
      else this.dashDir.set(Math.sin(this.rotationY), 0, Math.cos(this.rotationY));
      this.#enterState(State.DASH);
      return;
    }
    if (this.#pressed('jump') && this.onFloor) {
      this.velocity.y = this.stats.jumpSpeed;
      if (moving) {
        this.velocity.x = dir.x * MOVEMENT.jumpMoveSpeed;
        this.velocity.z = dir.y * MOVEMENT.jumpMoveSpeed;
        this.#faceDirection(dir.x, dir.y, dt);
      } else {
        // Neutral jump goes straight up — no drift.
        this.velocity.x = 0; this.velocity.z = 0;
      }
      this.onFloor = false;
      this.#enterState(State.JUMP);
      return;
    }

    const running = this.#held('run');
    const targetSpeed = running ? this.stats.runSpeed : this.stats.walkSpeed;

    if (moving) {
      this.velocity.x = moveToward(this.velocity.x, dir.x * targetSpeed, MOVEMENT.acceleration * dt);
      this.velocity.z = moveToward(this.velocity.z, dir.y * targetSpeed, MOVEMENT.acceleration * dt);
      this.#faceDirection(dir.x, dir.y, dt);
      this.#enterState(running ? State.RUN : State.WALK);
    } else {
      this.#decelerate(dt);
      this.#enterState(State.IDLE);
    }
  }

  #processJump(dt) {
    const dir = this.#moveInput();
    if (dir.x !== 0 || dir.y !== 0) {
      const accel = MOVEMENT.acceleration * 2 * dt;
      this.velocity.x = moveToward(this.velocity.x, dir.x * MOVEMENT.jumpMoveSpeed, accel);
      this.velocity.z = moveToward(this.velocity.z, dir.y * MOVEMENT.jumpMoveSpeed, accel);
      this.#faceDirection(dir.x, dir.y, dt);
    }

    if (this.#tryBufferedAttack(dir, true)) return;

    if (this.onFloor && this.velocity.y <= 0) this.#enterState(State.IDLE);
  }

  #processSwing(dt, world) {
    let activeStart = this.swingLength * COMBAT.hitWindowStart;
    let activeEnd = this.swingLength * COMBAT.hitWindowEnd;

    if (this.state === State.DROPKICK) {
      // The drop kick connects during the leap, not late in the long clip.
      activeStart = 0.1;
      activeEnd = COMBAT.dropkickLungeTime + 0.2;

      if (this.stateTime < COMBAT.dropkickLungeTime && !this.dropkickConnected) {
        this.velocity.x = Math.sin(this.rotationY) * COMBAT.dropkickLunge;
        this.velocity.z = Math.cos(this.rotationY) * COMBAT.dropkickLunge;
      } else {
        this.#decelerate(dt * 1.5);
      }
    } else {
      this.#decelerate(dt * 1.5);
    }

    const live = this.stateTime >= activeStart && this.stateTime <= activeEnd;
    if (live !== this.hitboxLive) {
      this.hitboxLive = live;
      if (live) this.alreadyHit.clear();
    }
    if (live) this.#resolveHits(world);

    // Wait until contact is no longer possible: never play a whoosh and then
    // a hit for the same swing. Missing clips still use the fallback window.
    if (
      !this.swingSoundPlayed
      && (this.stateTime > activeEnd || this.stateTime >= this.swingLength)
    ) {
      this.swingSoundPlayed = true;
      if (!this.swingConnected) this.onSound('whiff');
    }

    if (this.stateTime >= this.swingLength) {
      this.hitboxLive = false;
      this.#enterState(State.IDLE);
    }
  }

  #processBlock(dt) {
    this.#decelerate(dt);
    if (!this.#held('block')) this.#enterState(State.IDLE);
  }

  #processDash(dt) {
    this.velocity.x = this.dashDir.x * COMBAT.dashSpeed;
    this.velocity.z = this.dashDir.z * COMBAT.dashSpeed;
    this.#faceDirection(this.dashDir.x, this.dashDir.z, dt);
    if (this.stateTime >= COMBAT.dashDuration) this.#enterState(State.IDLE);
  }

  // -- combat -------------------------------------------------------------

  /**
   * The old Hitbox Area3D, done explicitly: an oriented box in front of the
   * fighter tested against each enemy's hurtbox cylinder. One hit per swing
   * per target, same as the _already_hit array did.
   */
  #resolveHits(world) {
    for (const other of world.fighters) {
      if (other === this || this.alreadyHit.has(other)) continue;
      if (!this.#hitboxOverlaps(other)) continue;

      this.alreadyHit.add(other);
      const outcome = other.takeHit(
        this.attackDamage, this.position, this.attackKnocksDown, this.attackKnockback,
      );
      if (outcome) this.swingConnected = true;
      this.onAttackConnected();
    }
  }

  #hitboxOverlaps(other) {
    const box = BODY.hitbox;

    // Vertical overlap: hitbox slab vs. the target's body.
    const boxLowY = this.position.y + box.offsetY - box.halfHeight;
    const boxHighY = this.position.y + box.offsetY + box.halfHeight;
    const bodyLowY = other.position.y;
    const bodyHighY = other.position.y + BODY.height;
    if (boxHighY < bodyLowY || boxLowY > bodyHighY) return false;

    // Horizontal: put the target in our local frame, then circle-vs-rectangle.
    const dx = other.position.x - this.position.x;
    const dz = other.position.z - this.position.z;
    const s = Math.sin(this.rotationY);
    const c = Math.cos(this.rotationY);
    // Inverse of the yaw rotation that maps local +Z to (sin, 0, cos).
    const localX = dx * c - dz * s;
    const localZ = dx * s + dz * c;

    const nearestX = Math.max(-box.halfWidth, Math.min(localX, box.halfWidth));
    const nearestZ = Math.max(
      box.offsetZ - box.halfDepth,
      Math.min(localZ, box.offsetZ + box.halfDepth),
    );
    const distSq = (localX - nearestX) ** 2 + (localZ - nearestZ) ** 2;
    return distSq <= BODY.hurtRadius ** 2;
  }

  /** Ported from take_hit(); returns 'hit'/'block', or undefined if ignored. */
  takeHit(damage, fromPosition, knocksDown = false, knockback = COMBAT.knockbackForce) {
    if (this.state === State.KO || this.state === State.KNOCKDOWN || this.state === State.GETUP) {
      return;
    }

    let awayX = this.position.x - fromPosition.x;
    let awayZ = this.position.z - fromPosition.z;
    const len = Math.hypot(awayX, awayZ);
    if (len < 0.001) { awayX = -this.facingSign; awayZ = 0; }
    else { awayX /= len; awayZ /= len; }

    // Blocking only works when the attacker is in front of us.
    let blocked = false;
    if (this.state === State.BLOCK) {
      const side = Math.sign(fromPosition.x - this.position.x);
      if (side === this.facingSign || side === 0) blocked = true;
    }

    // Preserve legacy chip rounding, then divide all received damage.
    // Do not round again: defence can produce fractional health loss.
    const finalDamage = (blocked
      ? Math.round(damage * COMBAT.blockDamageMult)
      : damage) / this.stats.defenceScale;

    // Count on the defender, only after invulnerability/block checks.
    // Record before applyDamage so a lethal hit also contributes.
    if (!blocked && finalDamage > 0 && this.health.isAlive()) {
      this.comboCount = this.comboTimeLeft > 0 ? this.comboCount + 1 : 1;
      this.comboTimeLeft = COMBAT.comboWindowSeconds;
    }
    this.health.applyDamage(finalDamage);
    this.onSound(blocked ? 'block' : 'hit');

    const fx = new THREE.Vector3(
      THREE.MathUtils.lerp(this.position.x, fromPosition.x, 0.4),
      THREE.MathUtils.lerp(this.position.y, fromPosition.y, 0.4) + 1.1,
      THREE.MathUtils.lerp(this.position.z, fromPosition.z, 0.4),
    );

    if (blocked) {
      this.onHitEffect(fx, 0x80b3ff);                 // blue spark
      this.velocity.x = awayX * COMBAT.blockPushback;
      this.velocity.z = awayZ * COMBAT.blockPushback;
      // Chip damage can KO too; do not overwrite the death state.
      if (this.health.isAlive()) this.#enterState(State.BLOCK);
      return 'block';
    }
    this.onHitEffect(fx, 0xffd94d);                   // yellow spark

    this.velocity.x = awayX * knockback;
    this.velocity.z = awayZ * knockback;

    if (!this.health.isAlive()) return 'hit';         // onDied already set KO
    this.#enterState(knocksDown ? State.KNOCKDOWN : State.HIT);
    return 'hit';
  }

  /** A lunge that lands stops dead instead of passing through. */
  onAttackConnected() {
    if (this.state === State.DROPKICK) {
      this.dropkickConnected = true;
      this.velocity.x = 0;
      this.velocity.z = 0;
    }
  }

  // -- integration --------------------------------------------------------

  #integrate(dt, world) {
    const wasAboveFloor = this.position.y > ARENA.floorY;
    this.position.addScaledVector(this.velocity, dt);

    // Floor. Test actual height crossing, not the initially false onFloor,
    // so grounded spawns/reset states do not make phantom landing sounds.
    if (this.position.y <= ARENA.floorY) {
      this.position.y = ARENA.floorY;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.onFloor = true;
      if (wasAboveFloor) this.onSound('land');
    } else {
      this.onFloor = false;
    }

    // Fighters push each other apart rather than overlapping.
    for (const other of world.fighters) {
      if (other === this) continue;
      const dx = this.position.x - other.position.x;
      const dz = this.position.z - other.position.z;
      const dist = Math.hypot(dx, dz);
      const minDist = BODY.radius * 2;
      if (dist > 0.0001 && dist < minDist) {
        const push = (minDist - dist) / 2;
        this.position.x += (dx / dist) * push;
        this.position.z += (dz / dist) * push;
      }
    }

    // Arena walls.
    this.position.x = THREE.MathUtils.clamp(this.position.x, -ARENA.limitX, ARENA.limitX);
    this.position.z = THREE.MathUtils.clamp(this.position.z, -ARENA.limitZ, ARENA.limitZ);
  }

  #decelerate(dt) {
    this.velocity.x = moveToward(this.velocity.x, 0, MOVEMENT.friction * dt);
    this.velocity.z = moveToward(this.velocity.z, 0, MOVEMENT.friction * dt);
  }

  #faceDirection(dirX, dirZ, dt) {
    if (Math.hypot(dirX, dirZ, dt) < 0.05) return;
    const targetY = Math.atan2(dirX, dirZ);
    this.rotationY = lerpAngle(this.rotationY, targetY, Math.min(MOVEMENT.turnSpeed * dt, 1));
    if (Math.abs(dirX) > 0.05) this.facingSign = Math.sign(dirX);
  }

  // -- state machine plumbing ---------------------------------------------

  #enterState(next) {
    // Don't restart a looping animation every frame.
    if (next === this.state && LOOPING_STATES.has(next)) return;

    // Recovery ends the combo even when the inter-hit timer has time left.
    // KNOCKDOWN -> GETUP is not recovery; GETUP must finish first.
    if (next === State.IDLE && (this.state === State.HIT || this.state === State.GETUP)) {
      this.comboCount = 0;
      this.comboTimeLeft = 0;
    }

    // Getting interrupted discards earlier offensive intent. Fresh presses
    // near the end of a reaction can still buffer a recovery attack.
    if (next === State.HIT || next === State.KNOCKDOWN || next === State.KO) {
      this.bufferedAttack = null;
      this.attackBufferLeft = 0;
    }

    this.state = next;
    this.stateTime = 0;

    const punch = next === State.LIGHT_ATTACK
      ? COMBAT.lightAttack
      : next === State.HEAVY_ATTACK ? COMBAT.heavyAttack : null;
    const speed = punch
      ? punch.speed
      : next === State.KNOCKDOWN ? COMBAT.knockdownSpeed : 1;

    if (SWING_STATES.has(next)) {
      let fallback = COMBAT.attackDuration;
      if (punch || next === State.ATTACK) {
        this.attackKnocksDown = false;
        this.attackDamage = punch ? punch.damage : COMBAT.attackDamage;
        this.attackKnockback = punch ? punch.knockback : COMBAT.knockbackForce;
      } else if (next === State.KICK) {
        this.attackKnocksDown = false;
        this.attackDamage = COMBAT.kickDamage;
        this.attackKnockback = COMBAT.kickKnockback;
        fallback = COMBAT.kickDuration;
      } else {
        this.attackKnocksDown = true;
        this.attackDamage = COMBAT.dropkickDamage;
        this.attackKnockback = COMBAT.dropkickKnockback;
        this.dropkickConnected = false;
        fallback = COMBAT.kickDuration;
      }
      // Snapshot scaled damage once per swing; knockback is unaffected.
      this.attackDamage *= this.stats.damageScale;

      const clip = STATE_CLIP[next];
      const clipLength = this.animator.has(clip) ? this.animator.length(clip) : fallback;
      this.swingLength = clipLength / speed;
      if (next === State.DROPKICK) {
        this.swingLength = Math.max(0.2, this.swingLength - COMBAT.dropkickStartOffset);
      }
      this.alreadyHit.clear();
      this.hitboxLive = false;
      this.swingConnected = false;
      this.swingSoundPlayed = false;
    }

    if (next === State.HIT || next === State.KNOCKDOWN || next === State.GETUP) {
      let fallback = COMBAT.hitStun;
      if (next === State.KNOCKDOWN) fallback = COMBAT.knockdownDuration;
      else if (next === State.GETUP) fallback = COMBAT.getupDuration;

      const clip = STATE_CLIP[next];
      this.reactionLength = this.animator.has(clip) ? this.animator.length(clip) : fallback;
      if (next === State.KNOCKDOWN) {
        this.reactionLength /= Math.max(0.1, COMBAT.knockdownSpeed);
      }
    }

    const clip = STATE_CLIP[next];
    this.animator.play(clip, { loop: LOOPING_STATES.has(next), speed });

    if (this.debug) console.log(`[Fighter] ${this.name} -> ${next}`);
    this.onStateChanged?.(next);
  }

  // -- controller reads ---------------------------------------------------

  #moveInput() {
    const v = this.controller?.move?.() ?? { x: 0, y: 0 };
    const len = Math.hypot(v.x, v.y);
    return len > 1 ? { x: v.x / len, y: v.y / len } : v;
  }

  #pressed(action) { return Boolean(this.controller?.pressed?.(action)); }
  #held(action) { return Boolean(this.controller?.held?.(action)); }
}
