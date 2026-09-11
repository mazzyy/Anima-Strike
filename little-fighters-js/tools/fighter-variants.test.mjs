/**
 * Headless regression tests for light/heavy punches, controls, and AI.
 * Existing legacy combat and buffer/combo tests remain unchanged.
 *
 *   node --test tools/fighter-variants.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { Fighter, State } from '../renderer/src/fighter.js';
import { AIController } from '../renderer/src/ai.js';
import { COMBAT, HEALTH, INPUT_MAPS } from '../renderer/src/config.js';
import {
  initInput, endInputFrame, keyboardController,
} from '../renderer/src/input.js';

const VARIANTS = [
  { action: 'light', state: State.LIGHT_ATTACK, tuning: COMBAT.lightAttack },
  { action: 'heavy', state: State.HEAVY_ATTACK, tuning: COMBAT.heavyAttack },
];

function fakeAnimator(missing = false) {
  const plays = [];
  return {
    plays,
    has: () => !missing,
    length: () => {
      assert.equal(missing, false, 'must not query a missing clip');
      return 0.6;
    },
    play: (clip, options) => {
      plays.push({ clip, ...options });
      return !missing;
    },
    update() {},
  };
}

function makeFighter({ missing = false, z = 0 } = {}) {
  const presses = new Set();
  const holds = new Set();
  const controller = {
    move: () => ({ x: 0, y: 0 }),
    pressed: (action) => presses.has(action),
    held: (action) => holds.has(action),
    presses,
    holds,
  };
  const fighter = new Fighter({
    model: new THREE.Object3D(),
    animator: fakeAnimator(missing),
    controller,
    spawn: { x: 0, y: 0, z },
  });
  fighter.onFloor = true;
  fighter.rotationY = 0;
  return fighter;
}

function press(fighter, action, world = { fighters: [fighter] }) {
  fighter.controller.presses.add(action);
  fighter.update(1 / 120, world);
  fighter.controller.presses.clear();
}

function finishSwing(fighter, world = { fighters: [fighter] }) {
  const maxSteps = Math.ceil(fighter.swingLength * 120) + 2;
  for (let i = 0; i < maxSteps && fighter.state !== State.IDLE; i += 1) {
    fighter.update(1 / 120, world);
  }
  assert.equal(fighter.state, State.IDLE);
}

test('light is faster and weaker than heavy, including recovery', () => {
  const light = makeFighter();
  const heavy = makeFighter();
  press(light, 'light');
  press(heavy, 'heavy');

  assert.ok(COMBAT.lightAttack.speed > 1);
  assert.ok(COMBAT.heavyAttack.speed < 1);
  assert.ok(light.attackDamage < heavy.attackDamage);
  assert.ok(light.attackKnockback < heavy.attackKnockback);
  assert.ok(light.swingLength < heavy.swingLength);

  const recoveryFraction = 1 - COMBAT.hitWindowEnd;
  assert.ok(
    light.swingLength * recoveryFraction < heavy.swingLength * recoveryFraction,
  );
});

for (const { action, state, tuning } of VARIANTS) {
  test(`${action}: shared clip, scaled timing, and one damaging hit per swing`, () => {
    const fighter = makeFighter();
    const target = makeFighter({ z: 1.2 });
    const world = { fighters: [fighter, target] };
    press(fighter, action, world);

    assert.equal(fighter.state, state);
    assert.equal(fighter.swingLength, 0.6 / tuning.speed);
    assert.equal(fighter.attackDamage, tuning.damage);
    assert.equal(fighter.attackKnockback, tuning.knockback);
    assert.equal(fighter.attackKnocksDown, false);
    assert.deepEqual(fighter.animator.plays.at(-1), {
      clip: 'punch',
      loop: false,
      speed: tuning.speed,
    });

    // Advance only the attacker so knockback does not move the test target
    // out of range. Repeated overlap must still produce only one hit.
    let connections = 0;
    fighter.onAttackConnected = () => { connections += 1; };
    const start = fighter.swingLength * COMBAT.hitWindowStart;
    const end = fighter.swingLength * COMBAT.hitWindowEnd;
    const maxSteps = Math.ceil(fighter.swingLength * 120) + 2;

    for (let i = 0; i < maxSteps && fighter.state !== State.IDLE; i += 1) {
      fighter.update(1 / 120, world);
      if (fighter.state === state) {
        assert.equal(
          fighter.hitboxLive,
          fighter.stateTime >= start && fighter.stateTime <= end,
        );
      }
    }

    assert.equal(fighter.state, State.IDLE);
    assert.equal(fighter.hitboxLive, false);
    assert.equal(connections, 1);
    assert.equal(target.health.current, HEALTH.max - tuning.damage);
    assert.equal(target.velocity.z, tuning.knockback);
  });

  test(`${action}: missing clips use scaled fallback timing without throwing`, () => {
    const fighter = makeFighter({ missing: true });
    assert.doesNotThrow(() => press(fighter, action));
    assert.equal(fighter.state, state);
    assert.equal(fighter.swingLength, COMBAT.attackDuration / tuning.speed);
    finishSwing(fighter);
  });

  test(`${action}: can be buffered into recovery and holds do not repeat it`, () => {
    const fighter = makeFighter();
    const world = { fighters: [fighter] };
    press(fighter, action === 'light' ? 'heavy' : 'light', world);
    fighter.stateTime = fighter.swingLength - 0.05;

    press(fighter, action, world);
    assert.equal(fighter.bufferedAttack, action);
    fighter.controller.holds.add(action);
    fighter.update(0.05, world);

    assert.equal(fighter.state, state);
    assert.equal(fighter.bufferedAttack, null);
    assert.equal(fighter.attackBufferLeft, 0);

    finishSwing(fighter, world);
    fighter.update(0.01, world);
    assert.equal(fighter.state, State.IDLE);
  });

  test(`${action}: airborne punches retain knockdown behavior`, () => {
    const fighter = makeFighter();
    press(fighter, 'jump');
    assert.equal(fighter.state, State.JUMP);
    press(fighter, action);
    assert.equal(fighter.state, state);
    assert.equal(fighter.attackKnocksDown, true);
  });

  test(`${action}: interruption clears a pending variant`, () => {
    const fighter = makeFighter();
    press(fighter, action);
    fighter.controller.presses.add(action);
    fighter.update(0.01, { fighters: [fighter] });
    fighter.controller.presses.clear();
    assert.equal(fighter.bufferedAttack, action);

    fighter.takeHit(1, new THREE.Vector3(0, 0, 1));
    assert.equal(fighter.state, State.HIT);
    assert.equal(fighter.bufferedAttack, null);
    assert.equal(fighter.attackBufferLeft, 0);
  });
}

test('simultaneous heavy/light/kick edges choose heavy and read each edge once', () => {
  const fighter = makeFighter();
  const pending = new Set(['light', 'heavy', 'attack', 'kick']);
  const reads = new Map();
  fighter.controller.pressed = (action) => {
    reads.set(action, (reads.get(action) ?? 0) + 1);
    return pending.delete(action);
  };

  fighter.update(0.01, { fighters: [fighter] });

  assert.equal(fighter.state, State.HEAVY_ATTACK);
  for (const action of ['light', 'heavy', 'attack', 'kick']) {
    assert.equal(reads.get(action), 1);
  }
  assert.equal(pending.size, 0);
});

test('both players have separate light/heavy buttons without binding collisions', () => {
  const listeners = new Map();
  initInput({
    addEventListener: (name, callback) => listeners.set(name, callback),
  });

  try {
    const allCodes = Object.values(INPUT_MAPS).flatMap((map) => Object.values(map));
    assert.equal(new Set(allCodes).size, allCodes.length);

    for (const prefix of ['p1', 'p2']) {
      const controller = keyboardController(prefix);
      for (const action of ['light', 'heavy']) {
        const code = INPUT_MAPS[prefix][action];
        listeners.get('keydown')({ code, repeat: false, preventDefault() {} });

        assert.equal(controller.pressed(action), true);
        assert.equal(controller.pressed(action === 'light' ? 'heavy' : 'light'), false);
        assert.equal(controller.pressed('attack'), false);

        endInputFrame();
        assert.equal(controller.pressed(action), false);
        assert.equal(controller.held(action), true);
        listeners.get('keyup')({ code });
        assert.equal(controller.held(action), false);
      }
    }
  } finally {
    listeners.get('blur')();
  }
});

test('AI accepts both variants and legacy punch plans through its controller interface', (t) => {
  t.mock.method(Math, 'random', () => 0);
  const cases = [
    ['light', 'light'],
    ['jab', 'light'],
    ['punch', 'light'],
    ['attack', 'light'],
    ['heavy', 'heavy'],
    ['Heavy Punch', 'heavy'],
    ['heavy_attack', 'heavy'],
    ['kick', 'kick'],
  ];

  for (const [preferred, action] of cases) {
    const ai = new AIController({ useLLM: false });
    ai.attach(makeFighter(), makeFighter({ z: 1.2 }));
    ai.pendingPlan = { preferred };
    ai.update(0.01);
    assert.equal(ai.preferred, action);
    assert.equal(ai.pressed(action), true);
    ai.dispose();
  }
});

test('local AI can choose heavy without a model plan', (t) => {
  const ai = new AIController({ useLLM: false });
  ai.attach(makeFighter(), makeFighter({ z: 1.2 }));

  // Attack decision, ignore preference, then select heavy from the pool.
  const rolls = [0, 0.99, 0.5];
  t.mock.method(Math, 'random', () => rolls.shift() ?? 0);
  ai.update(0.01);

  assert.equal(ai.pressed('heavy'), true);
  ai.dispose();
});

test('AI recognizes both new swing states as attacks to guard against', (t) => {
  t.mock.method(Math, 'random', () => 0);
  for (const { state } of VARIANTS) {
    const ai = new AIController({ useLLM: false });
    const foe = makeFighter({ z: 1.2 });
    foe.state = state;
    ai.attach(makeFighter(), foe);
    ai.update(0.01);
    assert.equal(ai.held('block'), true);
    ai.dispose();
  }
});

test('model snapshots advertise both punches through the preload bridge', async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'lf');
  let snapshot;
  Object.defineProperty(globalThis, 'lf', {
    configurable: true,
    value: {
      requestTactic: async (value) => {
        snapshot = value;
        return { preferred: 'heavy' };
      },
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'lf', previous);
    else delete globalThis.lf;
  });

  const ai = new AIController();
  t.after(() => ai.dispose());
  ai.attach(makeFighter(), makeFighter({ z: 1.2 }));
  ai.thinkTimer = 0;
  ai.update(0.01);

  // Let the request and its promise callbacks finish without another AI tick.
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(snapshot.available_attacks.light.damage, COMBAT.lightAttack.damage);
  assert.equal(snapshot.available_attacks.heavy.damage, COMBAT.heavyAttack.damage);
  assert.equal(ai.preferred, 'light', 'plans must not commit outside update()');

  ai.update(0.01);
  assert.equal(ai.preferred, 'heavy');
});
