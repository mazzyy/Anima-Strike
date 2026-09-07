/**
 * Every tunable, in one place — the JS equivalent of the @export blocks that
 * used to live on the Fighter node in the Godot inspector. Values are carried
 * over unchanged so the game feels the same as it did before the port.
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
  attackDuration: 0.45,   // fallback when a clip has no length
  hitWindowStart: 0.35,   // fraction of the swing where the hitbox goes live
  hitWindowEnd: 0.6,
  attackDamage: 8,
  hitStun: 0.35,
  knockbackForce: 6.0,

  kickDuration: 0.6,
  kickDamage: 14,
  kickKnockback: 4.0,

  dropkickDamage: 18,
  dropkickKnockback: 14.0,
  dropkickLunge: 11.0,
  dropkickLungeTime: 0.45,
  dropkickStartOffset: 0.8,  // skip the clip's run-up slide

  dashSpeed: 14.0,
  dashDuration: 0.22,

  blockDamageMult: 0.15,
  blockPushback: 2.0,
  knockdownDuration: 0.8,
  getupDuration: 0.6,
  knockdownSpeed: 1.8,      // playback rate of the fall
};

/** Collision volumes, already multiplied by SCALE (from Player.tscn). */
export const BODY = {
  radius: 0.35 * SCALE,
  height: 1.8 * SCALE,
  centerY: 0.9 * SCALE,
  hurtRadius: 0.4 * SCALE,
  hitbox: {
    // Box in front of the fighter: width x height x depth, offset forward.
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
 * If the knight runs backwards, flip this to Math.PI. It depends on which way
 * the character mesh faces in its own .glb, which varies with how it was
 * exported. Nothing else needs to change.
 */
export const MODEL_YAW_OFFSET = 0;

/** Clip names -> renderer/assets/<name>.glb, written by tools/setup-assets.mjs. */
export const CLIPS = [
  'idle', 'walk', 'run', 'jump', 'punch', 'kick', 'dropkick',
  'hit', 'block', 'dash', 'knockdown', 'getup', 'death',
];

/** Which clip each state plays. */
export const STATE_CLIP = {
  IDLE: 'idle',
  WALK: 'walk',
  RUN: 'run',
  JUMP: 'jump',
  ATTACK: 'punch',
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
  thinkInterval: 3.0,
  reactionDelay: 0.12,
  attackRange: 1.9,
  spacingRange: 3.2,
};
