/**
 * Guards against stun-lock: the defender must always get frames of its own.
 *
 *   node --test tools/fighter-stun.test.mjs
 *
 * The bug this exists to prevent: hitstun was taken from the length of the
 * reaction clip. hit.glb runs 0.83s; a light jab's entire cycle is 0.30s. So
 * the attacker landed a fresh jab roughly every 0.30s while the defender was
 * locked for 0.83s, and the defender never got a single frame in which it
 * could act. Not hard AI — arithmetic.
 *
 * Clip lengths below are the real measured durations of the shipped .glb
 * files, so these tests fail if anyone reconnects stun to clip length.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { Fighter, State } from '../renderer/src/fighter.js';
import { COMBAT, ARENA } from '../renderer/src/config.js';

/** Measured from the shipped assets — see tools/setup-assets.mjs. */
const CLIP_SECONDS = {
  idle: 9.97, walk: 1.07, run: 0.57, jump: 1.50, punch: 1.07, kick: 1.63,
  dropkick: 2.93, hit: 0.83, block: 1.73, dash: 0.70, knockdown: 2.63,
  getup: 2.73, death: 3.07,
};

function realAnimator() {
  const played = [];
  return {
    played,
    has: (n) => n in CLIP_SECONDS,
    length: (n) => CLIP_SECONDS[n] ?? 0,
    play: (n, opts) => { played.push({ name: n, ...opts }); return true; },
    update: () => {},
    currentName: () => played.at(-1)?.name ?? null,
  };
}

function stubController(overrides = {}) {
  return {
    move: () => ({ x: 0, y: 0 }),
    pressed: () => false,
    held: () => false,
    ...overrides,
  };
}

function makeFighter(spawn, controller = stubController()) {
  const f = new Fighter({
    model: new THREE.Object3D(),
    animator: realAnimator(),
    controller,
    spawn,
    name: 'T',
  });
  f.onFloor = true;
  return f;
}

const LIGHT_CYCLE = COMBAT.attackDuration / COMBAT.lightAttack.speed;   // 0.30s

test('the light jab really is faster than a hit reaction used to be', () => {
  // Anchors the premise. If the jab ever becomes slower than hitstun, the
  // arithmetic below stops meaning what it says.
  assert.ok(LIGHT_CYCLE < CLIP_SECONDS.hit,
    'the whole point is that a jab cycles faster than the hit clip plays');
});

test('hitstun comes from config, not from the length of hit.glb', () => {
  const f = makeFighter(ARENA.spawnP1);
  f.takeHit(5, new THREE.Vector3(1, 0, 0));

  assert.equal(f.state, State.HIT);
  assert.equal(f.reactionLength, COMBAT.reaction.hitStun);
  assert.ok(f.reactionLength < CLIP_SECONDS.hit,
    `stun ${f.reactionLength}s must not be the clip's ${CLIP_SECONDS.hit}s`);
});

test('a defender recovers before the attacker can jab again', () => {
  const f = makeFighter(ARENA.spawnP1);
  f.takeHit(5, new THREE.Vector3(1, 0, 0));

  assert.ok(f.reactionLength < LIGHT_CYCLE,
    `hitstun ${f.reactionLength.toFixed(3)}s must be under the attacker's `
    + `${LIGHT_CYCLE.toFixed(3)}s jab cycle, or pressure costs nothing`);
});

test('hitstun decays across a combo so a string has to end', () => {
  const f = makeFighter(ARENA.spawnP1);
  const from = new THREE.Vector3(1, 0, 0);
  const windows = [];

  for (let hit = 0; hit < 8; hit++) {
    f.state = State.IDLE;                 // pretend it recovered
    f.takeHit(1, from);
    windows.push(f.reactionLength);
  }

  for (let i = 1; i < windows.length; i++) {
    assert.ok(windows[i] <= windows[i - 1],
      `hit ${i + 1} stunned longer than hit ${i}`);
  }
  assert.ok(windows.at(-1) < windows[0], 'stun never decayed at all');
  assert.ok(windows.at(-1) >= COMBAT.reaction.minHitStun,
    'stun fell below its own floor');
});

