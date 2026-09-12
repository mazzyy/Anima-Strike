/**
 * An authored move must enter the state its button implies.
 *
 *   node --test tools/move-states.test.mjs
 *
 * The bug this exists to prevent: #startMove() entered State.ATTACK — the
 * LEGACY action state — for every authored move, whatever button produced it.
 * Light, heavy and kick all collapsed into one state, so nothing downstream
 * could tell them apart. main.js reads State.HEAVY_ATTACK to decide whether a
 * hit earns hit-stop, so once the roster's moves landed, no heavy ever
 * registered as heavy and the whole impact system went quiet.
 *
 * The button is the last token of the command: 'forward,down,light' is a light.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { Fighter, State } from '../renderer/src/fighter.js';
import { MOVES } from '../renderer/src/moves.js';

function missingAnimator() {
  return {
    has: () => false, length: () => 0, play: () => false,
    update: () => {}, currentName: () => null,
  };
}

/** Press one button once and run a single frame. */
function press(button, { character = null, airborne = false } = {}) {
  let pending = true;
  const fighter = new Fighter({
    model: new THREE.Group(),
    animator: missingAnimator(),
    controller: {
      move: () => ({ x: 0, y: 0 }),
      held: () => false,
      pressed: (action) =>
        (action === button && pending) ? (pending = false, true) : false,
    },
    spawn: { x: -1, y: 0, z: 0 },
    character,
  });
  fighter.onFloor = !airborne;
  if (airborne) fighter.position.y = 2;
  fighter.update(0.001, { fighters: [fighter] });
  return fighter;
}

test('a roster fighter enters the state its button implies', () => {
  for (const [button, expected] of [
    ['light', State.LIGHT_ATTACK],
    ['heavy', State.HEAVY_ATTACK],
    ['kick', State.KICK],
  ]) {
    const fighter = press(button, { character: 'rook' });
    assert.equal(fighter.state, expected,
      `${button} entered ${fighter.state}; State.ATTACK here means every move `
      + 'has collapsed into the legacy state again');
  }
});

test('an authored move actually resolved — the test is not measuring the fallback', () => {
  const fighter = press('heavy', { character: 'rook' });
  assert.ok(fighter.currentMove, 'no authored move resolved');
  assert.equal(fighter.currentMove.character, 'rook');
  assert.ok(String(fighter.currentMove.input).endsWith('heavy'));
});

test('a fighter with no roster entry still uses the plain states', () => {
  assert.equal(press('light').state, State.LIGHT_ATTACK);
  assert.equal(press('heavy').state, State.HEAVY_ATTACK);
});

test('airborne presses still reach the air variants', () => {
  assert.equal(press('light', { character: 'rook', airborne: true }).state,
    State.AIR_LIGHT_ATTACK);
  assert.equal(press('heavy', { character: 'rook', airborne: true }).state,
    State.AIR_HEAVY_ATTACK);
});

test('every authored command ends in a button the state map knows', () => {
  // 'grab' and 'dash' commands deliberately keep the legacy State.ATTACK:
  // a command throw and a teleport are not punches, and nothing downstream
  // reads them as such. They are listed so a NEW unmapped button is caught.
  const known = new Set(['light', 'heavy', 'kick', 'grab', 'super', 'dash']);
  for (const [character, moves] of Object.entries(MOVES)) {
    for (const move of moves) {
      const button = String(move.input).split(',').pop().trim();
      assert.ok(known.has(button),
        `${character}/${move.id} ends in '${button}', which nothing maps to a state`);
    }
  }
});
