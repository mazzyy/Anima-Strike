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
export const MOVE_DATA = {
  axel: [
    ['jab', 'One', 'light', .07, .06, .19, 5, .4, 1.45,
      { cancelInto: ['cross'] }],
    ['cross', 'Two', 'light', .065, .065, .19, 6, .5, 1.55,
      { followupOnly: true, cancelInto: ['hook'] }],
    ['hook', 'Three', 'light', .08, .07, .22, 9, .6, 1.65,
      { followupOnly: true, cancelInto: ['launcher'] }],
    ['launcher', 'Rising Strike', 'down,heavy', .13, .10, .29, 12, 1, 1.6,
      { hitHeight: 'high', effects: { launch: 7 } }],
    ['sweep', 'Ankle Reaper', 'kick', .15, .10, .30, 11, 3, 1.8,
      { knocksDown: true, hitHeight: 'low', clip: 'kick' }],
    ['elbow', 'Rush Elbow', 'forward,down,light', .11, .13, .27, 13, 4, 1.5,
      { effects: { speed: 8 }, clip: 'dash', clipSpeed: 1.5 }],
    ['uppercut', 'Sky Check', 'forward,down,heavy', .08, .14, .38, 17, 4, 1.4,
      { hitHeight: 'high', effects: { launch: 8 } }],
    ['grab', 'Clinch Breaker', 'back,forward,grab', .24, .07, .38, 20, 10, 1.25,
      { knocksDown: true, effects: { grab: true }, clip: 'punch' }],
    ['airkick', 'Flying Knee', 'kick', .07, .15, .20, 10, 3, 1.6,
      { airborne: true, hitHeight: 'air', clip: 'kick' }],
  ],
  rook: [
    ['jab', 'Stone Fist', 'light', .19, .10, .34, 10, .5, 1.55,
      { cancelInto: ['hammer'] }],
    ['hammer', 'Iron Hammer', 'heavy', .32, .16, .42, 22, .6, 1.8,
      { cancelInto: ['crusher'], effects: { armor: 1 }, clipSpeed: .7 }],
    ['crusher', 'Gate Crusher', 'heavy', .35, .17, .48, 30, 11, 2,
      { followupOnly: true, knocksDown: true, effects: { armor: 1 }, clipSpeed: .65 }],
    ['pound', 'Ground Breaker', 'down,up,heavy', .38, .22, .48, 25, 7, 3.3,
      { knocksDown: true, hitHeight: 'low', effects: { radial: true },
        vfx: 'shockwave', clip: 'kick' }],
    ['shoulder', 'Freight Train', 'forward,forward,heavy', .22, .25, .40, 23, 12, 1.7,
      { knocksDown: true, effects: { armor: 1, speed: 8 }, clip: 'dash' }],
    ['lariat', 'Roundhouse Lariat', 'back,back,heavy', .24, .28, .42, 21, 8, 2.2,
      { knocksDown: true, effects: { radial: true, armor: 1 }, clip: 'kick' }],
    ['backhand', 'Backhand', 'back,light', .20, .12, .30, 15, 6, 2.1,
      { effects: { armor: 1 } }],
    ['stomp', 'Boot Print', 'kick', .25, .12, .36, 18, 4, 1.65,
      { knocksDown: true, hitHeight: 'low', clip: 'kick' }],
    ['airkick', 'Falling Anvil', 'kick', .17, .20, .26, 22, 6, 1.8,
      { airborne: true, knocksDown: true, hitHeight: 'air',
        clip: 'dropkick', effects: { dive: 8 } }],
  ],
  zip: [
    ['jab', 'Flick', 'light', .035, .04, .12, 2, .15, 1.35,
      { cancelInto: ['cross', 'run-cancel'] }],
    ['cross', 'Flit', 'light', .035, .04, .12, 3, .15, 1.4,
      { followupOnly: true, cancelInto: ['hook', 'run-cancel'] }],
    ['hook', 'Flash', 'light', .04, .04, .13, 3, .2, 1.45,
      { followupOnly: true, cancelInto: ['finish', 'run-cancel'] }],
    ['finish', 'Gone', 'light', .045, .05, .14, 5, 2, 1.5,
      { followupOnly: true, cancelInto: ['run-cancel'] }],
    ['teleport', 'Flash Step', 'back,back,dash', .05, .04, .13, 0, 0, 0,
      { effects: { teleport: 3.2 }, clip: 'dash', vfx: 'flash', meterGain: 0 }],
    ['run-cancel', 'Keep Moving', 'forward,dash', .025, .07, .06, 0, 0, 0,
      { effects: { speed: 11, finish: 'RUN' }, clip: 'run', vfx: 'flash', meterGain: 0 }],
    ['dive', 'Needle Dive', 'kick', .04, .16, .13, 7, 3, 1.4,
      { airborne: true, hitHeight: 'air', knocksDown: true,
        effects: { dive: 12, speed: 7 }, clip: 'dropkick', vfx: 'flash' }],
    ['needle', 'Needle', 'heavy', .055, .055, .16, 6, 1, 1.65,
      { cancelInto: ['run-cancel'], clipSpeed: 2.4 }],
    ['retreat', 'Parting Gift', 'back,kick', .05, .08, .15, 5, 2, 1.7,
      { effects: { speed: -5 }, hitHeight: 'low', clip: 'kick', vfx: 'flash' }],
    ['airlight', 'Air Flick', 'light', .035, .07, .12, 3, .5, 1.4,
      { airborne: true, hitHeight: 'air', clipSpeed: 2.5 }],
  ],
  pike: [
    ['jab', 'Measure', 'light', .12, .10, .26, 9, .3, 2.65,
      { cancelInto: ['extension'], vfx: 'reach' }],
    ['extension', 'Keep Out', 'light', .13, .12, .28, 12, .4, 2.9,
      { followupOnly: true, cancelInto: ['thrust'], vfx: 'reach' }],
    ['thrust', 'Lance Point', 'heavy', .18, .40, .32, 17, 5, 3.5,
      { vfx: 'reach', clipSpeed: .8 }],
    ['counter', 'Stop Right There', 'back,down,light', .045, .23, .34, 11, 5, 2.8,
      { effects: { parry: 'thrust', approachesOnly: true }, vfx: 'reach', clip: 'block' }],
    ['slide', 'Lance Kick', 'down,forward,kick', .11, .24, .32, 14, 5, 2.5,
      { hitHeight: 'low', knocksDown: true, effects: { speed: 6 },
        clip: 'dropkick', vfx: 'reach' }],
    ['sweep', 'Long Sweep', 'kick', .21, .14, .33, 13, 4, 3,
      { hitHeight: 'low', knocksDown: true, clip: 'kick', vfx: 'reach' }],
    ['backstep', 'Recede', 'back,back,light', .09, .12, .24, 8, 3, 2.8,
      { effects: { speed: -5 }, hitHeight: 'low', clip: 'kick', vfx: 'reach' }],
    ['antiair', 'Sky Fence', 'down,up,heavy', .12, .20, .35, 16, 4, 2.7,
      { hitHeight: 'high', effects: { launch: 6 }, clip: 'kick', vfx: 'reach' }],
    ['airkick', 'Horizon', 'kick', .11, .18, .22, 12, 3, 2.8,
      { airborne: true, hitHeight: 'air', clip: 'kick', vfx: 'reach' }],
  ],
  bastion: [
    ['jab', 'Check', 'light', .14, .09, .27, 7, .3, 1.45,
      { cancelInto: ['shield'], vfx: 'guard' }],
    ['shield', 'Shield Knuckle', 'heavy', .20, .12, .34, 12, 5, 1.7,
      { vfx: 'guard' }],
    ['parry', 'Iron Guard', 'back,down,light', .035, .18, .40, 0, 0, 0,
      { effects: { parry: 'punish' }, clip: 'block', vfx: 'guard', meterGain: 0 }],
    ['punish', 'Your Mistake', 'heavy', .045, .14, .32, 26, 8, 2.3,
      { followupOnly: true, knocksDown: true, vfx: 'guard' }],
    ['push', 'Make Room', 'heavy', .04, .13, .35, 5, 10, 2,
      { effects: { fromBlock: true }, clip: 'block', vfx: 'guard' }],
    ['reversal', 'No Entry', 'down,up,heavy', .035, .16, .48, 20, 9, 2.1,
      { effects: { fromBlock: true, armor: 1 }, knocksDown: true,
        clip: 'kick', vfx: 'guard' }],
    ['sweep', 'Foundation', 'kick', .23, .14, .37, 10, 3, 1.9,
      { hitHeight: 'low', knocksDown: true, clip: 'kick', vfx: 'guard' }],
    ['headbutt', 'Hold the Line', 'forward,down,heavy', .24, .15, .36, 16, 6, 1.65,
      { effects: { armor: 1 }, clip: 'kick', vfx: 'guard' }],
    ['airkick', 'Battlement', 'kick', .14, .16, .25, 9, 4, 1.7,
      { airborne: true, hitHeight: 'air', clip: 'kick', vfx: 'guard' }],
  ],
  ember: [
    ['jab', 'Spark', 'light', .085, .075, .25, 12, .3, 1.45,
      { cancelInto: ['heavy'], vfx: 'flame' }],
    ['heavy', 'Ignition', 'heavy', .17, .12, .35, 24, .4, 1.7,
      { cancelInto: ['overdrive'], vfx: 'flame' }],
    ['projectile', 'Cinder Shot', 'down,forward,light', .20, .08, .38, 18, 4, .35,
      { effects: { projectile: { speed: 11, life: .9, offset: 1.1 } }, vfx: 'flame' }],
    ['dive', 'Falling Sun', 'kick', .09, .22, .27, 27, 8, 1.8,
      { airborne: true, knocksDown: true, hitHeight: 'air',
        effects: { dive: 11, speed: 5 }, clip: 'dropkick', vfx: 'flame' }],
    ['overdrive', 'Burnout', 'back,down,forward,heavy', .19, .20, .48, 40, 13, 2.5,
      { knocksDown: true, effects: { selfDamage: 14, speed: 5 },
        vfx: 'flame', meterGain: 10 }],
    ['sweep', 'Ash Line', 'kick', .17, .12, .33, 18, 5, 1.9,
      { hitHeight: 'low', knocksDown: true, clip: 'kick', vfx: 'flame' }],
    ['burst', 'Firebreak', 'back,back,heavy', .23, .17, .43, 25, 8, 2.3,
      { hitHeight: 'mid', knocksDown: true, effects: { radial: true },
        clip: 'kick', vfx: 'flame' }],
    ['uppercut', 'Flare Up', 'forward,down,heavy', .11, .17, .41, 23, 3, 1.6,
      { hitHeight: 'high', effects: { launch: 8 }, clip: 'kick', vfx: 'flame' }],
    ['airlight', 'Hot Touch', 'light', .065, .10, .23, 13, 2, 1.5,
      { airborne: true, hitHeight: 'air', vfx: 'flame' }],
  ],
};

