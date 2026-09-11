import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Fighter, State } from '../renderer/src/fighter.js';
import { COMBAT } from '../renderer/src/config.js';

function setup(lengths = {}) {
  const edges = new Set();
  const held = new Set();
  const direction = { x: 0, y: 0 };
  const plays = [];
  const fighter = new Fighter({
    model: new THREE.Object3D(),
    animator: {
      has: (clip) => Object.hasOwn(lengths, clip),
      length: (clip) => {
        assert.ok(Object.hasOwn(lengths, clip), 'missing clips use fallback timing');
        return lengths[clip];
      },
      play: (clip) => {
        plays.push(clip);
        return Object.hasOwn(lengths, clip);
      },
      update() {},
    },
    controller: {
      move: () => direction,
      // Deliberately consuming: buffering must not read an edge twice.
      pressed: (action) => edges.delete(action),
      held: (action) => held.has(action),
    },
    spawn: { x: -1, y: 0, z: 0 },
  });
  fighter.onFloor = true;
  const world = { fighters: [fighter] };
  return {
    fighter, held, direction, plays,
    tick(dt = 0.01, ...actions) {
      actions.forEach((action) => edges.add(action));
      fighter.update(dt, world);
      edges.clear();
    },
  };
}

const attackerPosition = new THREE.Vector3(1, 0, 0);

test('a late punch chains immediately, once, even with missing clips', () => {
  const { fighter, tick, held, plays } = setup();
  tick(0.01, 'attack');
  assert.equal(fighter.state, State.ATTACK);

  tick(fighter.swingLength - 0.1, 'attack');
  assert.equal(plays.filter((clip) => clip === 'punch').length, 1);
  assert.equal(fighter.bufferedAttack, 'attack');

  tick(0.101);
  assert.equal(fighter.state, State.ATTACK);
  assert.equal(fighter.stateTime, 0);
  assert.equal(fighter.bufferedAttack, null);
  assert.equal(plays.filter((clip) => clip === 'punch').length, 2);

  held.add('attack');
  tick(fighter.swingLength + 0.01);
  assert.equal(fighter.state, State.IDLE, 'holding does not enqueue another swing');
});

test('an early press expires rather than creating a long attack queue', () => {
  const { fighter, tick } = setup();
  tick(0.01, 'attack');
  tick(0.01, 'attack');
  tick(COMBAT.attackBufferSeconds + 0.01);
  assert.equal(fighter.bufferedAttack, null);
  tick(fighter.swingLength);
  assert.equal(fighter.state, State.IDLE);
});

test('latest edge wins, with punch priority for simultaneous edges', () => {
  const { fighter, tick } = setup();
  tick(0.01, 'attack');
  tick(fighter.swingLength - 0.1, 'attack');
  tick(0.01, 'kick');
  tick(0.091);
  assert.equal(fighter.state, State.KICK);
  assert.equal(fighter.attackDamage, COMBAT.kickDamage);

  tick(fighter.swingLength - 0.1, 'attack', 'kick');
  tick(0.101);
  assert.equal(fighter.state, State.ATTACK);
  assert.equal(fighter.attackDamage, COMBAT.attackDamage);
});

test('buffered running kick preserves dropkick per-swing values', () => {
  const { fighter, tick, held, direction } = setup({ punch: 0.8 });
  tick(0.01, 'attack');
  assert.equal(fighter.swingLength, 0.8);

  tick(0.7, 'kick');
  held.add('run');
  direction.x = 1;
  tick(0.101);

  assert.equal(fighter.state, State.DROPKICK);
  assert.equal(fighter.attackDamage, COMBAT.dropkickDamage);
  assert.equal(fighter.attackKnockback, COMBAT.dropkickKnockback);
  assert.equal(fighter.attackKnocksDown, true);
});

test('block retains priority; releasing it consumes a recent attack', () => {
  const { fighter, tick, held } = setup();
  held.add('block');
  tick(0.01, 'attack');
  assert.equal(fighter.state, State.BLOCK);
  held.delete('block');
  tick(0.05);
  assert.equal(fighter.state, State.ATTACK);
});

test('air punches still knock down; kicks do not cancel a jump', () => {
  const { fighter, tick } = setup();
  tick(0.01, 'jump');
  assert.equal(fighter.state, State.JUMP);
  tick(0.01, 'kick');
  assert.equal(fighter.state, State.JUMP);
  tick(0.01, 'attack');
  assert.equal(fighter.state, State.ATTACK);
  assert.equal(fighter.attackKnocksDown, true);
});

test('an interruption clears old input, but a fresh recovery press works', () => {
  const { fighter, tick } = setup();
  tick(0.01, 'attack');
  tick(0.01, 'kick');
  fighter.takeHit(1, attackerPosition);
  assert.equal(fighter.bufferedAttack, null);

  tick(fighter.reactionLength - 0.1, 'attack');
  assert.equal(fighter.state, State.HIT);
  tick(0.101);
  assert.equal(fighter.state, State.ATTACK);
  assert.equal(fighter.comboCount, 0);
});

// This block replaced a single test that asserted a defender was STILL in
// hitstun a full second after being hit, with a 3-second hit clip. That was
// only true because hitstun was read from the clip, which is the stun-lock bug
// — see tools/fighter-stun.test.mjs. The intent (count hits, expire the count)
// is kept; the premise that stun outlasts the combo window is not.

test('combos count hits that land before the defender recovers', () => {
  const { fighter, tick } = setup({ hit: 3 });
  fighter.takeHit(1, attackerPosition);
  assert.equal(fighter.comboCount, 1);

  tick(COMBAT.reaction.hitStun / 2);
  assert.equal(fighter.state, State.HIT, 'still inside the reaction');
  fighter.takeHit(1, attackerPosition);
  assert.equal(fighter.comboCount, 2, 'a hit inside stun continues the string');
});

