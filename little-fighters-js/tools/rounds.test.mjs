/**
 * Headless tests for the round system — no renderer, no Electron.
 *
 *   node --test tools/rounds.test.mjs
 *
 * Covers the parts most likely to be quietly wrong: who wins on a timeout,
 * that a KO ends the round immediately, that best-of-three actually ends at
 * two, and that fighters are genuinely restored between rounds.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { Fighter, State } from '../renderer/src/fighter.js';
import { RoundManager, Phase, resetFighter } from '../renderer/src/rounds.js';
import { ROUNDS, ARENA } from '../renderer/src/config.js';

function fakeAnimator() {
  const table = {
    idle: 1, walk: 1, run: 1, jump: 0.8, punch: 0.5, kick: 0.6, dropkick: 1.2,
    hit: 0.4, block: 1, dash: 0.3, knockdown: 1.4, getup: 0.7, death: 2,
  };
  return {
    has: (n) => n in table,
    length: (n) => table[n] ?? 0,
    play: () => true,
    update: () => {},
    currentName: () => null,
  };
}

function stubController() {
  return { move: () => ({ x: 0, y: 0 }), pressed: () => false, held: () => false };
}

function makeFighter(spawn) {
  const f = new Fighter({
    model: new THREE.Object3D(),
    animator: fakeAnimator(),
    controller: stubController(),
    spawn,
    name: 'T',
  });
  f.onFloor = true;
  return f;
}

function makeMatch() {
  const p1 = makeFighter(ARENA.spawnP1);
  const p2 = makeFighter(ARENA.spawnP2);
  const events = { ended: [], started: [], match: null };
  const rounds = new RoundManager({
    p1, p2,
    names: ['P1', 'P2'],
    onRoundEnd: (e) => events.ended.push(e),
    onRoundStart: (e) => events.started.push(e),
    onMatchEnd: (e) => { events.match = e; },
  });
  return { p1, p2, rounds, events };
}

/** Advance the manager in fixed steps. */
function step(rounds, seconds, dt = 1 / 60) {
  for (let t = 0; t < seconds; t += dt) rounds.update(dt);
}

test('a round starts fighting, with a full clock', () => {
  const { rounds } = makeMatch();
  assert.equal(rounds.phase, Phase.FIGHTING);
  assert.equal(rounds.active, true);
  assert.equal(rounds.timeLeftCeil, ROUNDS.seconds);
});

test('a KO ends the round immediately and awards it to the survivor', () => {
  const { p1, rounds, events } = makeMatch();
  p1.takeHit(999, new THREE.Vector3(1, 0, 0));
  assert.equal(p1.state, State.KO);

  rounds.update(1 / 60);
  assert.equal(events.ended.length, 1);
  assert.equal(events.ended[0].winner, 'p2');
  assert.equal(events.ended[0].reason, 'KO');
  assert.equal(rounds.phase, Phase.INTERMISSION);
});

test('running out of time awards the round on remaining health', () => {
  const { p1, rounds, events } = makeMatch();
  p1.takeHit(30, new THREE.Vector3(1, 0, 0));   // p1 now behind on health

  step(rounds, ROUNDS.seconds + 0.1);
  assert.equal(events.ended[0].reason, 'TIME');
  assert.equal(events.ended[0].winner, 'p2');
});

test('equal health at time up is a draw and awards nobody', () => {
  const { rounds, events } = makeMatch();
  step(rounds, ROUNDS.seconds + 0.1);
  assert.equal(events.ended[0].reason, 'DRAW');
  assert.equal(events.ended[0].winner, null);
  assert.deepEqual(rounds.wins, { p1: 0, p2: 0 });
});

test('the next round restores both fighters after the intermission', () => {
  const { p1, p2, rounds, events } = makeMatch();
  p1.takeHit(999, new THREE.Vector3(1, 0, 0));
  p2.position.x = 0.5;
  rounds.update(1 / 60);

  step(rounds, ROUNDS.intermissionSeconds + 0.1);

  assert.equal(rounds.phase, Phase.FIGHTING, 'should be fighting again');
  assert.equal(events.started.length, 1);
  assert.equal(rounds.round, 2);
  assert.equal(p1.state, State.IDLE, 'the knocked-out fighter should be up');
  assert.equal(p1.health.current, p1.health.max, 'health should be restored');
  assert.equal(p2.position.x, ARENA.spawnP2.x, 'fighters back on their marks');
  assert.equal(rounds.timeLeftCeil, ROUNDS.seconds, 'clock reset');
});

test('best of three ends the match at two wins, not three', () => {
  const { p1, rounds, events } = makeMatch();

  for (let i = 0; i < ROUNDS.toWin; i++) {
    p1.takeHit(999, new THREE.Vector3(1, 0, 0));
    rounds.update(1 / 60);
    if (rounds.phase === Phase.INTERMISSION) {
      step(rounds, ROUNDS.intermissionSeconds + 0.1);
    }
  }

  assert.equal(rounds.phase, Phase.MATCH_OVER);
  assert.equal(rounds.wins.p2, ROUNDS.toWin);
  assert.equal(events.match.winner, 'p2');
  assert.equal(events.match.name, 'P2');
});

test('nothing happens once the match is over', () => {
  const { p1, rounds, events } = makeMatch();
  for (let i = 0; i < ROUNDS.toWin; i++) {
    p1.takeHit(999, new THREE.Vector3(1, 0, 0));
    rounds.update(1 / 60);
    if (rounds.phase === Phase.INTERMISSION) step(rounds, ROUNDS.intermissionSeconds + 0.1);
  }
  const endedCount = events.ended.length;
  step(rounds, 10);
  assert.equal(events.ended.length, endedCount, 'no further rounds after the match');
  assert.equal(rounds.phase, Phase.MATCH_OVER);
});

test('resetFighter clears combat state, not just health', () => {
  const f = makeFighter(ARENA.spawnP1);
  f.takeHit(10, new THREE.Vector3(1, 0, 0), true);
  f.hitboxLive = true;
  f.alreadyHit.add('someone');
  f.velocity.set(5, 3, 5);

  resetFighter(f, ARENA.spawnP1);

  assert.equal(f.state, State.IDLE);
  assert.equal(f.health.current, f.health.max);
  assert.equal(f.hitboxLive, false);
  assert.equal(f.alreadyHit.size, 0);
  assert.equal(f.velocity.length(), 0);
  assert.equal(f.position.x, ARENA.spawnP1.x);
});

test('the banner text names the winner and the reason', () => {
  const { p1, rounds } = makeMatch();
  p1.takeHit(999, new THREE.Vector3(1, 0, 0));
  rounds.update(1 / 60);
  assert.match(rounds.describe(), /K\.O\..*P2/);
});