/** Durations use wall-clock seconds, never the scaled simulation clock. */
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

export const AUDIO = {
  muteKey: 'KeyM', masterVolume: 0.22, maxVoices: 6,
  noiseBufferSeconds: 1, fadeSeconds: 0.008, envelopeFloor: 0.0001,
  pitchVariationCents: 35,
  swingSpeed: { min: 0.75, max: 1.5, referenceSeconds: COMBAT.attackDuration },
  tradeSeconds: 0.05,
  legacySounds: {
    ATTACK: 'hit', LIGHT_ATTACK: 'jab', HEAVY_ATTACK: 'heavy',
    AIR_LIGHT_ATTACK: 'jab', AIR_HEAVY_ATTACK: 'heavy',
    KICK: 'heavy', DROPKICK: 'throw', DIVE_KICK: 'throw',
  },
  sounds: {
    hit: {
      noise: {
        filter: 'lowpass', q: 0.7, fromHz: 3200, toHz: 900,
        volume: 0.3, attack: 0.003, duration: 0.085,
      },
      tone: { fromHz: 145, toHz: 55, volume: 0.4, attack: 0.004, duration: 0.13 },
    },
    block: {
      noise: {
        filter: 'lowpass', q: 0.7, fromHz: 1300, toHz: 280,
        volume: 0.15, attack: 0.006, duration: 0.1,
      },
      tone: { fromHz: 90, toHz: 45, volume: 0.3, attack: 0.006, duration: 0.14 },
    },
    whiff: {
      speedSensitive: true,
      noise: {
        filter: 'bandpass', q: 0.7, fromHz: 600, toHz: 2200,
        volume: 0.24, attack: 0.035, duration: 0.16,
      },
      tone: { fromHz: 180, toHz: 420, volume: 0.045, attack: 0.025, duration: 0.12 },
    },
    land: {
      noise: {
        filter: 'lowpass', q: 0.7, fromHz: 1200, toHz: 100,
        volume: 0.15, attack: 0.006, duration: 0.1,
      },
      tone: { fromHz: 95, toHz: 38, volume: 0.48, attack: 0.006, duration: 0.18 },
    },
    jab: {
      noise: {
        filter: 'highpass', q: 0.8, fromHz: 4200, toHz: 1800,
        volume: 0.32, attack: 0.001, duration: 0.045,
      },
      tone: {
        type: 'triangle', fromHz: 360, toHz: 135,
        volume: 0.22, attack: 0.002, duration: 0.065,
      },
    },
    heavy: {
      noise: {
        filter: 'lowpass', q: 1.1, fromHz: 1900, toHz: 220,
        volume: 0.36, attack: 0.002, duration: 0.14,
      },
      tone: { fromHz: 120, toHz: 38, volume: 0.56, attack: 0.002, duration: 0.27 },
    },
    clash: {
      noise: {
        filter: 'bandpass', q: 9, fromHz: 6700, toHz: 2800,
        volume: 0.3, attack: 0.001, duration: 0.19,
      },
      tone: {
        type: 'square', fromHz: 1130, toHz: 870,
        volume: 0.085, attack: 0.002, duration: 0.28,
      },
    },
    parry: {
      noise: {
        filter: 'bandpass', q: 16, fromHz: 4800, toHz: 4500,
        volume: 0.12, attack: 0.003, duration: 0.08,
      },
      tone: {
        type: 'triangle', fromHz: 1568, toHz: 1580,
        volume: 0.25, attack: 0.003, duration: 0.4,
      },
    },
    grab: {
      noise: {
        filter: 'bandpass', q: 0.5, fromHz: 1300, toHz: 420,
        volume: 0.27, attack: 0.028, duration: 0.19,
      },
      tone: { fromHz: 180, toHz: 70, volume: 0.3, attack: 0.03, duration: 0.15 },
    },
    throw: {
      noise: {
        filter: 'bandpass', q: 1.4, fromHz: 6200, toHz: 340,
        volume: 0.44, attack: 0.001, duration: 0.12,
      },
      tone: { fromHz: 155, toHz: 32, volume: 0.58, attack: 0.003, duration: 0.3 },
    },
    lightning: {
      noise: {
        filter: 'highpass', q: 1.2, fromHz: 1700, toHz: 6500,
        volume: 0.34, attack: 0.001, duration: 0.24,
        pulses: [
          { at: 0.012, level: 0.04 }, { at: 0.021, level: 0.9 },
          { at: 0.039, level: 0.05 }, { at: 0.048, level: 0.7 },
          { at: 0.083, level: 0.03 }, { at: 0.096, level: 0.8 },
          { at: 0.125, level: 0.06 }, { at: 0.146, level: 0.5 },
        ],
      },
      tone: {
        type: 'sawtooth', fromHz: 760, toHz: 105,
        volume: 0.09, attack: 0.002, duration: 0.18,
      },
    },
    projectileLaunch: {
      noise: {
        filter: 'bandpass', q: 2, fromHz: 450, toHz: 5000,
        volume: 0.24, attack: 0.018, duration: 0.2,
      },
      tone: {
        type: 'triangle', fromHz: 240, toHz: 1250,
        volume: 0.18, attack: 0.014, duration: 0.19,
      },
    },
    projectileImpact: {
      noise: {
        filter: 'bandpass', q: 2, fromHz: 7200, toHz: 650,
        volume: 0.38, attack: 0.001, duration: 0.22,
      },
      tone: {
        type: 'triangle', fromHz: 620, toHz: 60,
        volume: 0.29, attack: 0.002, duration: 0.25,
      },
    },
    pound: {
      noise: {
        filter: 'lowpass', q: 1.2, fromHz: 1200, toHz: 100,
        volume: 0.4, attack: 0.004, duration: 0.38,
      },
      tone: { fromHz: 72, toHz: 25, volume: 0.65, attack: 0.008, duration: 0.65 },
    },
    super: {
      noise: {
        filter: 'bandpass', q: 3, fromHz: 180, toHz: 8000,
        volume: 0.26, attack: 0.3, duration: 0.65,
      },
      tone: {
        type: 'sawtooth', fromHz: 85, toHz: 1360,
        volume: 0.14, attack: 0.28, duration: 0.6,
      },
    },
    ko: {
      noise: {
        filter: 'lowpass', q: 1.2, fromHz: 3000, toHz: 130,
        volume: 0.34, attack: 0.003, duration: 0.36,
      },
      tone: {
        type: 'triangle', fromHz: 196, toHz: 49,
        volume: 0.48, attack: 0.005, duration: 0.9,
        notes: [
          { at: 0.15, hz: 146.83 },
          { at: 0.3, hz: 98 },
          { at: 0.5, hz: 49 },
        ],
      },
    },
  },
};

