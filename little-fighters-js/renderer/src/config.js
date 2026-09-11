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

  /**
   * How long a fighter is locked out of its own input after being hit.
   *
   * This MUST be authored, never taken from the length of the reaction clip.
   * hit.glb runs 0.83s and a light jab's whole cycle is 0.30s, so a clip-length
   * reaction means the attacker lands a fresh jab roughly three times for every
   * one chance the victim gets to act — which is to say, never. That is an
   * infinite stun-lock, and it is not a difficulty setting.
   *
   * The rule that keeps a game playable: the victim's lockout must be shorter
   * than the attacker's own recovery, so pressure costs the attacker something.
   * Combos then come from *cancelling* into the next move deliberately, not
   * from the defender being unable to exist.
   *
   * Reaction clips are re-timed to fit the window rather than truncated, so a
   * shorter stun plays the same animation faster instead of cutting it off.
   */
  reaction: {
    hitStun: 0.28,
    // Each further hit in one combo stuns for less, so a string has to end.
    comboDecay: 0.82,
    minHitStun: 0.12,

    knockdown: 0.85,
    getup: 0.45,
    // Invulnerable for a moment after standing up, or the same attacker just
    // starts the knockdown loop again the instant you are back on your feet.
    getupInvulnerable: 0.55,

    // Never re-time a clip beyond this, or reactions read as a twitch.
    maxClipSpeed: 3.0,
  },

  grab: {
    // Center-to-center ground-plane distance; never scaled by roster reach.
    range: 1.25,
    halfWidth: 0.6,
    heightTolerance: 0.25,
    startupSeconds: 0.3,
    // Startup is also at least the loaded light jab's startup plus this.
    jabStartupMargin: 0.08,
    recoverySeconds: 0.3,
    holdSeconds: 1.1,
    throwRecoverySeconds: 0.4,
    damage: 20,
    knockback: 12,
    directionThreshold: 0.35,
    // Applied on every release. Paused during knockdown/getup so even long
    // animation clips leave a guaranteed no-regrab window after recovery.
    immunitySeconds: 1.0,
    mashWindowSeconds: 0.45,
    mashPresses: 5,
    // At most one mash credit per simulation frame, even for button chords.
    mashActions: ['attack', 'light', 'heavy', 'kick', 'grab', 'jump', 'dash', 'block'],
  },
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
    kick: 'KeyK', block: 'KeyL', dash: 'KeyU', grab: 'KeyO',
  },
  p2: {
    up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
    jump: 'Slash', run: 'Comma', light: 'Period', heavy: 'KeyH',
    kick: 'KeyV', block: 'KeyN', dash: 'KeyB', grab: 'KeyC',
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
  camera: { x: 0, y: 10, z: 9.5, pitchDeg: -38, fov: 40, near: 1, far: 220 },
};

/**
 * Map coordinates are relative to ARENA.floorY. Decorations stay outside the
 * shared playable footprint; visual floor detail never changes collision.
 */
export const MAP_ART = {
  floorSize: 12,
  floorThickness: 1,
  roughness: 0.85,

  /**
   * How far a flat decal sits above the walking plane.
   *
   * 8mm was not enough: with the camera's old 0.1-to-500 depth range the
   * depth buffer could not separate surfaces that close, so decals and floor
   * fought for the same pixels and the ground flickered whenever the camera
   * moved — which it does constantly, because it tracks the fighters.
   */
  surfaceLift: 0.015,

  /**
   * How far the base slab sits BELOW the decking that covers it.
   *
   * Zero is the bug: addFloor put its top face at exactly y=0 and every
   * plank, tile and board put its top face at exactly y=0 too. Two coplanar
   * surfaces across the whole stage is textbook z-fighting. The decking stays
   * at the fighters' floor plane; the slab underneath moves down.
   */
  deckSink: 0.05,
  radialSegments: 16,
  sphereRows: 10,
  boundaryWidth: 0.035,
  shadow: {
    size: 2048,
    near: 0.5,
    far: 40,
    extent: 10,
    bias: -0.0009,
  },
};

