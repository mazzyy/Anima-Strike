/**
 * String-state fighter with legacy attacks, authored moves and signature supers.
 * Gameplay timing never depends on the presence of an animation clip.
 */
import * as THREE from 'three';
import {
  MOVEMENT, COMBAT, BODY, ARENA, HEALTH, FIGHTER_STATS, AUDIO,
  STATE_CLIP, LOOPING_STATES, MODEL_YAW_OFFSET, MOVE_RULES,
  SUPER_RULES, SUPER_DATA,
} from './config.js';
import { MOVES, resolveMove, appendInput, directionToken } from './moves.js';
import { fillMeter, spendStock } from './meter.js';

export const State = {
  IDLE: 'IDLE', WALK: 'WALK', RUN: 'RUN', JUMP: 'JUMP',
  ATTACK: 'ATTACK', LIGHT_ATTACK: 'LIGHT_ATTACK', HEAVY_ATTACK: 'HEAVY_ATTACK',
  KICK: 'KICK', DROPKICK: 'DROPKICK',
  AIR_LIGHT_ATTACK: 'AIR_LIGHT_ATTACK', AIR_HEAVY_ATTACK: 'AIR_HEAVY_ATTACK',
  DIVE_KICK: 'DIVE_KICK', JUGGLE: 'JUGGLE',
  GRAB: 'GRAB', GRABBING: 'GRABBING', HELD: 'HELD',
  THROW: 'THROW', GRAB_RECOVERY: 'GRAB_RECOVERY',
  HIT: 'HIT', BLOCK: 'BLOCK', DASH: 'DASH', SUPER: 'SUPER',
  KNOCKDOWN: 'KNOCKDOWN', GETUP: 'GETUP', KO: 'KO',
};

const PUNCH_STATE_FOR = {
  attack: State.ATTACK, light: State.LIGHT_ATTACK, heavy: State.HEAVY_ATTACK,
};
const AIR_STATE_FOR = {
  light: State.AIR_LIGHT_ATTACK, heavy: State.AIR_HEAVY_ATTACK, kick: State.DIVE_KICK,
};
const AIR_MOVE_FOR = {
  [State.AIR_LIGHT_ATTACK]: COMBAT.airLightAttack,
  [State.AIR_HEAVY_ATTACK]: COMBAT.airHeavyAttack,
  [State.DIVE_KICK]: COMBAT.diveKick,
};
const SWING_STATES = new Set([
  State.ATTACK, State.LIGHT_ATTACK, State.HEAVY_ATTACK,
  State.KICK, State.DROPKICK,
  State.AIR_LIGHT_ATTACK, State.AIR_HEAVY_ATTACK, State.DIVE_KICK,
]);
const GRAB_STATES = new Set([
  State.GRAB, State.GRABBING, State.HELD, State.THROW, State.GRAB_RECOVERY,
]);
const GRABBABLE_STATES = new Set([
  State.IDLE, State.WALK, State.RUN, State.BLOCK, State.HIT,
  State.ATTACK, State.LIGHT_ATTACK, State.HEAVY_ATTACK, State.KICK,
  State.GRAB, State.GRAB_RECOVERY,
]);
const BUTTON_ACTIONS = [
  'attack', 'light', 'heavy', 'kick', 'grab', 'jump', 'dash', 'block', 'super',
];

