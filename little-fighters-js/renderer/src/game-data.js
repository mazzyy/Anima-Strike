/**
 * Bulk data tables: sound envelopes, move lists, super definitions.
 *
 * Large, rarely edited, and irrelevant to almost every change — but while they
 * lived in config.js, any item touching any tunable had to reproduce all of
 * them. Split out for the same reason as map-themes.js.
 *
 * Declaration order matters here: the loop below MOVE_DATA stamps a sound id
 * onto every move row, so AUDIO and MOVE_DATA must keep the order they had.
 *
 * Imports one way only: this reads config.js, config.js never reads this.
 */

import { COMBAT, ARENA, MOVE_RULES } from './config.js';

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