export const MAP_THEMES = [
  {
    id: 'dojo',
    name: 'Lantern Dojo',
    floorColor: 0x382113,
    skyColor: 0x24150e,
    fog: { color: 0x392719, near: 20, far: 48 },
    roughness: 0.78,
    metalness: 0,
    boundaryColor: 0xe6b46b,
    lights: [
      { type: 'hemisphere', color: 0xffdda5, groundColor: 0x39221a, intensity: 1.1 },
      { type: 'directional', color: 0xffd49b, intensity: 2.0, position: [4, 9, 5], shadow: true },
      { type: 'directional', color: 0xa6b5d4, intensity: 0.6, position: [-5, 6, -6] },
    ],
    decor: {
      woodColors: [0x85502b, 0x975f34, 0xa76b3c, 0x754525],
      boardWidth: 0.5,
      boardLength: 3,
      boardThickness: 0.08,
      boardGap: 0.018,
      frameColor: 0x362017,
      paperColor: 0xe8d8b7,
      paperGlow: 0.12,
      screenXs: [-4.6, -2.3, 0, 2.3, 4.6],
      screenZ: -4.8,
      screenWidth: 2.26,
      screenHeight: 3.6,
      screenColumns: 3,
      screenRows: 4,
      frameWidth: 0.065,
      lanternColor: 0xffb95b,
      lanternGlow: 2.2,
      lanterns: [[-3.5, 3.4, -3.7], [0, 3.8, -4.1], [3.5, 3.4, -3.7]],
      lanternRadius: 0.36,
      cordLength: 1.0,
      cordWidth: 0.025,
      capScale: 0.42,
      capHeight: 0.08,
      lightIntensity: 8,
      lightDistance: 7,
    },
  },
  {
    id: 'neon-street',
    name: 'Neon Street',
    floorColor: 0x151c29,
    skyColor: 0x030611,
    fog: { color: 0x0c1027, near: 15, far: 40 },
    roughness: 0.18,
    metalness: 0.45,
    boundaryColor: 0x6fe7ff,
    lights: [
      { type: 'hemisphere', color: 0x6f8dcc, groundColor: 0x101327, intensity: 0.85 },
      { type: 'directional', color: 0xb7d4ff, intensity: 1.6, position: [4, 9, 5], shadow: true },
      { type: 'directional', color: 0xff55cb, intensity: 0.85, position: [-5, 6, -6] },
    ],
    decor: {
      buildingColor: 0x151a29,
      buildingZ: -5.4,
      buildingHeight: 6,
      buildingWidth: 3.5,
      buildingDepth: 0.8,
      signXs: [-3.8, 0, 3.8],
      signColors: [0xff329e, 0x27dbff, 0xb983ff],
      signBackingColor: 0x080a13,
      signY: 2.7,
      signZ: -4.92,
      signWidth: 2.2,
      signHeight: 1.25,
      signDepth: 0.08,
      signGlow: 3,
      signRoughness: 0.35,
      strokeWidth: 0.055,
      glyphCount: 3,
      glyphSpacing: 0.55,
      glyphHeight: 0.65,
      glyphWidth: 0.3,
      lightIntensity: 18,
      lightDistance: 9,
      lightOffset: 0.55,
      reflectionRows: 24,
      reflectionStartZ: -4.3,
      reflectionLength: 7.4,
      reflectionOpacity: 0.3,
      reflectionJitter: 0.32,
      reflectionMinWidth: 0.3,
      reflectionWidthRange: 0.7,
      reflectionStripDepth: 0.13,
      curbColor: 0x424557,
      curbX: 5.5,
      curbWidth: 0.65,
      curbHeight: 0.2,
      puddleColor: 0x28415d,
      puddleRoughness: 0.06,
      puddleMetalness: 0.65,
      puddleOpacity: 0.3,
      puddles: 20,
      puddleSpread: 9,
      puddleWidth: 0.7,
      puddleDepth: 0.3,
    },
  },
  {
    id: 'temple-courtyard',
    name: 'Dusk Temple',
    floorColor: 0x343640,
    skyColor: 0x55405f,
    fog: { color: 0x695b78, near: 18, far: 48 },
    roughness: 0.92,
    metalness: 0,
    boundaryColor: 0xd7b18a,
    lights: [
      { type: 'hemisphere', color: 0xbaacd7, groundColor: 0x343440, intensity: 1.15 },
      { type: 'directional', color: 0xffb879, intensity: 2.1, position: [-6, 8, 4], shadow: true },
      { type: 'directional', color: 0x999fff, intensity: 0.8, position: [5, 6, -6] },
    ],
    decor: {
      colors: [0x73737c, 0x85818a, 0x676b76, 0x8b8587],
      tileSize: 1.2,
      gap: 0.035,
      thickness: 0.1,
      pillarColor: 0x9c9290,
      trimColor: 0x6e6670,
      pillarXs: [-4.5, 4.5],
      pillarZs: [-3.8, 0, 3.8],
      pillarRadius: 0.3,
      pillarHeight: 3.4,
      baseWidth: 0.95,
      baseHeight: 0.3,
      capHeight: 0.22,
      steps: 3,
      stepsZ: -5,
      stepsWidth: 5.8,
      stepsDepth: 1.5,
      stepHeight: 0.18,
      stepDepth: 0.3,
      stepInset: 0.5,
    },
  },
  {
    id: 'rooftop',
    name: 'Highline Rooftop',
    floorColor: 0x363e4c,
    skyColor: 0x182338,
    fog: { color: 0x39465c, near: 9, far: 38 },
    roughness: 0.93,
    metalness: 0.03,
    boundaryColor: 0xb8c9de,
    lights: [
      { type: 'hemisphere', color: 0xa5bbdf, groundColor: 0x293343, intensity: 1.25 },
      { type: 'directional', color: 0xd4e3ff, intensity: 1.75, position: [4, 9, 5], shadow: true },
      { type: 'directional', color: 0xffbb82, intensity: 0.65, position: [-5, 6, -6] },
    ],
    decor: {
      colors: [0x656b75, 0x606773, 0x707580],
      tileSize: 3,
      gap: 0.026,
      thickness: 0.08,
      parapetColor: 0x717781,
      parapetOffset: 5.7,
      parapetHeight: 0.55,
      parapetWidth: 0.28,
      cityColor: 0x172132,
      cityZ: -13,
      cityDepth: 8,
      cityBaseY: -6,
      towers: 19,
      towerSpacing: 2.25,
      towerWidth: 1.8,
      towerDepth: 1.8,
      towerMinHeight: 6,
      towerHeightRange: 9,
      windowColors: [0xffd59a, 0x91bce8, 0xe6edff],
      windowColumns: 3,
      windowSpacingX: 0.42,
      windowSpacingY: 0.7,
      windowWidth: 0.14,
      windowHeight: 0.24,
      unlitFraction: 0.5,
      equipmentColor: 0x4c5666,
      equipmentXs: [-4.4, 4.4],
      equipmentZ: -3.8,
      equipmentWidth: 1.1,
      equipmentHeight: 0.9,
      equipmentDepth: 0.9,
      ventColor: 0x232c39,
      ventCount: 4,
      ventHeight: 0.035,
      ventWidthScale: 0.8,
    },
  },
];

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

