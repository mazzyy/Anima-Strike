/**
 * Every tunable, in one place — the JS equivalent of the @export blocks that
 * used to live on the Fighter node in the Godot inspector.
 */

/** Players were instanced at 1.4x in Arena.tscn; collision shapes scaled with them. */
export const SCALE = 1.4;

export const MOVEMENT = {
  walkSpeed: 4.0,
  runSpeed: 7.0,
  acceleration: 40.0,
  friction: 50.0,
  jumpVelocity: 7.0,
  jumpMoveSpeed: 6.0,
  gravity: 20.0,
  turnSpeed: 16.0,
};

export const COMBAT = {
  attackBufferSeconds: 0.15,
  comboWindowSeconds: 1.2,

  // Unscaled punch duration when the clip is missing. Legacy attack values
  // remain available for controllers still emitting the old 'attack' action.
  attackDuration: 0.45,
  hitWindowStart: 0.35,
  hitWindowEnd: 0.6,
  attackDamage: 8,
  hitStun: 0.35,
  knockbackForce: 6.0,

  // Speed scales the entire punch: startup, active window, and recovery.
  // A missing punch clip uses attackDuration / speed for the same timing.
  lightAttack: {
    speed: 1.5,
    damage: 5,
    knockback: 4.0,
  },
  heavyAttack: {
    speed: 0.75,
    damage: 16,
    knockback: 10.0,
  },

  kickDuration: 0.6,
  kickDamage: 14,
  kickKnockback: 4.0,

  dropkickDamage: 18,
  dropkickKnockback: 14.0,
  dropkickLunge: 11.0,
  dropkickLungeTime: 0.45,
  dropkickStartOffset: 0.8,

  dashSpeed: 14.0,
  dashDuration: 0.22,

  blockDamageMult: 0.15,
  blockPushback: 2.0,
  knockdownDuration: 0.8,
  getupDuration: 0.6,
  knockdownSpeed: 1.8,
};

/** Durations use wall-clock seconds, never the scaled simulation clock. */
export const IMPACT = {
  hitStopSeconds: 0.06,
  koTimeScale: 0.35,
  koSeconds: 1.0,
  maxFrameSeconds: 1 / 20,
};

/** Procedural audio envelopes use seconds on the Web Audio clock. */
export const AUDIO = {
  muteKey: 'KeyM',
  masterVolume: 0.22,
  maxVoices: 6,
  noiseBufferSeconds: 1,
  fadeSeconds: 0.008,
  envelopeFloor: 0.0001,
  sounds: {
    hit: {
      noise: {
        filter: 'lowpass', q: 0.7,
        fromHz: 3200, toHz: 900,
        volume: 0.3, attack: 0.003, duration: 0.085,
      },
      tone: {
        fromHz: 145, toHz: 55,
        volume: 0.4, attack: 0.004, duration: 0.13,
      },
    },
    block: {
      noise: {
        filter: 'lowpass', q: 0.7,
        fromHz: 750, toHz: 280,
        volume: 0.15, attack: 0.006, duration: 0.1,
      },
      tone: {
        fromHz: 90, toHz: 45,
        volume: 0.3, attack: 0.006, duration: 0.14,
      },
    },
    whiff: {
      noise: {
        filter: 'bandpass', q: 0.7,
        fromHz: 600, toHz: 2200,
        volume: 0.24, attack: 0.035, duration: 0.16,
      },
    },
    land: {
      noise: {
        filter: 'lowpass', q: 0.7,
        fromHz: 450, toHz: 150,
        volume: 0.18, attack: 0.004, duration: 0.1,
      },
      tone: {
        fromHz: 95, toHz: 38,
        volume: 0.48, attack: 0.006, duration: 0.18,
      },
    },
  },
};

/** M is reserved for master mute; Player 2's kick uses V. */
export const INPUT_MAPS = {
  p1: {
    up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD',
    jump: 'Space', run: 'ShiftLeft', light: 'KeyJ', heavy: 'KeyI',
    kick: 'KeyK', block: 'KeyL', dash: 'KeyU',
  },
  p2: {
    up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
    jump: 'Slash', run: 'Comma', light: 'Period', heavy: 'KeyH',
    kick: 'KeyV', block: 'KeyN', dash: 'KeyB',
  },
};