/**
 * [contact profile, pitch multiplier, envelope length multiplier, swing profile]
 */
const MOVE_VOICES = {
  axel: {
    jab: ['jab', 1, 1], cross: ['jab', 0.9, 1.12],
    hook: ['hit', 1.12, 0.9], launcher: ['heavy', 1.35, 0.8],
    sweep: ['hit', 0.85, 1.15], elbow: ['heavy', 1.1, 0.75],
    uppercut: ['heavy', 1.2, 1.05], grab: ['grab', 0.92, 1.15],
    airkick: ['hit', 1.22, 0.85],
  },
  rook: {
    jab: ['heavy', 0.92, 0.85], hammer: ['heavy', 0.78, 1.2],
    crusher: ['throw', 0.7, 1.25], pound: ['heavy', 0.65, 1.4, 'pound'],
    shoulder: ['heavy', 0.82, 1.05], lariat: ['heavy', 0.88, 1.3],
    backhand: ['hit', 0.72, 1.15], stomp: ['throw', 0.88, 0.9],
    airkick: ['throw', 0.8, 1.1],
  },
  zip: {
    jab: ['jab', 1.5, 0.62], cross: ['jab', 1.62, 0.68],
    hook: ['jab', 1.38, 0.75], finish: ['lightning', 1.35, 0.65],
    teleport: ['lightning', 1.55, 0.72, 'lightning'],
    'run-cancel': ['whiff', 1.7, 0.65], dive: ['jab', 1.18, 1.05],
    needle: ['jab', 1.75, 0.85], retreat: ['hit', 1.4, 0.68],
    airlight: ['jab', 1.58, 0.58],
  },
  pike: {
    jab: ['jab', 0.82, 1.25], extension: ['jab', 0.76, 1.4],
    thrust: ['hit', 1.45, 1.25], counter: ['parry', 0.94, 1.05],
    slide: ['hit', 0.94, 1.3], sweep: ['heavy', 1.06, 0.92],
    backstep: ['jab', 0.95, 1.18], antiair: ['hit', 1.3, 1.16],
    airkick: ['hit', 1.08, 1.08],
  },
  bastion: {
    jab: ['hit', 0.88, 0.95], shield: ['heavy', 1.02, 1.08],
    parry: ['parry', 0.8, 1.18], punish: ['throw', 0.95, 1.2],
    push: ['grab', 0.84, 0.9], reversal: ['heavy', 0.95, 1.16],
    sweep: ['hit', 0.78, 1.2], headbutt: ['heavy', 0.72, 0.88],
    airkick: ['hit', 0.92, 1.22],
  },
  ember: {
    jab: ['jab', 1.12, 1.1], heavy: ['heavy', 1.15, 1.22],
    projectile: ['projectileImpact', 0.92, 1.1, 'projectileLaunch'],
    dive: ['throw', 1.08, 1.15], overdrive: ['heavy', 0.85, 1.5, 'super'],
    sweep: ['hit', 1.04, 1.28],
    burst: ['projectileImpact', 0.72, 1.25, 'projectileLaunch'],
    uppercut: ['heavy', 1.42, 0.94], airlight: ['hit', 1.26, 1.2],
  },
};