export function moveToward(current, target, delta) {
  if (Math.abs(target - current) <= delta) return target;
  return current + Math.sign(target - current) * delta;
}

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
  constructor({
    model, animator, controller, spawn, name = 'Fighter', stats = {},
    reachScale = 1, onHitEffect, onSound, onVFX, character,
  }) {
    this.name = name;
    this.model = model;
    this.animator = animator;
    this.controller = controller;
    this.onHitEffect = onHitEffect ?? (() => {});
    this.onSound = onSound ?? (() => {});
    this.onVFX = onVFX;
    const characterId = typeof character === 'string' ? character : character?.id;
    this.character = characterId ?? model.userData?.lfCharacter ?? null;
    this.reachScale = Number.isFinite(reachScale) && reachScale > 0 ? reachScale : 1;
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
    this.facingSign = spawn.x <= 0 ? 1 : -1;
    this.rotationY = this.facingSign > 0 ? Math.PI / 2 : -Math.PI / 2;
    this.state = State.IDLE;
    this.stateTime = 0;
    this.onFloor = false;
    this.health = new HealthComponent(this.stats.maxHealth);
    this.health.onDied = () => this.#enterState(State.KO);
    this.hitboxLive = false;
    this.attackKnocksDown = false;
    this.attackDamage = COMBAT.attackDamage * this.stats.damageScale;
    this.attackKnockback = COMBAT.knockbackForce;
    this.attackSound = 'hit';
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

  update(dt, world) {
    this.updateCombatTimers(dt);
    this.#readInputEdges();
    this.#bufferAttackInput();
    this.#recordCommands();
    this.stateTime += dt;
    if (!(this.#pressed('super') && this.activateSuper(world))) this.#tryMove();

    if (!this.onFloor && this.state !== State.SUPER) {
      const fallingDt = this.state === State.JUGGLE
        ? Math.min(dt, Math.max(0, this.stateTime - COMBAT.juggle.floatSeconds))
        : dt;
      this.velocity.y -= MOVEMENT.gravity * fallingDt;
    }

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
      case State.AIR_LIGHT_ATTACK:
      case State.AIR_HEAVY_ATTACK:
      case State.DIVE_KICK:
        this.#processSwing(dt, world); break;
      case State.SUPER:
        this.#processSuper(dt, world); break;
      case State.JUGGLE:
        this.#decelerate(dt); break;
      case State.GRAB:
        this.#processGrab(dt, world); break;
      case State.GRABBING:
        this.#processHolding(); break;
      case State.HELD:
        this.#processHeld(); break;
      case State.THROW:
      case State.GRAB_RECOVERY:
        this.#decelerate(dt);
        if (this.stateTime >= (
          this.state === State.THROW
            ? COMBAT.grab.throwRecoverySeconds
            : COMBAT.grab.recoverySeconds
        )) this.#enterState(State.IDLE);
        break;
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
        if (this.onFloor && this.stateTime >= this.reactionLength) {
          this.#enterState(State.GETUP);
        }
        break;
      case State.GETUP:
        this.#decelerate(dt);
        if (this.stateTime >= this.reactionLength) this.#enterState(State.IDLE);
        break;
      case State.KO:
        this.#decelerate(dt); break;
    }

    if (this.state === State.IDLE && !this.#held('block')) {
      if (!this.#tryMove()) this.#tryBufferedAttack(this.#moveInput());
    }

    this.#updateProjectiles(dt, world);
    this.#integrate(dt, world);
    this.animator.update(dt);
    this.syncModel();
  }

  updateCombatTimers(dt) {
    this.inputClock += dt;
    this.inputHistory = this.inputHistory.filter(
      (entry) => this.inputClock - entry.time <= MOVE_RULES.commandSeconds,
    );
    this.attackBufferLeft = Math.max(0, this.attackBufferLeft - dt);
    if (this.attackBufferLeft === 0) this.bufferedAttack = null;
    this.comboTimeLeft = Math.max(0, this.comboTimeLeft - dt);
    if (this.comboTimeLeft === 0) this.comboCount = 0;
    if (this.state !== State.KNOCKDOWN && this.state !== State.GETUP) {
      this.grabImmunityLeft = Math.max(0, this.grabImmunityLeft - dt);
    }
    this.invulnerableLeft = Math.max(0, this.invulnerableLeft - dt);
  }

  get superFrame() {
    return Math.floor(this.stateTime * SUPER_RULES.fps + SUPER_RULES.frameEpsilon);
  }

  get invulnerable() {
    return this.invulnerableLeft > 0 || (
      this.state === State.SUPER
      && this.superFrame >= SUPER_RULES.invulnerableStartFrame
      && this.superFrame < SUPER_RULES.invulnerableEndFrame
    );
  }

  set invulnerable(value) {
    this.invulnerableLeft = value
      ? Math.max(this.invulnerableLeft, COMBAT.reaction.getupInvulnerable)
      : 0;
  }

  #reactionWindow(next) {
    const r = COMBAT.reaction;
    if (next === State.KNOCKDOWN) return r.knockdown;
    if (next === State.GETUP) return r.getup;
    if (next === State.JUGGLE) return COMBAT.juggle.floatSeconds;
    const hitsSoFar = Math.max(0, this.comboCount - 1);
    return Math.max(r.minHitStun, r.hitStun * r.comboDecay ** hitsSoFar);
  }

  resetCombatTracking() {
    if (this.grabbedFighter?.heldBy === this) this.grabbedFighter.heldBy = null;
    if (this.heldBy?.grabbedFighter === this) this.heldBy.grabbedFighter = null;
    this.grabbedFighter = null;
    this.heldBy = null;
    this.grabImmunityLeft = 0;
    this.invulnerableLeft = 0;
    this.grabAttempted = false;
    this.grabStartup = 0;
    this.grabYaw = 0;
    this.mashTimes = [];
    this.inputEdges = new Set();
    this.bufferedAttack = null;
    this.attackBufferLeft = 0;
    this.comboCount = 0;
    this.comboTimeLeft = 0;
    this.juggleCount = 0;
    this.airborneSwing = false;
    this.inputClock = 0;
    this.inputHistory = [];
    this.lastDirection = 'neutral';
    this.commandFacing = this.facingSign;
    this.currentMove = null;
    this.moveActivated = false;
    this.moveArmor = 0;
    this.moveYaw = this.rotationY;
    this.projectiles = [];
    // Deliberate round policy: reset all stocks/progress each round.
    // Banking is useful within a round, but never snowballs into the next one.
    this.meter = 0;
    this.currentSuper = null;
    this.superTarget = null;
    this.superPoint = null;
    this.superOrigin = null;
    this.superWorld = null;
    this.superHitIndex = 0;
    this.superCountered = false;
    this.superConnected = false;
    this.superFxFrame = -Infinity;
    this.attackSound = 'hit';
    this.lastSoundHit = null;
  }

  syncModel() {
    this.model.position.copy(this.position);
    this.model.rotation.y = this.rotationY + MODEL_YAW_OFFSET;
  }

  #readInputEdges() {
    this.inputEdges.clear();
    if (this.state === State.KO) return;
    for (const action of BUTTON_ACTIONS) {
      if (this.controller?.pressed?.(action)) this.inputEdges.add(action);
    }
  }

  #bufferAttackInput() {
    if (
      this.state === State.KO || this.state === State.JUGGLE
      || this.state === State.SUPER || GRAB_STATES.has(this.state)
    ) return;
    const heavy = this.#pressed('heavy');
    const light = this.#pressed('light');
    const attack = this.#pressed('attack');
    const kick = this.#pressed('kick');
    if (!heavy && !light && !attack && !kick) return;
    this.bufferedAttack = heavy ? 'heavy' : light ? 'light' : attack ? 'attack' : 'kick';
    this.attackBufferLeft = COMBAT.attackBufferSeconds;
  }

  #recordCommands() {
    if (!MOVES[this.character] || this.state === State.KO || this.state === State.SUPER) return;
    if (!this.inputHistory.length) this.commandFacing = this.facingSign;
    const direction = directionToken(this.#moveInput(), this.commandFacing);
    if (direction !== this.lastDirection) {
      this.inputHistory = appendInput(this.inputHistory, direction, this.inputClock);
      this.lastDirection = direction;
    }
    for (const action of this.inputEdges) {
      // Supers are edges, never buffered commands or cancel destinations.
      if (action !== 'super') {
        this.inputHistory = appendInput(this.inputHistory, action, this.inputClock);
      }
    }
  }

  #tryMove() {
    if (!MOVES[this.character] || this.state === State.SUPER) return false;
    const move = this.currentMove;
    const phase = !move ? null
      : this.stateTime < move.startup ? 'startup'
        : this.stateTime < move.startup + move.active ? 'active' : 'recovery';
    const state = !move
      && [State.IDLE, State.WALK, State.RUN].includes(this.state)
      && this.#held('block') ? State.BLOCK : this.state;
    const resolved = resolveMove(this.inputHistory, this.character, {
      state, now: this.inputClock, airborne: this.#isAirborne(),
      currentMove: move, phase,
    });
    if (!resolved) return false;
    this.#startMove(resolved);
    return true;
  }

  /**
   * The state an authored move enters.
   *
   * Every authored move used to enter State.ATTACK — the LEGACY action state —
   * whatever button produced it. That collapsed light, heavy and kick into one
   * state, so nothing downstream could tell them apart: main.js reads
   * State.HEAVY_ATTACK to decide whether a hit earns hit-stop, so heavies
   * stopped registering as heavy; air variants were indistinguishable from
   * grounded ones; and a light jab reported itself as a legacy attack.
   *
   * The button is the last token of the command — 'forward,down,light' is a
   * light. Commands ending in 'grab' or 'dash' (a command throw, a teleport)
   * are not punches and deliberately keep the legacy State.ATTACK, which is
   * what they already had. tools/move-states.test.mjs catches any NEW button
   * that falls through unmapped.
   */
  #stateForMove(move) {
    const button = String(move.input ?? '').split(',').pop().trim();
    if (this.#isAirborne() && AIR_STATE_FOR[button]) return AIR_STATE_FOR[button];
    if (button === 'kick') return State.KICK;
    return PUNCH_STATE_FOR[button] ?? State.ATTACK;
  }

  #startMove(move) {
    this.inputHistory = [];
    this.bufferedAttack = null;
    this.attackBufferLeft = 0;
    this.#enterState(this.#stateForMove(move), move);
    if (move.effects.selfDamage) this.health.applyDamage(move.effects.selfDamage);
  }

  /**
   * Atomic activation shared by the controller edge and headless callers.
   * No entry from attacks, hit-stun, air or another super. Failure costs nothing.
   */
  activateSuper(world) {
    const definition = SUPER_DATA[this.character];
    if (
      !definition || !this.health.isAlive() || !this.onFloor
      || !SUPER_RULES.allowedStates.includes(this.state) || this.currentMove
    ) return false;
    const transaction = spendStock(this.meter);
    if (!transaction.activated) return false;
    this.meter = transaction.value;
    this.#enterState(State.SUPER);
    this.superWorld = world;
    this.superOrigin = this.position.clone();
    this.superTarget = (world?.fighters ?? [])
      .filter((other) => other !== this && other.health.isAlive())
      .sort((a, b) => this.position.distanceToSquared(a.position)
        - this.position.distanceToSquared(b.position))[0] ?? null;

    // Column/flurry acquire a point once. Walking away from the telegraph works.
    const direction = new THREE.Vector3(
      Math.sin(this.moveYaw), 0, Math.cos(this.moveYaw),
    );
    const offset = this.superTarget
      ? this.superTarget.position.clone().sub(this.position).setY(0)
      : direction.multiplyScalar(definition.reach);
    if (offset.length() > definition.reach) offset.setLength(definition.reach);
    this.superPoint = this.position.clone().add(offset);
    this.superPoint.y = ARENA.floorY;
    this.#clampPosition(this.superPoint);
    this.onSound('super');
    this.#superEffect('flash', this.position);
    if (definition.kind === 'column') this.#superEffect('flash', this.superPoint);
    return true;
  }

  #superEffect(id, position, extra = {}) {
    const definition = this.currentSuper;
    if (!definition) return;
    const direction = new THREE.Vector3(Math.sin(this.moveYaw), 0, Math.cos(this.moveYaw));
    if (this.onVFX) {
      this.onVFX(id, {
        position: position.clone(), direction,
        model: this.model, color: definition.color,
        damage: this.attackDamage, weight: this.attackDamage,
        ...extra,
      });
    } else {
      this.onHitEffect(position.clone(), definition.color);
    }
  }

  #superOverlaps(other, origin, reach, radial = false, height = SUPER_RULES.height) {
    if (
      !other.health.isAlive()
      || other.position.y > origin.y + height
      || other.position.y + BODY.height < origin.y
    ) return false;
    const dx = other.position.x - origin.x;
    const dz = other.position.z - origin.z;
    if (radial) return Math.hypot(dx, dz) <= reach + BODY.hurtRadius;
    const forward = dx * Math.sin(this.moveYaw) + dz * Math.cos(this.moveYaw);
    const side = dx * Math.cos(this.moveYaw) - dz * Math.sin(this.moveYaw);
    const nearestForward = THREE.MathUtils.clamp(forward, 0, reach);
    const nearestSide = THREE.MathUtils.clamp(side, -BODY.hitbox.halfWidth, BODY.hitbox.halfWidth);
    return (forward - nearestForward) ** 2 + (side - nearestSide) ** 2
      <= BODY.hurtRadius ** 2;
  }

  #superHit(other, origin, beat, world, counterPunish = false) {
    const definition = this.currentSuper;
    this.attackDamage = beat.damage * this.stats.damageScale;
    this.attackKnockback = beat.knockback ?? SUPER_RULES.defaultKnockback;
    this.attackKnocksDown = Boolean(beat.knocksDown);
    this.attackSound = beat.burn ? 'projectileImpact' : definition.sound;
    const outcome = other.takeHit(
      this.attackDamage, origin, this.attackKnocksDown, this.attackKnockback,
      {
        source: this, sound: this.attackSound, super: true, counterPunish,
        pierceBlock: Boolean(definition.pierceBlock || beat.pierceBlock),
      },
    );
    if (!['hit', 'block', 'armor'].includes(outcome)) return outcome;
    this.swingConnected = true;
    if (!this.superConnected) {
      this.superConnected = true;
      if (world) {
        world.superPauseLeft = Math.max(world.superPauseLeft ?? 0, SUPER_RULES.pauseSeconds);
      }
    }
    this.#superEffect('sparks', other.position);
    if (
      outcome === 'hit' && beat.launch && other.health.isAlive()
      && other.state === State.HIT
    ) {
      other.position.y = Math.max(other.position.y, ARENA.floorY + MOVE_RULES.launchLift);
      other.onFloor = false;
      other.juggleCount = 1;
      other.#enterState(State.JUGGLE);
      other.velocity.y = beat.launch;
    }
    return outcome;
  }

  #processSuper(dt, world) {
    const definition = this.currentSuper;
    if (!definition) {
      this.#enterState(State.IDLE);
      return;
    }
    const frame = this.superFrame;
    this.velocity.set(0, 0, 0);

    if (definition.kind === 'rush' && frame < definition.hits.at(-1).frame) {
      const target = this.superTarget;
      const distance = target ? this.position.distanceTo(target.position) : Infinity;
      if (distance > definition.stopDistance) {
        this.velocity.x = Math.sin(this.moveYaw) * definition.speed;
        this.velocity.z = Math.cos(this.moveYaw) * definition.speed;
      }
    }
    if (definition.kind === 'pound') {
      const t = Math.min(1, this.stateTime * SUPER_RULES.fps / definition.startupFrames);
      this.position.y = ARENA.floorY + 4 * definition.leapHeight * t * (1 - t);
      this.onFloor = t >= 1 || t <= 0;
    }

    if (frame - this.superFxFrame >= SUPER_RULES.fxEveryFrames) {
      this.superFxFrame = frame;
      if (definition.kind === 'rush' || definition.kind === 'flurry') {
        this.#superEffect('afterimage', this.position);
      }
      if (
        definition.kind === 'column'
        && frame >= definition.startupFrames
        && frame <= definition.hits.at(-1).frame
      ) {
        // The ground remains visibly alight between its discrete damage ticks.
        this.#superEffect('sparks', this.superPoint);
        this.#superEffect('flash', this.superPoint);
      }
    }

    // Consume every crossed beat exactly once, even when dt skips a short window.
    while (
      this.superHitIndex < definition.hits.length
      && definition.hits[this.superHitIndex].frame <= frame
    ) {
      const index = this.superHitIndex++;
      const beat = definition.hits[index];
      let origin = this.position;
      let reach = definition.reach * this.reachScale;
      let radial = Boolean(definition.radial);
      let height = SUPER_RULES.height;

      if (definition.kind === 'flurry') {
        this.#superEffect('afterimage', this.position);
        const angle = definition.angles[index];
        this.position.copy(this.superPoint);
        this.position.x += Math.cos(angle) * definition.orbitRadius;
        this.position.z += Math.sin(angle) * definition.orbitRadius;
        this.#clampPosition(this.position);
        this.moveYaw = Math.atan2(
          this.superPoint.x - this.position.x, this.superPoint.z - this.position.z,
        );
        this.rotationY = this.moveYaw;
        this.facingSign = Math.sin(this.moveYaw) >= 0 ? 1 : -1;
        this.#superEffect('flash', this.position);
        reach = definition.strikeRadius;
      } else if (definition.kind === 'column') {
        origin = this.superPoint;
        reach = definition.strikeRadius;
        radial = true;
        height = beat.burn ? SUPER_RULES.height : definition.columnHeight;
        if (!beat.burn) {
          const top = origin.clone();
          top.y += definition.columnHeight;
          this.#superEffect('lightning', origin, {
            from: top, to: origin.clone(),
            start: top, end: origin.clone(),
            direction: new THREE.Vector3(0, 1, 0),
            length: definition.columnHeight,
          });
        }
      } else if (definition.kind === 'pound') {
        // Radius is explicitly arena-wide rather than a damage-weight proxy.
        reach = definition.reach;
        this.#superEffect('shockwave', origin, { radius: reach, scale: reach });
        this.#superEffect('dust', origin);
        this.animator.play('kick', { loop: false });
      } else if (definition.kind === 'thrust') {
        const tip = origin.clone().add(new THREE.Vector3(
          Math.sin(this.moveYaw) * reach, BODY.hitbox.offsetY,
          Math.cos(this.moveYaw) * reach,
        ));
        this.#superEffect('lightning', origin, {
          from: origin.clone(), to: tip, start: origin.clone(), end: tip, length: reach,
        });
      } else {
        this.animator.play('punch', { loop: false });
      }

      this.attackDamage = beat.damage * this.stats.damageScale;
      this.onSound(beat.burn ? 'projectileImpact' : definition.sound);
      this.alreadyHit.clear();
      this.hitboxLive = true;
      for (const other of world.fighters) {
        if (other === this || this.alreadyHit.has(other)) continue;
        if (!this.#superOverlaps(other, origin, reach, radial, height)) continue;
        this.alreadyHit.add(other);
        this.#superHit(other, origin, beat, world);
        // A counter or KO can interrupt us after the startup protection ends.
        if (this.state !== State.SUPER) return;
      }
      this.hitboxLive = false;
    }

    if (frame >= definition.durationFrames) {
      this.velocity.set(0, 0, 0);
      this.#enterState(State.IDLE);
    }
  }

  #isAirborne() {
    return !this.onFloor && this.position.y > ARENA.floorY;
  }

  #swingAudio() {
    return {
      phase: 'swing',
      speed: AUDIO.swingSpeed.referenceSeconds / this.swingLength,
    };
  }

  #tryBufferedAttack(dir) {
    const action = this.bufferedAttack;
    if (!action) return false;
    const airborne = this.#isAirborne();
    const punchState = PUNCH_STATE_FOR[action];
    this.bufferedAttack = null;
    this.attackBufferLeft = 0;
    this.inputHistory = [];
    if (airborne && AIR_STATE_FOR[action]) {
      this.#enterState(AIR_STATE_FOR[action]);
    } else if (punchState) {
      this.#enterState(punchState);
      if (airborne) this.attackKnocksDown = true;
    } else {
      const moving = dir.x !== 0 || dir.y !== 0;
      this.#enterState(this.#held('run') && moving ? State.DROPKICK : State.KICK);
    }
    this.airborneSwing = airborne;
    return true;
  }

  #processGrounded(dt) {
    const dir = this.#moveInput();
    const moving = dir.x !== 0 || dir.y !== 0;
    if (this.onFloor && this.#pressed('grab')) {
      this.inputHistory = [];
      this.#enterState(State.GRAB);
      return;
    }
    if (this.#held('block')) {
      this.velocity.x = 0; this.velocity.z = 0;
      this.#enterState(State.BLOCK);
      return;
    }
    if (this.#tryBufferedAttack(dir)) return;
    if (this.#pressed('dash')) {
      this.inputHistory = [];
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
    if (this.onFloor && this.velocity.y <= 0) {
      this.#enterState(State.IDLE);
      return;
    }
    const dir = this.#moveInput();
    if (dir.x !== 0 || dir.y !== 0) {
      const accel = MOVEMENT.acceleration * 2 * dt;
      this.velocity.x = moveToward(this.velocity.x, dir.x * MOVEMENT.jumpMoveSpeed, accel);
      this.velocity.z = moveToward(this.velocity.z, dir.y * MOVEMENT.jumpMoveSpeed, accel);
      this.#faceDirection(dir.x, dir.y, dt);
    }
    this.#tryBufferedAttack(dir);
  }

  #processSwing(dt, world) {
    if (this.currentMove) {
      this.#processMove(dt, world);
      return;
    }
    const airMove = AIR_MOVE_FOR[this.state];
    let activeStart = this.swingLength * (airMove?.hitWindowStart ?? COMBAT.hitWindowStart);
    let activeEnd = this.swingLength * (airMove?.hitWindowEnd ?? COMBAT.hitWindowEnd);
    if (this.state === State.DROPKICK) {
      activeStart = 0.1;
      activeEnd = COMBAT.dropkickLungeTime + 0.2;
      if (this.stateTime < COMBAT.dropkickLungeTime && !this.dropkickConnected) {
        this.velocity.x = Math.sin(this.rotationY) * COMBAT.dropkickLunge;
        this.velocity.z = Math.cos(this.rotationY) * COMBAT.dropkickLunge;
      } else this.#decelerate(dt * 1.5);
    } else this.#decelerate(dt * 1.5);

    if (this.state === State.DIVE_KICK) {
      this.velocity.y = Math.min(this.velocity.y, -COMBAT.diveKick.downSpeed);
    }
    const live = this.stateTime >= activeStart && this.stateTime <= activeEnd;
    if (live !== this.hitboxLive) {
      this.hitboxLive = live;
      if (live) this.alreadyHit.clear();
    }
    if (live) this.#resolveHits(world);
    if (
      !this.swingSoundPlayed
      && (this.stateTime > activeEnd || this.stateTime >= this.swingLength)
    ) {
      this.swingSoundPlayed = true;
      if (!this.swingConnected) this.onSound('whiff', this.#swingAudio());
    }
    if (this.stateTime >= this.swingLength) {
      this.hitboxLive = false;
      if (this.state === State.DIVE_KICK && !this.onFloor) return;
      this.#enterState(this.airborneSwing && !this.onFloor ? State.JUMP : State.IDLE);
    }
  }

  #processMove(dt, world) {
    const move = this.currentMove;
    const effects = move.effects;
    const activeEnd = move.startup + move.active;
    const live = this.stateTime >= move.startup && this.stateTime - dt < activeEnd;
    this.hitboxLive = live && move.damage > 0 && !effects.projectile;

    if (effects.speed && this.stateTime < activeEnd) {
      this.velocity.x = Math.sin(this.moveYaw) * effects.speed;
      this.velocity.z = Math.cos(this.moveYaw) * effects.speed;
    } else this.#decelerate(dt * 1.5);
    if (effects.dive && !this.onFloor) {
      this.velocity.y = Math.min(this.velocity.y, -effects.dive);
    }

    if (!this.moveActivated && this.stateTime >= move.startup) {
      this.moveActivated = true;
      this.#moveEffect(move, this.position);
      this.onSound(move.sound, this.#swingAudio());
      this.swingSoundPlayed = true;
      if (effects.teleport) {
        this.position.x += Math.sin(this.moveYaw) * effects.teleport;
        this.position.z += Math.cos(this.moveYaw) * effects.teleport;
        this.#clampPosition(this.position);
        this.#moveEffect(move, this.position);
      }
      if (effects.projectile) {
        const position = this.position.clone();
        position.x += Math.sin(this.moveYaw) * effects.projectile.offset;
        position.z += Math.cos(this.moveYaw) * effects.projectile.offset;
        this.projectiles.push({
          move, position, yaw: this.moveYaw,
          damage: this.attackDamage, life: effects.projectile.life, fxLeft: 0,
        });
      }
    }
    if (this.hitboxLive) {
      for (const other of world.fighters) {
        if (other === this || this.alreadyHit.has(other)) continue;
        if (effects.grab) {
          this.grabYaw = this.moveYaw;
          if (!this.#canGrab(other)) continue;
        } else if (!this.#moveOverlaps(other, move, this.position, this.moveYaw)) continue;
        this.alreadyHit.add(other);
        const outcome = this.#dealMoveHit(other, move, this.position, this.attackDamage);
        if (outcome) this.swingConnected = true;
      }
    }
    if (this.stateTime >= this.swingLength) {
      this.#enterState(this.airborneSwing && !this.onFloor
        ? State.JUMP : effects.finish ?? State.IDLE);
    }
  }

  #moveEffect(move, position) {
    const point = position.clone();
    point.y += BODY.hitbox.offsetY;
    this.onHitEffect(point, MOVE_RULES.colors[move.vfx]);
  }

  #moveOverlaps(other, move, origin, yaw, reach = move.reach * this.reachScale) {
    const height = MOVE_RULES.heights[move.hitHeight];
    if (
      origin.y + height.top < other.position.y
      || origin.y + height.bottom > other.position.y + BODY.height
    ) return false;
    if (
      move.hitHeight === 'high' && other.state === State.BLOCK
      && other.#moveInput().y > MOVE_RULES.directionThreshold
    ) return false;

    const dx = other.position.x - origin.x;
    const dz = other.position.z - origin.z;
    if (move.effects.radial) return Math.hypot(dx, dz) <= reach + BODY.hurtRadius;
    const forward = dx * Math.sin(yaw) + dz * Math.cos(yaw);
    const side = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    const nearestForward = Math.max(0, Math.min(forward, reach));
    const nearestSide = Math.max(-BODY.hitbox.halfWidth, Math.min(side, BODY.hitbox.halfWidth));
    return (forward - nearestForward) ** 2 + (side - nearestSide) ** 2
      <= BODY.hurtRadius ** 2;
  }

  #dealMoveHit(other, move, origin, damage) {
    const outcome = other.takeHit(damage, origin, move.knocksDown, move.knockback, {
      source: this, hitHeight: move.hitHeight, grab: Boolean(move.effects.grab),
      sound: move.sound, projectile: Boolean(move.effects.projectile),
    });
    if (outcome !== 'hit' && outcome !== 'block') return outcome;
    // Meter is awarded centrally from actual damage, never flat per move/contact.
    this.#moveEffect(move, other.position);
    if (outcome === 'hit' && move.effects.grab) {
      other.grabImmunityLeft = COMBAT.grab.immunitySeconds;
    }
    if (
      outcome === 'hit' && move.effects.launch && other.health.isAlive()
      && other.state === State.HIT
    ) {
      other.position.y = Math.max(other.position.y, ARENA.floorY + MOVE_RULES.launchLift);
      other.onFloor = false;
      other.juggleCount = 1;
      other.#enterState(State.JUGGLE);
      other.velocity.y = move.effects.launch;
    }
    return outcome;
  }

  #updateProjectiles(dt, world) {
    this.projectiles = this.projectiles.filter((projectile) => {
      const { move, position, yaw, damage } = projectile;
      const step = Math.min(dt, projectile.life);
      const distance = move.effects.projectile.speed * step;
      for (const other of world.fighters) {
        if (other === this) continue;
        if (!this.#moveOverlaps(other, move, position, yaw, distance + move.reach)) continue;
        if (this.#dealMoveHit(other, move, position, damage)) return false;
      }
      position.x += Math.sin(yaw) * distance;
      position.z += Math.cos(yaw) * distance;
      projectile.life -= step;
      projectile.fxLeft -= dt;
      if (projectile.fxLeft <= 0) {
        this.#moveEffect(move, position);
        projectile.fxLeft = MOVE_RULES.projectileFxSeconds;
      }
      return projectile.life > 0
        && Math.abs(position.x) <= ARENA.limitX
        && Math.abs(position.z) <= ARENA.limitZ;
    });
  }

  #processBlock(dt) {
    this.#decelerate(dt);
    if (this.onFloor && this.#pressed('grab')) {
      this.#enterState(State.GRAB);
      return;
    }
    if (!this.#held('block')) this.#enterState(State.IDLE);
  }

  #processDash(dt) {
    this.velocity.x = this.dashDir.x * COMBAT.dashSpeed;
    this.velocity.z = this.dashDir.z * COMBAT.dashSpeed;
    this.#faceDirection(this.dashDir.x, this.dashDir.z, dt);
    if (this.stateTime >= COMBAT.dashDuration) this.#enterState(State.IDLE);
  }

  #canGrab(other) {
    if (
      other === this || !this.onFloor || !other.onFloor
      || !other.health.isAlive() || other.invulnerable
      || other.grabImmunityLeft > 0 || other.heldBy || other.grabbedFighter
      || !GRABBABLE_STATES.has(other.state)
    ) return false;
    const grab = COMBAT.grab;
    if (Math.abs(this.position.y - other.position.y) > grab.heightTolerance) return false;
    const dx = other.position.x - this.position.x;
    const dz = other.position.z - this.position.z;
    if (Math.hypot(dx, dz) > grab.range) return false;
    const s = Math.sin(this.grabYaw);
    const c = Math.cos(this.grabYaw);
    const forward = dx * s + dz * c;
    const sideways = dx * c - dz * s;
    return forward > 0 && Math.abs(sideways) <= grab.halfWidth;
  }

  #processGrab(dt, world) {
    this.#decelerate(dt);
    if (this.grabAttempted || this.stateTime < this.grabStartup) return;
    this.grabAttempted = true;
    const victim = world.fighters.find((other) => this.#canGrab(other));
    if (!victim) {
      this.onSound('whiff');
      this.#enterState(State.GRAB_RECOVERY);
      return;
    }
    this.grabbedFighter = victim;
    victim.heldBy = this;
    this.#enterState(State.GRABBING);
    victim.#enterState(State.HELD);
    this.onSound('grab');
  }

  #processHolding() {
    this.velocity.set(0, 0, 0);
    const victim = this.grabbedFighter;
    if (!victim || victim.heldBy !== this || victim.state !== State.HELD) {
      this.#enterState(State.GRAB_RECOVERY);
      return;
    }
    if (this.stateTime >= COMBAT.grab.holdSeconds) {
      this.#enterState(State.GRAB_RECOVERY);
      return;
    }
    const punch = this.#pressed('attack') || this.#pressed('light') || this.#pressed('heavy');
    if (!punch) return;
    const dir = this.#moveInput();
    const forward = dir.x * Math.sin(this.grabYaw) + dir.y * Math.cos(this.grabYaw);
    if (Math.abs(forward) < COMBAT.grab.directionThreshold) return;
    const sign = Math.sign(forward);
    const throwX = Math.sin(this.grabYaw) * sign;
    const throwZ = Math.cos(this.grabYaw) * sign;
    this.#enterState(State.THROW);
    const outcome = victim.takeHit(
      this.attackDamage, this.position, this.attackKnocksDown, this.attackKnockback,
      { source: this, sound: 'throw', grab: true },
    );
    if (outcome === 'hit') {
      victim.velocity.x = throwX * this.attackKnockback + 0;
      victim.velocity.z = throwZ * this.attackKnockback + 0;
      this.swingConnected = true;
    }
  }

  #processHeld() {
    this.velocity.set(0, 0, 0);
    if (
      !this.heldBy || this.heldBy.grabbedFighter !== this
      || this.heldBy.state !== State.GRABBING
    ) {
      this.#enterState(State.IDLE);
      return;
    }
    const cutoff = this.stateTime - COMBAT.grab.mashWindowSeconds;
    this.mashTimes = this.mashTimes.filter((time) => time >= cutoff);
    if (COMBAT.grab.mashActions.some((action) => this.#pressed(action))) {
      this.mashTimes.push(this.stateTime);
    }
    if (this.mashTimes.length >= COMBAT.grab.mashPresses) this.#enterState(State.IDLE);
  }

  #releaseGrab() {
    const victim = this.grabbedFighter;
    const holder = this.heldBy;
    this.grabbedFighter = null;
    this.heldBy = null;
    this.mashTimes = [];
    if (victim) {
      victim.heldBy = null;
      victim.grabImmunityLeft = Math.max(victim.grabImmunityLeft, COMBAT.grab.immunitySeconds);
      if (victim.state === State.HELD) victim.#enterState(State.IDLE);
    }
    if (holder) {
      holder.grabbedFighter = null;
      this.grabImmunityLeft = Math.max(this.grabImmunityLeft, COMBAT.grab.immunitySeconds);
      if (holder.state === State.GRABBING) holder.#enterState(State.GRAB_RECOVERY);
    }
  }

  #resolveHits(world) {
    for (const other of world.fighters) {
      if (other === this || this.alreadyHit.has(other)) continue;
      if (!this.#hitboxOverlaps(other)) continue;
      this.alreadyHit.add(other);
      const outcome = other.takeHit(
        this.attackDamage, this.position, this.attackKnocksDown, this.attackKnockback,
        { source: this, sound: this.attackSound },
      );
      if (outcome) this.swingConnected = true;
      this.onAttackConnected();
    }
  }

  #hitboxOverlaps(other) {
    const box = BODY.hitbox;
    const boxLowY = this.position.y + box.offsetY - box.halfHeight;
    const boxHighY = this.position.y + box.offsetY + box.halfHeight;
    const bodyLowY = other.position.y;
    const bodyHighY = other.position.y + BODY.height;
    if (boxHighY < bodyLowY || boxLowY > bodyHighY) return false;
    const dx = other.position.x - this.position.x;
    const dz = other.position.z - this.position.z;
    const s = Math.sin(this.rotationY);
    const c = Math.cos(this.rotationY);
    const localX = dx * c - dz * s;
    const localZ = dx * s + dz * c;
    const nearestX = Math.max(-box.halfWidth, Math.min(localX, box.halfWidth));
    const offsetZ = box.offsetZ * this.reachScale;
    const halfDepth = box.halfDepth * this.reachScale;
    const nearestZ = Math.max(offsetZ - halfDepth, Math.min(localZ, offsetZ + halfDepth));
    const distSq = (localX - nearestX) ** 2 + (localZ - nearestZ) ** 2;
    return distSq <= BODY.hurtRadius ** 2;
  }

  #contactSound(meta, fallback, damage) {
    const source = meta.source;
    const eligible = source && damage > 0 && !meta.grab && !meta.projectile;
    const previous = source?.lastSoundHit;
    const age = previous ? source.inputClock - previous.time : Infinity;
    const traded = eligible && previous?.source === this
      && age >= 0 && age <= AUDIO.tradeSeconds;
    this.lastSoundHit = eligible ? { source, time: this.inputClock } : null;
    if (traded) {
      source.lastSoundHit = null;
      this.lastSoundHit = null;
    }
    this.onSound(traded ? 'clash' : fallback);
  }

  #applyCombatDamage(damage, meta) {
    const before = this.health.current;
    this.health.applyDamage(damage);
    const removed = Math.max(0, before - this.health.current);
    this.meter = fillMeter(this.meter, removed, 'taken');
    if (meta.source && meta.source !== this) {
      meta.source.meter = fillMeter(meta.source.meter, removed, 'dealt');
    }
  }

  /** Returns hit/block/armor/parry, or undefined if ignored. */
  takeHit(damage, fromPosition, knocksDown = false, knockback = COMBAT.knockbackForce, meta = {}) {
    if (this.state === State.KO || this.state === State.KNOCKDOWN || this.state === State.GETUP) return;
    if (this.invulnerable) return;

    const signature = this.currentSuper;
    if (
      this.state === State.SUPER && signature?.kind === 'counter'
      && this.superFrame >= signature.startupFrames
      && this.superFrame < signature.counterEndFrame
      && !this.superCountered && !meta.counterPunish && meta.source
      && this.#superOverlaps(meta.source, this.position, signature.reach, true)
    ) {
      this.superCountered = true;
      this.onSound('parry');
      this.#superEffect('shockwave', this.position, { radius: signature.reach });
      this.animator.play('punch', { loop: false });
      this.#superHit(meta.source, this.position, signature.punish, this.superWorld, true);
      return 'parry';
    }

    const move = this.currentMove;
    const active = move && this.stateTime >= move.startup
      && this.stateTime < move.startup + move.active;
    const front = Math.sign(fromPosition.x - this.position.x);
    if (active && move.effects.teleport && !meta.grab) return;
    if (active && move.effects.parry && !meta.grab && (front === this.facingSign || front === 0)) {
      const source = meta.source;
      const approach = source
        ? source.velocity.x * (this.position.x - source.position.x)
          + source.velocity.z * (this.position.z - source.position.z)
        : 0;
      if (!move.effects.approachesOnly || approach > MOVE_RULES.approachSpeed) {
        const punish = MOVES[this.character].find((entry) => entry.id === move.effects.parry);
        this.onSound('parry');
        this.#moveEffect(move, this.position);
        if (punish) this.#startMove(punish);
        return 'parry';
      }
    }
    if (move && this.stateTime < move.startup && this.moveArmor > 0 && !meta.grab) {
      this.moveArmor -= 1;
      this.#applyCombatDamage(damage / this.stats.defenceScale, meta);
      this.#contactSound(meta, 'block', damage);
      this.#moveEffect(move, this.position);
      return 'armor';
    }

    let awayX = this.position.x - fromPosition.x;
    let awayZ = this.position.z - fromPosition.z;
    const len = Math.hypot(awayX, awayZ);
    if (len < 0.001) { awayX = -this.facingSign; awayZ = 0; }
    else { awayX /= len; awayZ /= len; }

    let blocked = false;
    if (this.state === State.BLOCK && !meta.grab && !meta.pierceBlock) {
      const side = Math.sign(fromPosition.x - this.position.x);
      if (side === this.facingSign || side === 0) blocked = true;
      if (meta.hitHeight === 'low' && this.#moveInput().y <= MOVE_RULES.directionThreshold) {
        blocked = false;
      }
    }
    let finalDamage = (blocked
      ? Math.round(damage * COMBAT.blockDamageMult)
      : damage) / this.stats.defenceScale;
    const airborneHit = !blocked && finalDamage > 0
      && this.health.isAlive() && this.#isAirborne();
    if (airborneHit) {
      this.juggleCount += 1;
      finalDamage *= Math.max(
        COMBAT.juggle.minDamageScale,
        COMBAT.juggle.damageDecay ** (this.juggleCount - 1),
      );
    }
    if (!blocked && finalDamage > 0 && this.health.isAlive()) {
      this.comboCount = this.comboTimeLeft > 0 ? this.comboCount + 1 : 1;
      this.comboTimeLeft = COMBAT.comboWindowSeconds;
    }
    this.#applyCombatDamage(finalDamage, meta);
    if (blocked) this.onSound('block');
    else this.#contactSound(meta, meta.sound ?? 'hit', finalDamage);
    const fx = new THREE.Vector3(
      THREE.MathUtils.lerp(this.position.x, fromPosition.x, 0.4),
      THREE.MathUtils.lerp(this.position.y, fromPosition.y, 0.4) + 1.1,
      THREE.MathUtils.lerp(this.position.z, fromPosition.z, 0.4),
    );
    if (blocked) {
      this.onHitEffect(fx, 0x80b3ff);
      this.velocity.x = awayX * COMBAT.blockPushback;
      this.velocity.z = awayZ * COMBAT.blockPushback;
      if (this.health.isAlive()) this.#enterState(State.BLOCK);
      return 'block';
    }
    this.onHitEffect(fx, 0xffd94d);
    this.velocity.x = awayX * knockback;
    this.velocity.z = awayZ * knockback;
    if (!this.health.isAlive()) return 'hit';
    if (airborneHit) {
      if (this.juggleCount >= COMBAT.juggle.limit) {
        this.velocity.y = Math.min(this.velocity.y, -COMBAT.juggle.endFallSpeed);
        this.#enterState(State.KNOCKDOWN);
      } else {
        this.velocity.y = 0;
        this.#enterState(State.JUGGLE);
      }
    } else this.#enterState(knocksDown ? State.KNOCKDOWN : State.HIT);
    return 'hit';
  }

  onAttackConnected() {
    if (this.state === State.DROPKICK) {
      this.dropkickConnected = true;
      this.velocity.x = 0;
      this.velocity.z = 0;
    }
  }

  #clampPosition(position) {
    position.x = THREE.MathUtils.clamp(position.x, -ARENA.limitX, ARENA.limitX);
    position.z = THREE.MathUtils.clamp(position.z, -ARENA.limitZ, ARENA.limitZ);
  }

  #integrate(dt, world) {
    const wasAboveFloor = this.position.y > ARENA.floorY;
    this.position.addScaledVector(this.velocity, dt);
    if (this.position.y <= ARENA.floorY) {
      this.position.y = ARENA.floorY;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.onFloor = true;
      if (wasAboveFloor) this.onSound('land');
      this.juggleCount = 0;
      if (
        this.state === State.JUMP || this.state === State.JUGGLE
        || AIR_MOVE_FOR[this.state]
        || (this.airborneSwing && SWING_STATES.has(this.state))
      ) {
        this.bufferedAttack = null;
        this.attackBufferLeft = 0;
        this.inputHistory = [];
        this.#enterState(State.IDLE);
      }
    } else this.onFloor = false;

    for (const other of world.fighters) {
      if (other === this || other === this.heldBy || other === this.grabbedFighter) continue;
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
    this.#clampPosition(this.position);
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

  #enterState(next, authoredMove = null) {
    if (next === this.state && LOOPING_STATES.has(next)) return;
    if (
      (this.state === State.GRABBING && next !== State.GRABBING)
      || (this.state === State.HELD && next !== State.HELD)
    ) this.#releaseGrab();
    if (
      next === State.IDLE
      && (this.state === State.HIT || this.state === State.GETUP || this.state === State.JUGGLE)
    ) {
      this.comboCount = 0;
      this.comboTimeLeft = 0;
    }
    if (next === State.IDLE && this.state === State.GETUP) {
      this.invulnerableLeft = COMBAT.reaction.getupInvulnerable;
    }
    if (
      next === State.HIT || next === State.JUGGLE || next === State.SUPER
      || next === State.KNOCKDOWN || next === State.KO || GRAB_STATES.has(next)
    ) {
      this.bufferedAttack = null;
      this.attackBufferLeft = 0;
      this.inputHistory = [];
    }
    if (next === State.KO) {
      this.projectiles = [];
      if (this.state !== State.KO) this.onSound('ko');
    }
    this.currentMove = authoredMove;
    this.moveArmor = authoredMove?.effects.armor ?? 0;
    this.moveActivated = false;
    this.currentSuper = next === State.SUPER ? SUPER_DATA[this.character] : null;
    if (next !== State.SUPER) {
      this.superWorld = null;
      this.superTarget = null;
      this.superPoint = null;
      this.superOrigin = null;
    }
    this.state = next;
    this.stateTime = 0;
    if (!SWING_STATES.has(next)) {
      this.hitboxLive = false;
      this.airborneSwing = false;
    }

    const airMove = AIR_MOVE_FOR[next];
    const punch = next === State.LIGHT_ATTACK
      ? COMBAT.lightAttack
      : next === State.HEAVY_ATTACK ? COMBAT.heavyAttack : null;
    let speed = punch ? punch.speed : next === State.KNOCKDOWN ? COMBAT.knockdownSpeed : 1;

    if (next === State.GRAB) {
      const jabClip = STATE_CLIP[State.LIGHT_ATTACK];
      const jabLength = this.animator.has(jabClip)
        ? this.animator.length(jabClip) : COMBAT.attackDuration;
      this.grabStartup = Math.max(
        COMBAT.grab.startupSeconds,
        jabLength / COMBAT.lightAttack.speed * COMBAT.hitWindowStart
          + COMBAT.grab.jabStartupMargin,
      );
      this.grabAttempted = false;
      this.grabYaw = this.rotationY;
      this.velocity.x = 0;
      this.velocity.z = 0;
    }
    if (next === State.GRABBING || next === State.HELD) {
      this.velocity.set(0, 0, 0);
      this.mashTimes = [];
    }
    if (next === State.THROW) {
      this.attackDamage = COMBAT.grab.damage * this.stats.damageScale;
      this.attackKnockback = COMBAT.grab.knockback;
      this.attackKnocksDown = true;
      this.attackSound = 'throw';
      this.swingConnected = false;
      this.alreadyHit.clear();
    }
    if (SWING_STATES.has(next)) {
      this.attackSound = AUDIO.legacySounds[next] ?? 'hit';
      let fallback = COMBAT.attackDuration;
      if (airMove) {
        this.attackKnocksDown = airMove.knocksDown;
        this.attackDamage = airMove.damage;
        this.attackKnockback = airMove.knockback;
        fallback = airMove.duration;
      } else if (punch || next === State.ATTACK) {
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
      this.attackDamage *= this.stats.damageScale;
      const clip = STATE_CLIP[next];
      const clipLength = this.animator.has(clip) ? this.animator.length(clip) : fallback;
      if (airMove) {
        this.swingLength = airMove.duration;
        speed = clipLength / this.swingLength;
      } else this.swingLength = clipLength / speed;
      if (next === State.DROPKICK) {
        this.swingLength = Math.max(0.2, this.swingLength - COMBAT.dropkickStartOffset);
      }
      if (next === State.DIVE_KICK) {
        this.velocity.y = Math.min(this.velocity.y, -COMBAT.diveKick.downSpeed);
      }
      this.alreadyHit.clear();
      this.hitboxLive = false;
      this.swingConnected = false;
      this.swingSoundPlayed = false;
    }
    if (
      next === State.HIT || next === State.JUGGLE
      || next === State.KNOCKDOWN || next === State.GETUP
    ) {
      this.reactionLength = this.#reactionWindow(next);
      const clipName = STATE_CLIP[next];
      if (this.animator.has(clipName) && this.reactionLength > 0) {
        speed = THREE.MathUtils.clamp(
          this.animator.length(clipName) / this.reactionLength,
          0.25, COMBAT.reaction.maxClipSpeed,
        );
      }
    }
    if (authoredMove) {
      this.attackDamage = authoredMove.damage * this.stats.damageScale;
      this.attackKnockback = authoredMove.knockback;
      this.attackKnocksDown = authoredMove.knocksDown;
      this.attackSound = authoredMove.sound;
      this.swingLength = authoredMove.startup + authoredMove.active + authoredMove.recovery;
      this.airborneSwing = this.#isAirborne();
      this.moveYaw = this.rotationY;
      speed = authoredMove.clipSpeed;
    }
    if (next === State.SUPER) {
      this.superHitIndex = 0;
      this.superCountered = false;
      this.superConnected = false;
      this.superFxFrame = -Infinity;
      this.swingConnected = false;
      this.swingSoundPlayed = true;
      this.alreadyHit.clear();
      this.moveYaw = this.rotationY;
      this.velocity.set(0, 0, 0);
      this.swingLength = this.currentSuper.durationFrames / SUPER_RULES.fps;
      this.attackDamage = this.currentSuper.damage * this.stats.damageScale;
      this.attackKnockback = SUPER_RULES.defaultKnockback;
      this.attackKnocksDown = false;
      this.attackSound = this.currentSuper.sound;
    }
    const clip = this.currentSuper?.clip ?? authoredMove?.clip ?? STATE_CLIP[next];
    // Only the drop kick starts its clip part-way in — its hit window is
    // measured from after the wind-up. Sending startAt: 0 for every other
    // state changes the options object every animator caller compares against,
    // for no behavioural gain.
    const startAt = next === State.DROPKICK ? COMBAT.dropkickStartOffset : 0;
    this.animator.play(clip, {
      loop: LOOPING_STATES.has(next),
      speed,
      ...(startAt > 0 ? { startAt } : {}),
    });
    this.onStateChanged?.(next);
  }

  #moveInput() {
    return this.controller?.move?.() ?? { x: 0, y: 0 };
  }

  #pressed(action) { return this.inputEdges.has(action); }
  #held(action) { return Boolean(this.controller?.held?.(action)); }
}
