/**
 * Every tunable, in one place.
 */
export const SCALE = 1.4;

export const MOVEMENT = {
  walkSpeed: 4.0, runSpeed: 7.0, acceleration: 40.0, friction: 50.0,
  jumpVelocity: 7.0, jumpMoveSpeed: 6.0, gravity: 20.0, turnSpeed: 16.0,
};

export const COMBAT = {
  attackBufferSeconds: 0.15,
  comboWindowSeconds: 1.2,
  attackDuration: 0.45,
  hitWindowStart: 0.35,
  hitWindowEnd: 0.6,
  attackDamage: 8,
  hitStun: 0.35,
  knockbackForce: 6.0,
  lightAttack: { speed: 1.5, damage: 5, knockback: 4.0 },
  heavyAttack: { speed: 0.75, damage: 16, knockback: 10.0 },
  airLightAttack: {
    duration: 0.30, hitWindowStart: 0.20, hitWindowEnd: 0.65,
    damage: 5, knockback: 2.0, knocksDown: false,
  },
  airHeavyAttack: {
    duration: 0.44, hitWindowStart: 0.25, hitWindowEnd: 0.70,
    damage: 13, knockback: 3.0, knocksDown: false,
  },
  diveKick: {
    duration: 0.35, hitWindowStart: 0, hitWindowEnd: 1,
    damage: 16, knockback: 5.0, knocksDown: true, downSpeed: 9.0,
  },
  juggle: {
    limit: 4, floatSeconds: 0.18, damageDecay: 0.75,
    minDamageScale: 0.25, endFallSpeed: 6.0,
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
  reaction: {
    hitStun: 0.28, comboDecay: 0.82, minHitStun: 0.12,
    knockdown: 0.85, getup: 0.45, getupInvulnerable: 0.55,
    maxClipSpeed: 3.0,
  },
  grab: {
    range: 1.25, halfWidth: 0.6, heightTolerance: 0.25,
    startupSeconds: 0.3, jabStartupMargin: 0.08,
    recoverySeconds: 0.3, holdSeconds: 1.1, throwRecoverySeconds: 0.4,
    damage: 20, knockback: 12, directionThreshold: 0.35,
    immunitySeconds: 1.0, mashWindowSeconds: 0.45, mashPresses: 5,
    mashActions: ['attack', 'light', 'heavy', 'kick', 'grab', 'jump', 'dash', 'block'],
  },
};

/**
 * Command timestamps and all move durations are simulation seconds.
 * A neutral sample separates taps but is not part of a command.
 * Diagonals never skip wrong directions.
 */

export const MOVE_RULES = {
  commandSeconds: 0.65,
  stepSeconds: 0.24,
  attackBufferSeconds: undefined,
  historyLimit: 32,
  directionThreshold: 0.35,
  maxDuration: 2,
  buttonBufferSeconds: COMBAT.attackBufferSeconds,
  // Retained for compatibility with move-table consumers; live meter uses METER.
  meterMax: 100,
  launchLift: 0.08,
  approachSpeed: 0.5,
  projectileFxSeconds: 0.06,
  heights: {
    low: { bottom: 0, top: 0.7 },
    mid: { bottom: 0.35, top: 1.9 },
    high: { bottom: 1.0, top: 3.4 },
    air: { bottom: -0.5, top: 1.8 },
  },
  colors: {
    impact: 0xffd94d, shockwave: 0xc9ad85, flash: 0x70edbd,
    reach: 0xb69aff, guard: 0x80b3ff, flame: 0xff6633,
  },
  defaults: {
    knocksDown: false, hitHeight: 'mid', meterGain: 3,
    vfx: 'impact', sound: 'whiff', clip: 'punch', clipSpeed: 1,
    airborne: false, followupOnly: false,
  },
};

/**
 * [id, name, input, startup, active, recovery, damage, knockback, reach, options]
 * Reach is ground-plane metres, multiplied by roster reachScale for melee.
 * The audio authoring section below assigns each row its unique sound ID.
 */

export const IMPACT = {
  hitStopSeconds: 0.06, koTimeScale: 0.35, koSeconds: 1.0, maxFrameSeconds: 1 / 20,
};

/** Cosmetic lifetimes use the same simulation clock as fighter/projectile motion. */

export const VFX = {
  poolCap: 64,
  textureSize: 32,
  radialSegments: 5,
  glowPower: 1.8,
  coreWhiteMix: 0.75,
  haloScale: 2.5,
  haloOpacity: 0.45,
  life: {
    flash: 0.12, sparks: 0.28, shockwave: 0.5, lightning: 0.36,
    projectile: 0.9, afterimage: 0.2, dust: 0.4,
  },
  weights: [
    { max: 8, color: 0xfff4a3 },
    { max: 20, color: 0xffb347 },
    { max: 32, color: 0xff583d },
    { max: Infinity, color: 0xdd85ff },
  ],
  weightScale: { base: 0.65, divisor: 35, min: 0.65, max: 2 },
  flash: { startSize: 0.4, expansion: 1.7 },
  sparks: {
    count: 12, forward: 1.5, lift: 1.2,
    speedMin: 5, speedRange: 6, gravity: 12,
    streakSeconds: 0.035, width: 0.018,
  },
  ring: {
    innerRadius: 0.9, segments: 64,
    floorLift: 0.045, startSize: 0.25, expansion: 3.2,
  },
  lightning: {
    segments: 16, branches: 3, branchSegments: 2,
    length: 2.6, jitter: 0.3, regenerateSeconds: 0.12,
    width: 0.015, glowWidth: 0.075, glowOpacity: 0.18,
  },
  projectile: {
    speed: 11, coreSize: 0.8, tailWidth: 0.1,
    tailSegments: 6, tailSampleSeconds: 0.025,
  },
  afterimage: {
    count: 3, spacing: 0.3, lifeStep: 0.035, opacity: 0.24,
    maxMeshes: 12, maxVertices: 60000,
  },
  dust: {
    count: 5, color: 0xc9bda7, floorLift: 0.12,
    speed: 1.5, rise: 0.8, directionBias: 0.6,
    startSize: 0.3, expansion: 1.2, opacity: 0.4,
  },
  landing: { heavySpeed: 8, shakeWeight: 0.65 },
  shake: {
    seconds: 0.2, weightUnit: 20, strength: 0.1, maxStrength: 0.24,
    blockMultiplier: 0.25, decayPower: 2,
    frequencyX: 145, frequencyY: 183, vertical: 0.65,
  },
};

export const INPUT_MAPS = {
  p1: {
    up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD',
    jump: 'Space', run: 'ShiftLeft', light: 'KeyJ', heavy: 'KeyI',
    kick: 'KeyK', block: 'KeyL', dash: 'KeyU', grab: 'KeyO', super: 'KeyP',
  },
  p2: {
    up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
    jump: 'Slash', run: 'Comma', light: 'Period', heavy: 'KeyH',
    kick: 'KeyV', block: 'KeyN', dash: 'KeyB', grab: 'KeyC', super: 'KeyG',
  },
};

export const BODY = {
  radius: 0.35 * SCALE, height: 1.8 * SCALE,
  centerY: 0.9 * SCALE, hurtRadius: 0.4 * SCALE,
  hitbox: {
    halfWidth: (0.7 / 2) * SCALE, halfHeight: (1.0 / 2) * SCALE,
    halfDepth: (0.9 / 2) * SCALE, offsetY: 0.9 * SCALE, offsetZ: 0.7 * SCALE,
  },
};

export const MAP_ART = {
  floorWidth: 48, floorDepth: 14, edgeMargin: 0.9, floorThickness: 1,
  roughness: 0.85, surfaceLift: 0.015, deckSink: 0.05,
  radialSegments: 16, sphereRows: 10, boundaryWidth: 0.035,
  boundaryOpacity: 0.4, repeatJitter: 0.06, detailVariation: 0.15, meshBudget: 128,
  shadow: {
    size: 2048, near: 0.5, far: 120, extent: 32,
    lightDistanceScale: 3, bias: -0.0009,
  },
  maxPropLights: 4,
};

export const ARENA = {
  floorY: 0,
  limitX: MAP_ART.floorWidth / 2 - MAP_ART.edgeMargin - BODY.radius,
  limitZ: MAP_ART.floorDepth / 2 - MAP_ART.edgeMargin - BODY.radius,
  spawnP1: { x: -MAP_ART.floorWidth / 8, y: 1, z: 0 },
  spawnP2: { x: MAP_ART.floorWidth / 8, y: 1, z: 0 },
  camera: { x: 0, y: 10, z: 9.5, pitchDeg: -38, fov: 40, near: 1, far: 220 },
};

/**
 * Pass order is also the allocation policy: absent passes own no resources.
 * Grading and OutputPass stay enabled on every tier.
 * Timing uses milliseconds of real presentation time, not simulation time.
 */

export const POST = {
  initialTier: 'medium',
  warmupMs: 250,
  sampleMs: 1750,
  emergencyWindowMs: 400,
  emergencyFrameMs: 45,
  initialFrameMs: { high: 18, medium: 28 },
  sustainedFrameMs: { high: 22, medium: 32 },
  contrastPivot: 0.18,
  ao: { radius: 0.65, thickness: 0.5, scale: 0.9, samples: 8 },
  tiers: {
    high: {
      passes: ['render', 'bloom', 'ao', 'fxaa', 'vignette', 'saturation', 'tint', 'output'],
      maxPixelRatio: 1.5,
      resolutionScale: 1,
    },
    medium: {
      passes: ['render', 'bloom', 'fxaa', 'vignette', 'saturation', 'tint', 'output'],
      maxPixelRatio: 1.25,
      resolutionScale: 0.85,
    },
    low: {
      passes: ['render', 'fxaa', 'vignette', 'saturation', 'tint', 'output'],
      maxPixelRatio: 1,
      resolutionScale: 0.7,
    },
  },
  gradeRanges: {
    bloom: { strength: [0, 3], radius: [0, 1], threshold: [0, 2] },
    exposure: [0.25, 2.5],
    vignette: [0, 0.75],
    saturation: [-1, 0.5],
    tint: [0.5, 1.5],
    contrast: [0.5, 1.5],
  },
};

export const HEALTH = { max: 100 };

export const FIGHTER_STATS = {
  maxHealth: HEALTH.max,
  walkSpeed: MOVEMENT.walkSpeed, runSpeed: MOVEMENT.runSpeed,
  jumpSpeed: MOVEMENT.jumpVelocity, damageScale: 1, defenceScale: 1,
};

export const CHARACTER_ROSTER = [
  {
    id: 'axel', name: 'Axel', tagline: 'Balanced tools. No bad matchups.',
    tint: 0x80b3ff, scale: SCALE, stats: { ...FIGHTER_STATS }, special: 'rising-strike',
  },
  {
    id: 'rook', name: 'Rook', tagline: 'Slow feet. Heavy hands.',
    tint: 0xd58a54, scale: SCALE * 1.1,
    stats: {
      maxHealth: 130, walkSpeed: 2.8, runSpeed: 4.8, jumpSpeed: 5.5,
      damageScale: 1.4, defenceScale: 1.1,
    },
    special: 'ground-breaker',
  },
  {
    id: 'zip', name: 'Zip', tagline: 'First in, first out. Never trade blows.',
    tint: 0x70edbd, scale: SCALE * 0.94,
    stats: {
      maxHealth: 75, walkSpeed: 5.6, runSpeed: 9.2, jumpSpeed: 8.5,
      damageScale: 0.85, defenceScale: 0.85,
    },
    special: 'flash-step',
  },
  {
    id: 'pike', name: 'Pike', tagline: 'Own the gap. Keep them at arm’s length.',
    tint: 0xb69aff, scale: SCALE * 1.2,
    stats: {
      maxHealth: 90, walkSpeed: 3.6, runSpeed: 6.4, jumpSpeed: 6.0,
      damageScale: 0.95, defenceScale: 0.95,
    },
    special: 'lance-kick',
  },
  {
    id: 'bastion', name: 'Bastion', tagline: 'Outlast the storm. Win the trade.',
    tint: 0xa6c8cf, scale: SCALE * 1.08,
    stats: {
      maxHealth: 150, walkSpeed: 2.6, runSpeed: 4.5, jumpSpeed: 5.0,
      damageScale: 0.7, defenceScale: 1.5,
    },
    special: 'iron-guard',
  },
  {
    id: 'ember', name: 'Ember', tagline: 'Everything on the hit. Nothing in reserve.',
    tint: 0xff727e, scale: SCALE,
    stats: {
      maxHealth: 65, walkSpeed: 4.2, runSpeed: 7.2, jumpSpeed: 8.5,
      damageScale: 1.75, defenceScale: 0.75,
    },
    special: 'burnout',
  },
];

export const CHARACTER_DEFAULTS = { p1: 'axel', p2: 'rook' };

export const ROUNDS = { seconds: 60, toWin: 2, intermissionSeconds: 2.5 };

export const CAMERA = {
  track: true, followX: 1.0, followZ: 1.0,
  maxOffsetX: ARENA.limitX, maxOffsetZ: 1.8,
  zoomPerUnit: 0.55, maxPull: MAP_ART.floorWidth * 1.5,
  restSeparation: 2.5, damping: 3.5, koPush: 0.8,
  framePadding: 0.1, frameRadius: BODY.radius * 1.5,
  frameHeight: BODY.height * 1.25,
};

export const MODEL_YAW_OFFSET = 0;

export const CLIPS = [
  'idle', 'walk', 'run', 'jump', 'punch', 'kick', 'dropkick',
  'hit', 'block', 'dash', 'knockdown', 'getup', 'death',
];

export const STATE_CLIP = {
  IDLE: 'idle', WALK: 'walk', RUN: 'run', JUMP: 'jump',
  ATTACK: 'punch', LIGHT_ATTACK: 'punch', HEAVY_ATTACK: 'punch',
  AIR_LIGHT_ATTACK: 'punch', AIR_HEAVY_ATTACK: 'kick', DIVE_KICK: 'dropkick',
  JUGGLE: 'hit', KICK: 'kick', DROPKICK: 'dropkick',
  GRAB: 'punch', GRABBING: 'block', HELD: 'hit', THROW: 'punch',
  GRAB_RECOVERY: 'idle', HIT: 'hit', BLOCK: 'block', DASH: 'dash',
  KNOCKDOWN: 'knockdown', GETUP: 'getup', KO: 'death', SUPER: 'punch',
};

export const LOOPING_STATES = new Set(['IDLE', 'WALK', 'RUN', 'BLOCK', 'GRABBING', 'HELD']);

export const AI = {
  baseAggression: 0.5, thinkInterval: 0.12,
  attackRange: 1.9, spacingRange: 3.2,
  preferredAttackChance: 0.65, planAggressionNeutral: 0.5,
  planAggressionWeight: 1.0,
  moves: {
    inputStepSeconds: 1 / 60,
    closeRange: 1.9,
    facingDot: 0.9,
    punishMargin: 0.025,
    healthFloor: 0.1,
    blockedThreshold: 3,
    guardBase: 0.75,
    guardAggression: 0.45,
    jumpChance: 0.12,
    attackBase: 0.3,
    attackAggression: 0.6,
    stanceAttack: { poke: 1, rush: 1.3, spacing: 0.65, defensive: 0.4 },
    weights: {
      speed: 0.6,
      damage: 0.025,
      range: { close: 0.1, mid: 1, far: 2 },
      stringStarter: 1.5,
      launch: 1,
      antiAir: 3,
      grab: 5,
      low: 2,
      punishDamage: 0.08,
      parry: 4,
      armor: 0.8,
      projectile: 3,
      unsuitable: 6,
      escape: 10,
      mobilityCancel: 4,
      selfDamageCancel: 0.08,
      selfDamage: 0.08,
      variation: 0.4,
    },
  },
};

export const DIFFICULTIES = {
  easy: {
    label: 'Easy', baseAggression: 0.25, thinkInterval: 5.0,
    reactionDelay: 0.24, maxString: 2, cancelChance: 0.2, punishChance: 0.2,
  },
  normal: {
    label: 'Normal', baseAggression: AI.baseAggression, thinkInterval: AI.thinkInterval,
    reactionDelay: 0.1, maxString: 3, cancelChance: 0.65, punishChance: 0.6,
  },
  hard: {
    label: 'Hard', baseAggression: 0.85, thinkInterval: 1.5,
    reactionDelay: 0.045, maxString: 6, cancelChance: 0.98, punishChance: 0.95,
  },
};

export const MENU = { defaultDifficulty: 'normal' };

export const METER = {
  stockSize: 100,
  maxStocks: 2,
  damageDealtRate: 1,
  damageTakenRate: 0.6,
  hudSmoothSeconds: 0.16,
  color: '#79ddff',
  readyColor: '#ffe080',
};

/**
 * Frame zero is activation; intervals are start-inclusive/end-exclusive.
 * All six supers are invulnerable on frames 0..5, vulnerable from frame 6.
 * Frame timings use simulation time, so cinematic pauses do not eat startup.
 */

export const SUPER_RULES = {
  fps: 60,
  frameEpsilon: 1e-7,
  invulnerableStartFrame: 0,
  invulnerableEndFrame: 6,
  pauseSeconds: 0.14,
  height: 3.4,
  fxEveryFrames: 4,
  defaultKnockback: 0,
  allowedStates: ['IDLE', 'WALK', 'RUN', 'BLOCK'],
};

/**
 * Damage is the total unscaled damage if every beat connects.
 * Ordinary roster damage/defence scaling still applies.
 * Zip/Ember reach is acquisition range; their local strike radius is separate.
 * Rook reaches the arena's full diagonal, not just the current camera view.
 */

export const BACKDROP = {
  drawCallBudget: 8,
  triangleBudget: 12000,
  clearance: 1,
  sourceSamples: 24,
  sampleEpsilon: 1e-6,
  minimumProfileHeight: 0.015,
  hazeColor: 0x4f6d99,
  jitter: 0.16,
  widthMin: 0.88,
  widthRange: 0.24,
  heightMin: 0.72,
  heightRange: 0.4,
  unlitFraction: 0.36,
  windowColor: 0xf1c89b,
  windowSpread: 0.4,
  windowBottom: 0.14,
  windowVerticalSpan: 0.43,
  windowWidth: 0.035,
  windowHeight: 0.15,
  windowLift: 0.02,
  canyon: { base: 0.72, flanks: 0.65 },
  layers: [
    {
      name: 'far', z: -70, parallax: 0.06,
      span: 240, count: 16, baseY: -36, height: 32, thickness: 0.08,
      brightness: 0.28, blueMix: 0.82,
      windowRows: 0, windowColumns: 0, windowBrightness: 0.12,
    },
    {
      name: 'middle', z: -42, parallax: 0.24,
      span: 210, count: 24, baseY: -18, height: 26, thickness: 0.6,
      brightness: 0.46, blueMix: 0.5,
      windowRows: 3, windowColumns: 2, windowBrightness: 0.28,
    },
    {
      name: 'near', z: -24, parallax: 0.52,
      span: 180, count: 30, baseY: -6, height: 20, thickness: 2,
      brightness: 0.7, blueMix: 0.14,
      windowRows: 7, windowColumns: 3, windowBrightness: 0.72,
    },
  ],
  foreground: {
    parallax: 0.94,
    nearScale: 1.35,
    edgeNdc: 0.98,
    minEdgeNdc: 0.84,
    maxEdgeNdc: 1.25,
    widthNdc: 0.3,
    heightNdc: 2.16,
    color: 0x070b11,
    opacity: 0.8,
    softness: 0.13,
  },
  maps: {
    dojo: {
      seed: 101, color: 0x776353,
      kinds: ['mountain', 'roof', 'roof'], windows: false,
    },
    'neon-street': {
      seed: 211, color: 0x4f5269,
      kinds: ['city', 'city', 'skyscraper'], windows: true,
    },
    'temple-courtyard': {
      seed: 307, color: 0x526454,
      kinds: ['forest', 'forest', 'tree'], windows: false,
    },
    rooftop: {
      seed: 419, color: 0x748591,
      kinds: ['city', 'city', 'skyscraper'], windows: true,
    },
  },
};