function tuneVoice(profile, pitch, length) {
  const voice = { ...AUDIO.sounds[profile] };
  for (const key of ['noise', 'tone']) {
    const layer = voice[key];
    if (!layer) continue;
    voice[key] = {
      ...layer,
      fromHz: layer.fromHz * pitch,
      toHz: layer.toHz * pitch,
      attack: layer.attack * length,
      duration: layer.duration * length,
    };
    if (layer.pulses) {
      voice[key].pulses = layer.pulses.map((pulse) => ({
        ...pulse, at: pulse.at * length,
      }));
    }
    if (layer.notes) {
      voice[key].notes = layer.notes.map((note) => ({
        at: note.at * length, hz: note.hz * pitch,
      }));
    }
  }
  return voice;
}

for (const [character, rows] of Object.entries(MOVE_DATA)) {
  for (const row of rows) {
    const [profile, pitch, length, swing = 'whiff'] = MOVE_VOICES[character][row[0]];
    const id = `${character}-${row[0]}`;
    row[9].sound = id;
    AUDIO.sounds[id] = {
      ...tuneVoice(profile, pitch, length),
      swing: tuneVoice(swing, pitch, length),
    };
  }
}

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

export const MAP_THEMES = [
  {
    id: 'dojo', name: 'Lantern Dojo',
    floorColor: 0x382113, skyColor: 0x24150e,
    fog: { color: 0x392719, near: 80, far: 180 },
    roughness: 0.85, metalness: 0, boundaryColor: 0xe6b46b,
    grade: {
      bloom: { strength: 0.38, radius: 0.65, threshold: 1.05 },
      exposure: 1.05, vignette: 0.22, saturation: -0.06,
      tint: [1.08, 1.01, 0.9], contrast: 0.94,
    },
    lights: [
      { type: 'hemisphere', color: 0xffdda5, groundColor: 0x39221a, intensity: 1.1 },
      { type: 'directional', color: 0xffd49b, intensity: 2.0, position: [4, 9, 5], shadow: true },
      { type: 'directional', color: 0xa6b5d4, intensity: 0.6, position: [-5, 6, -6] },
    ],
    decor: {
      woodColors: [0x85502b, 0x975f34, 0xa76b3c, 0x754525],
      boardWidth: 0.5, boardLength: 3, boardThickness: 0.08, boardGap: 0.018,
      frameColor: 0x362017, paperColor: 0xe8d8b7, paperGlow: 0.12,
      screenSpacing: 2.3, screenZ: -MAP_ART.floorDepth / 2,
      screenWidth: 2.26, screenHeight: 3.6, screenColumns: 3, screenRows: 4,
      frameWidth: 0.065,
      lanternColor: 0xffb95b, lanternGlow: 2.2, lanternSpacing: 4.5,
      lanternY: 3.6, lanternZ: -MAP_ART.floorDepth / 2 + 0.3,
      lanternRadius: 0.36, cordLength: 1.0, cordWidth: 0.025,
      capScale: 0.42, capHeight: 0.08, lightIntensity: 8, lightDistance: 7,
    },
  },
  {
    id: 'neon-street', name: 'Neon Street',
    floorColor: 0x151c29, skyColor: 0x030611,
    fog: { color: 0x0c1027, near: 80, far: 180 },
    roughness: 0.18, metalness: 0.45, boundaryColor: 0x6fe7ff,
    grade: {
      bloom: { strength: 1.25, radius: 0.5, threshold: 0.72 },
      exposure: 1.0, vignette: 0.3, saturation: 0.16,
      tint: [1.02, 0.97, 1.08], contrast: 1.06,
    },
    lights: [
      { type: 'hemisphere', color: 0x6f8dcc, groundColor: 0x101327, intensity: 0.85 },
      { type: 'directional', color: 0xb7d4ff, intensity: 1.6, position: [4, 9, 5], shadow: true },
      { type: 'directional', color: 0xff55cb, intensity: 0.85, position: [-5, 6, -6] },
    ],
    decor: {
      buildingColor: 0x151a29, buildingZ: -MAP_ART.floorDepth / 2 - 0.6,
      buildingHeight: 6, buildingWidth: 3.5, buildingDepth: 0.8,
      signSpacing: 3.8, signColors: [0xff329e, 0x27dbff, 0xb983ff],
      signBackingColor: 0x080a13, signY: 2.7,
      signZ: -MAP_ART.floorDepth / 2 - 0.12,
      signWidth: 2.2, signHeight: 1.25, signDepth: 0.08,
      signGlow: 3, signRoughness: 0.35, strokeWidth: 0.055,
      glyphCount: 3, glyphSpacing: 0.55, glyphHeight: 0.65, glyphWidth: 0.3,
      lightIntensity: 18, lightDistance: 9, lightOffset: 0.55,
      reflectionRows: 24, reflectionStartZ: -MAP_ART.floorDepth / 2 + 0.7,
      reflectionLength: MAP_ART.floorDepth - 1.4,
      reflectionOpacity: 0.3, reflectionJitter: 0.32,
      reflectionMinWidth: 0.3, reflectionWidthRange: 0.7, reflectionStripDepth: 0.13,
      curbColor: 0x424557, curbWidth: 0.65, curbHeight: 0.2,
      curbLength: 1.2, curbGap: 0.035,
      puddleColor: 0x28415d, puddleRoughness: 0.06, puddleMetalness: 0.65,
      puddleOpacity: 0.3, puddleArea: 8, puddleWidth: 0.7, puddleDepth: 0.3,
    },
  },
  {
    id: 'temple-courtyard', name: 'Dusk Temple',
    floorColor: 0x343640, skyColor: 0x55405f,
    fog: { color: 0x695b78, near: 80, far: 180 },
    roughness: 0.92, metalness: 0.03, boundaryColor: 0xd7b18a,
    grade: {
      bloom: { strength: 0.18, radius: 0.8, threshold: 1.2 },
      exposure: 1.08, vignette: 0.12, saturation: -0.24,
      tint: [1.06, 1.01, 0.92], contrast: 0.8,
    },
    lights: [
      { type: 'hemisphere', color: 0xbaacd7, groundColor: 0x343440, intensity: 1.15 },
      { type: 'directional', color: 0xffb879, intensity: 2.1, position: [-6, 8, 4], shadow: true },
      { type: 'directional', color: 0x999fff, intensity: 0.8, position: [5, 6, -6] },
    ],
    decor: {
      colors: [0x73737c, 0x85818a, 0x676b76, 0x8b8587],
      tileSize: 1.2, gap: 0.035, thickness: 0.1,
      pillarColor: 0x9c9290, trimColor: 0x6e6670,
      pillarSpacing: 4.5, pillarZ: -MAP_ART.floorDepth / 2 - 0.3,
      sidePillarZs: [-3.8, 0, 3.8], pillarRadius: 0.3, pillarHeight: 3.4,
      baseWidth: 0.95, baseHeight: 0.3, capHeight: 0.22,
      steps: 3, stepsSpacing: 8, stepsZ: -MAP_ART.floorDepth / 2 - 1.4,
      stepsWidth: 5.8, stepsHeight: 0.18, stepsDepth: 1.5, stepHeight: 0.18,
      stepDepth: 0.3, stepInset: 0.5,
    },
  },
  {
    id: 'rooftop', name: 'Highline Rooftop',
    floorColor: 0x363e4c, skyColor: 0x8babc8,
    fog: { color: 0x9aadc5, near: 65, far: 160 },
    roughness: 0.93, metalness: 0.03, boundaryColor: 0xb8c9de,
    grade: {
      bloom: { strength: 0.42, radius: 0.7, threshold: 1.1 },
      exposure: 1.18, vignette: 0.08, saturation: -0.12,
      tint: [0.9, 1.01, 1.13], contrast: 0.98,
    },
    lights: [
      { type: 'hemisphere', color: 0xa5bbdf, groundColor: 0x293343, intensity: 1.25 },
      { type: 'directional', color: 0xd4e3ff, intensity: 1.75, position: [4, 9, 5], shadow: true },
      { type: 'directional', color: 0xffbb82, intensity: 0.65, position: [-5, 6, -6] },
    ],
    decor: {
      colors: [0x656b75, 0x606773, 0x707580],
      tileSize: 3, gap: 0.026, thickness: 0.08,
      parapetColor: 0x717781, parapetInset: 0.3,
      parapetHeight: 0.55, parapetWidth: 0.28,
      cityColor: 0x172132, cityZ: -MAP_ART.floorDepth / 2 - 7,
      cityDepth: 8, cityBaseY: -6, towerSpacing: 2.25,
      towerWidth: 1.8, towerDepth: 1.8, towerMinHeight: 6, towerHeightRange: 9,
      windowColors: [0xffd59a, 0x91bce8, 0xe6edff],
      windowColumns: 3, windowSpacingX: 0.42, windowSpacingY: 0.7,
      windowWidth: 0.14, windowHeight: 0.24, unlitFraction: 0.5,
      equipmentColor: 0x4c5666, equipmentSpacing: 5.5,
      equipmentZ: -MAP_ART.floorDepth / 2 - 1.4,
      equipmentWidth: 1.1, equipmentHeight: 0.9, equipmentDepth: 0.9,
      ventColor: 0x232c39, ventCount: 4, ventHeight: 0.035, ventWidthScale: 0.8,
    },
  },
];

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
export const SUPER_DATA = {
  axel: {
    name: 'Skyline Rush', kind: 'rush', clip: 'dash',
    damage: 42, reach: 2.2, durationFrames: 78, startupFrames: 12,
    speed: 9, stopDistance: 1.2, color: MOVE_RULES.colors.impact,
    sound: 'heavy',
    hits: [
      { frame: 12, damage: 8 },
      { frame: 21, damage: 8 },
      { frame: 30, damage: 10 },
      { frame: 39, damage: 16, launch: 9, knockback: 1 },
    ],
  },
  rook: {
    name: 'Worldbreaker', kind: 'pound', clip: 'jump',
    damage: 50, reach: Math.hypot(ARENA.limitX, ARENA.limitZ) * 2,
    durationFrames: 90, startupFrames: 30,
    leapHeight: 3.2, radial: true, color: MOVE_RULES.colors.shockwave,
    sound: 'pound',
    hits: [{ frame: 30, damage: 50, knocksDown: true, knockback: 12 }],
  },
  zip: {
    name: 'Everywhere at Once', kind: 'flurry', clip: 'dash',
    damage: 36, reach: 3.4, durationFrames: 66, startupFrames: 10,
    orbitRadius: 1.1, strikeRadius: 1.6,
    angles: [Math.PI, 0, Math.PI / 2, -Math.PI / 2, Math.PI, 0],
    color: MOVE_RULES.colors.flash, sound: 'lightning',
    hits: [
      { frame: 10, damage: 6 }, { frame: 17, damage: 6 },
      { frame: 24, damage: 6 }, { frame: 31, damage: 6 },
      { frame: 38, damage: 6 },
      { frame: 45, damage: 6, knocksDown: true, knockback: 5 },
    ],
  },
  pike: {
    name: 'Unbroken Line', kind: 'thrust', clip: 'punch',
    damage: 58, reach: 8, durationFrames: 100, startupFrames: 28,
    pierceBlock: true, color: MOVE_RULES.colors.reach, sound: 'throw',
    hits: [{ frame: 28, damage: 58, knocksDown: true, knockback: 14 }],
  },
  bastion: {
    name: 'Final Rebuttal', kind: 'counter', clip: 'block',
    damage: 66, reach: 4, durationFrames: 108, startupFrames: 6,
    counterEndFrame: 48, radial: true,
    color: MOVE_RULES.colors.guard, sound: 'throw',
    punish: { damage: 66, knocksDown: true, knockback: 15, pierceBlock: true },
    hits: [],
  },
  ember: {
    name: 'Storm Pyre', kind: 'column', clip: 'punch',
    damage: 46, reach: 6, durationFrames: 96, startupFrames: 24,
    strikeRadius: 1.5, columnHeight: 8,
    color: MOVE_RULES.colors.flame, sound: 'lightning',
    hits: [
      { frame: 24, damage: 34 },
      { frame: 42, damage: 4, burn: true },
      { frame: 60, damage: 4, burn: true },
      { frame: 78, damage: 4, burn: true, knocksDown: true, knockback: 4 },
    ],
  },
};

/**
 * Decoration-only allowance, included in MAP_ART.meshBudget by tests.
 * Background specs are far-to-near. Factors are world X motion / camera X
 * motion; foreground edge safety may constrain its authored motion.
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