/**
 * Roster tuning; characters.js exposes the public roster and appearance helpers.
 * scale is an absolute model scale. Match creation also uses scale / SCALE
 * for forward attack reach; body collision and hurtboxes remain standard.
 * Specials are identifiers only, not implemented moves.
 */
export const CHARACTER_ROSTER = [
  {
    id: 'axel',
    name: 'Axel',
    tagline: 'Balanced tools. No bad matchups.',
    tint: 0x80b3ff,
    scale: SCALE,
    stats: { ...FIGHTER_STATS },
    special: 'rising-strike',
  },
  {
    id: 'rook',
    name: 'Rook',
    tagline: 'Slow feet. Heavy hands.',
    tint: 0xd58a54,
    scale: SCALE * 1.1,
    stats: {
      maxHealth: 130,
      walkSpeed: 2.8,
      runSpeed: 4.8,
      jumpSpeed: 5.5,
      damageScale: 1.4,
      defenceScale: 1.1,
    },
    special: 'ground-breaker',
  },
  {
    id: 'zip',
    name: 'Zip',
    tagline: 'First in, first out. Never trade blows.',
    tint: 0x70edbd,
    scale: SCALE * 0.94,
    stats: {
      maxHealth: 75,
      walkSpeed: 5.6,
      runSpeed: 9.2,
      jumpSpeed: 8.5,
      damageScale: 0.85,
      defenceScale: 0.85,
    },
    special: 'flash-step',
  },
  {
    id: 'pike',
    name: 'Pike',
    tagline: 'Own the gap. Keep them at arm’s length.',
    tint: 0xb69aff,
    scale: SCALE * 1.2,
    stats: {
      maxHealth: 90,
      walkSpeed: 3.6,
      runSpeed: 6.4,
      jumpSpeed: 6.0,
      damageScale: 0.95,
      defenceScale: 0.95,
    },
    special: 'lance-kick',
  },
  {
    id: 'bastion',
    name: 'Bastion',
    tagline: 'Outlast the storm. Win the trade.',
    tint: 0xa6c8cf,
    scale: SCALE * 1.08,
    stats: {
      maxHealth: 150,
      walkSpeed: 2.6,
      runSpeed: 4.5,
      jumpSpeed: 5.0,
      damageScale: 0.7,
      defenceScale: 1.5,
    },
    special: 'iron-guard',
  },
  {
    id: 'ember',
    name: 'Ember',
    tagline: 'Everything on the hit. Nothing in reserve.',
    tint: 0xff727e,
    scale: SCALE,
    stats: {
      maxHealth: 65,
      walkSpeed: 4.2,
      runSpeed: 7.2,
      jumpSpeed: 8.5,
      damageScale: 1.75,
      defenceScale: 0.75,
    },
    special: 'burnout',
  },
];

export const CHARACTER_DEFAULTS = {
  p1: 'axel',
  p2: 'rook',
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

/** Grab poses reuse existing clips; their gameplay timers are independent. */
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
  GRAB: 'punch',
  GRABBING: 'block',
  HELD: 'hit',
  THROW: 'punch',
  GRAB_RECOVERY: 'idle',
  HIT: 'hit',
  BLOCK: 'block',
  DASH: 'dash',
  KNOCKDOWN: 'knockdown',
  GETUP: 'getup',
  KO: 'death',
};

export const LOOPING_STATES = new Set([
  'IDLE', 'WALK', 'RUN', 'BLOCK', 'GRABBING', 'HELD',
]);

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