test('a jab-mashing attacker cannot hold a defender down forever', () => {
  // The real scenario, played out on the clock: one fighter lands a jab the
  // instant its cycle allows, forever. The defender must still get frames in
  // which it is not locked in a reaction.
  const defender = makeFighter(ARENA.spawnP1);
  const from = new THREE.Vector3(1, 0, 0);

  const dt = 1 / 60;
  let sinceLastJab = Infinity;
  let freeFrames = 0;

  for (let frame = 0; frame < 60 * 5; frame++) {
    if (sinceLastJab >= LIGHT_CYCLE) {
      defender.takeHit(1, from);
      sinceLastJab = 0;
    }
    sinceLastJab += dt;

    defender.updateCombatTimers(dt);
    defender.stateTime += dt;
    if (defender.state === State.HIT && defender.stateTime >= defender.reactionLength) {
      defender.state = State.IDLE;
      defender.stateTime = 0;
    }
    if (defender.state !== State.HIT) freeFrames++;
    if (!defender.health.isAlive()) break;
  }

  assert.ok(freeFrames > 30,
    `defender got ${freeFrames} actionable frames in five seconds of pressure `
    + '— that is a stun-lock, not a combo');
});

test('a reaction clip is re-timed to the window, never cut off', () => {
  const f = makeFighter(ARENA.spawnP1);
  f.animator.played.length = 0;
  f.takeHit(5, new THREE.Vector3(1, 0, 0));

  const hit = f.animator.played.find((p) => p.name === 'hit');
  assert.ok(hit, 'the hit clip should still play');
  assert.ok(hit.speed > 1, 'a short window must speed the clip up');
  assert.ok(hit.speed <= COMBAT.reaction.maxClipSpeed,
    'clip speed must stay under the cap or the reaction reads as a twitch');
  assert.ok(Math.abs(hit.speed - CLIP_SECONDS.hit / f.reactionLength) < 1e-6,
    'clip speed should exactly fit the clip into the window');
});

test('knockdown plus getup is no longer four seconds on the floor', () => {
  const total = COMBAT.reaction.knockdown + COMBAT.reaction.getup;
  const old = CLIP_SECONDS.knockdown / COMBAT.knockdownSpeed + CLIP_SECONDS.getup;

  assert.ok(total < 1.6, `${total.toFixed(2)}s on the floor is still too long`);
  assert.ok(total < old / 2, `barely better than the old ${old.toFixed(2)}s`);
});

test('standing up grants a moment of invulnerability', () => {
  const f = makeFighter(ARENA.spawnP1);
  f.takeHit(5, new THREE.Vector3(1, 0, 0), true);
  assert.equal(f.state, State.KNOCKDOWN);

  // Run it through knockdown and getup.
  const dt = 1 / 60;
  for (let i = 0; i < 60 * 3 && f.state !== State.IDLE; i++) {
    f.update(dt, { fighters: [f] });
  }
  assert.equal(f.state, State.IDLE, 'should be back on its feet');
  assert.ok(f.invulnerable, 'and briefly untouchable');

  const before = f.health.current;
  f.takeHit(20, new THREE.Vector3(1, 0, 0));
  assert.equal(f.health.current, before, 'a hit during the window must do nothing');
  assert.equal(f.state, State.IDLE, 'and must not re-stun');
});

test('invulnerability expires', () => {
  const f = makeFighter(ARENA.spawnP1);
  f.invulnerableLeft = COMBAT.reaction.getupInvulnerable;

  const dt = 1 / 60;
  for (let t = 0; t <= COMBAT.reaction.getupInvulnerable + 0.1; t += dt) {
    f.updateCombatTimers(dt);
  }
  assert.equal(f.invulnerable, false);

  const before = f.health.current;
  f.takeHit(10, new THREE.Vector3(1, 0, 0));
  assert.ok(f.health.current < before, 'hits must land again once it lapses');
});