/** Collision volumes, already multiplied by SCALE (from Player.tscn). */
export const BODY = {
  radius: 0.35 * SCALE,
  height: 1.8 * SCALE,
  centerY: 0.9 * SCALE,
  hurtRadius: 0.4 * SCALE,
  hitbox: {
    halfWidth: (0.7 / 2) * SCALE,
    halfHeight: (1.0 / 2) * SCALE,
    halfDepth: (0.9 / 2) * SCALE,
    offsetY: 0.9 * SCALE,
    offsetZ: 0.7 * SCALE,
  },
};

/** Arena bounds, from the StaticBody walls in Arena.tscn (inner faces at ±2.75). */
export const ARENA = {
  floorY: 0,
  limitX: 2.75 - BODY.radius,
  limitZ: 2.75 - BODY.radius,
  spawnP1: { x: -2, y: 1, z: 0 },
  spawnP2: { x: 2, y: 1, z: 0 },
  camera: { x: 0, y: 10, z: 9.5, pitchDeg: -38, fov: 40 },
};

export const HEALTH = { max: 100 };

/**
 * Defaults copied into each Fighter; constructor stats may override any field.
 * jumpSpeed is vertical takeoff velocity, not horizontal airborne movement.
 * defenceScale must be positive; damageScale may be zero.
 */
export const FIGHTER_STATS = {
  maxHealth: HEALTH.max,
  walkSpeed: MOVEMENT.walkSpeed,
  runSpeed: MOVEMENT.runSpeed,
  jumpSpeed: MOVEMENT.jumpVelocity,
  damageScale: 1,
  defenceScale: 1,
};

/** Match structure. A round ends on a KO or when the clock runs out. */
export const ROUNDS = {
  seconds: 60,
  toWin: 2,
  intermissionSeconds: 2.5,
};

/**
 * Follow the fighters' ground-plane midpoint and dolly backward as they
 * separate. Tracking offsets are also clamped to ARENA.limitX/limitZ.
 */
export const CAMERA = {
  track: true,
  followX: 1.0,
  followZ: 1.0,
  maxOffsetX: 2.2,
  maxOffsetZ: 2.2,
  zoomPerUnit: 0.55,
  maxPull: 4.5,
  restSeparation: 2.5,
  damping: 3.5,
  koPush: 0.8,
};

/**
 * If the knight runs backwards, flip this to Math.PI.
 */
export const MODEL_YAW_OFFSET = 0;

/** Clip names -> renderer/assets/<name>.glb, written by tools/setup-assets.mjs. */
export const CLIPS = [
  'idle', 'walk', 'run', 'jump', 'punch', 'kick', 'dropkick',
  'hit', 'block', 'dash', 'knockdown', 'getup', 'death',
];

/** Which clip each state plays. Both punch variants currently share a clip. */
export const STATE_CLIP = {
  IDLE: 'idle',
  WALK: 'walk',
  RUN: 'run',
  JUMP: 'jump',
  ATTACK: 'punch',
  LIGHT_ATTACK: 'punch',
  HEAVY_ATTACK: 'punch',
  KICK: 'kick',
  DROPKICK: 'dropkick',
  HIT: 'hit',
  BLOCK: 'block',
  DASH: 'dash',
  KNOCKDOWN: 'knockdown',
  GETUP: 'getup',
  KO: 'death',
};

export const LOOPING_STATES = new Set(['IDLE', 'WALK', 'RUN', 'BLOCK']);

export const AI = {
  baseAggression: 0.5,
  thinkInterval: 0.12,
  attackRange: 1.9,
  spacingRange: 3.2,
  preferredAttackChance: 0.65,

  // Model aggression is an adjustment around its neutral aggression value,
  // rather than a replacement for the selected difficulty's base.
  planAggressionNeutral: 0.5,
  planAggressionWeight: 1.0,
};

export const DIFFICULTIES = {
  easy: {
    label: 'Easy',
    baseAggression: 0.25,
    thinkInterval: 5.0,
  },
  normal: {
    label: 'Normal',
    baseAggression: AI.baseAggression,
    thinkInterval: AI.thinkInterval,
  },
  hard: {
    label: 'Hard',
    baseAggression: 0.85,
    thinkInterval: 1.5,
  },
};

export const MENU = {
  defaultDifficulty: 'normal',
};