test('recovering ends the combo, however long the hit clip is', () => {
  const { fighter, tick } = setup({ hit: 3 });
  fighter.takeHit(1, attackerPosition);

  tick(COMBAT.reaction.hitStun + 0.02);
  assert.notEqual(fighter.state, State.HIT, 'a 3s clip must not mean 3s of stun');
  assert.equal(fighter.comboCount, 0, 'recovery ends the string');

  fighter.takeHit(1, attackerPosition);
  assert.equal(fighter.comboCount, 1, 'and the next hit starts a fresh one');
});

test('the inter-hit timeout still zeroes a count during a long reaction', () => {
  // Knockdown plus getup outlasts the combo window, so the timeout can still
  // fire before the defender is back on its feet.
  const { fighter, tick } = setup({ hit: 3, knockdown: 3, getup: 3 });
  fighter.takeHit(1, attackerPosition, true);
  assert.equal(fighter.state, State.KNOCKDOWN);
  assert.equal(fighter.comboCount, 1);

  tick(COMBAT.comboWindowSeconds + 0.02);
  assert.notEqual(fighter.state, State.IDLE, 'timeout can precede recovery');
  assert.equal(fighter.comboCount, 0);
});

test('normal hit recovery ends a combo before its timeout', () => {
  const { fighter, tick } = setup();
  fighter.takeHit(1, attackerPosition);
  tick(0.1);
  fighter.takeHit(1, attackerPosition);
  assert.equal(fighter.comboCount, 2);

  tick(fighter.reactionLength + 0.01);
  assert.equal(fighter.state, State.IDLE);
  assert.equal(fighter.comboCount, 0);
  assert.equal(fighter.comboTimeLeft, 0);
});

test('knockdown/getup reject hits; combo clears when getup completes', () => {
  const { fighter, tick } = setup();
  fighter.takeHit(1, attackerPosition);
  fighter.takeHit(1, attackerPosition, true);
  assert.equal(fighter.comboCount, 2);
  const health = fighter.health.current;

  fighter.takeHit(1, attackerPosition);
  assert.equal(fighter.health.current, health);
  assert.equal(fighter.comboCount, 2);

  tick(fighter.reactionLength + 0.001);
  assert.equal(fighter.state, State.GETUP);
  assert.equal(fighter.comboCount, 2);
  fighter.takeHit(1, attackerPosition);
  assert.equal(fighter.health.current, health);
  assert.equal(fighter.comboCount, 2);

  tick(fighter.reactionLength + 0.001);
  assert.equal(fighter.state, State.IDLE);
  assert.equal(fighter.comboCount, 0);
});

test('blocked and zero-damage hits do not count; rear hits do', () => {
  const { fighter, tick, held } = setup();
  held.add('block');
  tick();
  fighter.takeHit(COMBAT.attackDamage, attackerPosition);
  assert.equal(fighter.state, State.BLOCK);
  assert.equal(fighter.comboCount, 0);

  const behind = new THREE.Vector3(-2, 0, 0);
  fighter.takeHit(0, behind);
  assert.equal(fighter.comboCount, 0);
  fighter.takeHit(1, behind);
  assert.equal(fighter.comboCount, 1);
});

test('lethal hits count once, KO accepts no buffered input, and timers still expire', () => {
  const { fighter, tick } = setup();
  fighter.takeHit(1, attackerPosition);
  fighter.takeHit(fighter.health.max, attackerPosition);
  assert.equal(fighter.state, State.KO);
  assert.equal(fighter.comboCount, 2);

  fighter.takeHit(1, attackerPosition);
  tick(0.01, 'attack');
  assert.equal(fighter.comboCount, 2);
  assert.equal(fighter.bufferedAttack, null);

  fighter.updateCombatTimers(COMBAT.comboWindowSeconds);
  assert.equal(fighter.comboCount, 0);
  assert.equal(fighter.state, State.KO);
});

test('lethal blocked chip damage preserves KO and never adds a combo hit', () => {
  const { fighter, tick, held } = setup();
  held.add('block');
  tick();
  fighter.health.current = 1;
  fighter.takeHit(COMBAT.attackDamage, attackerPosition);
  assert.equal(fighter.state, State.KO);
  assert.equal(fighter.comboCount, 0);
});

test('one swing cannot inflate the combo across multiple active frames', () => {
  const attacker = setup();
  const defender = setup();
  attacker.fighter.position.set(-0.6, 0, 0);
  defender.fighter.position.set(0.6, 0, 0);
  const world = { fighters: [attacker.fighter, defender.fighter] };

  attacker.tick(0.01, 'attack');
  attacker.fighter.update(COMBAT.attackDuration * COMBAT.hitWindowStart, world);
  assert.equal(defender.fighter.comboCount, 1);
  const health = defender.fighter.health.current;

  attacker.fighter.update(0.01, world);
  assert.equal(defender.fighter.comboCount, 1);
  assert.equal(defender.fighter.health.current, health);
  assert.equal(attacker.fighter.comboCount, 0);
});

test('round tracking reset clears both counters and pending input', () => {
  const { fighter, tick } = setup();
  fighter.takeHit(1, attackerPosition);
  tick(0.01, 'attack');
  assert.equal(fighter.comboCount, 1);
  assert.equal(fighter.bufferedAttack, 'attack');

  const state = fighter.state;
  const health = fighter.health.current;
  fighter.resetCombatTracking();
  assert.equal(fighter.comboCount, 0);
  assert.equal(fighter.comboTimeLeft, 0);
  assert.equal(fighter.bufferedAttack, null);
  assert.equal(fighter.attackBufferLeft, 0);
  assert.equal(fighter.state, state);
  assert.equal(fighter.health.current, health);
});
