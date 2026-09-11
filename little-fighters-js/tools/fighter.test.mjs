/**
 * Headless tests for the ported combat logic — no renderer, no Electron.
 *
 *   node --test tools/fighter.test.mjs
 *
 * These cover the parts of the port most likely to be silently wrong: the
 * timing windows, the hitbox geometry, directional blocking, and the
 * knockdown chain. Rendering is not tested here; that needs eyes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { Fighter, State, moveToward, lerpAngle } from '../renderer/src/fighter.js';
import { COMBAT, BODY } from '../renderer/src/config.js';

/** An animator with known clip lengths, so timing is deterministic. */
function fakeAnimator(lengths = {}) {
  const defaults = {
    idle: 1, walk: 1, run: 1, jump: 0.8, punch: 0.5, kick: 0.6,
    dropkick: 1.2, hit: 0.4, block: 1, dash: 0.3, knockdown: 1.4,
    getup: 0.7, death: 2,
  };
  const table = { ...defaults, ...lengths };
  return {
    has: (n) => n in table,
    length: (n) => table[n] ?? 0,
    play: () => true,
    update: () => {},
    currentName: () => null,
  };
}

function stubController() {
  const presses = new Set();
  const holds = new Set();
  return {
    move: () => ({ x: 0, y: 0 }),
    pressed: (a) => presses.has(a),
    held: (a) => holds.add && holds.has(a),
    presses, holds,
  };
}

function makeFighter(spawn = { x: 0, y: 0, z: 0 }, controller = stubController()) {
  const f = new Fighter({
    model: new THREE.Object3D(),
    animator: fakeAnimator(),
    controller,
    spawn,
    name: 'T',
  });
  f.onFloor = true;
  return f;
}

/** Advance a world of fighters in fixed steps. */
function step(world, seconds, dt = 1 / 60) {
  for (let t = 0; t < seconds; t += dt) {
    for (const f of world.fighters) f.update(dt, world);
    for (const f of world.fighters) f.controller.presses?.clear();
  }
}

test('moveToward never overshoots', () => {
  assert.equal(moveToward(0, 10, 3), 3);
  assert.equal(moveToward(0, 2, 5), 2);
  assert.equal(moveToward(5, -5, 2), 3);
  assert.equal(moveToward(-1, -1, 9), -1);
});

test('lerpAngle takes the short way around the circle', () => {
  const r = lerpAngle(0.1, Math.PI * 2 - 0.1, 0.5);
  // Should move backwards through zero, not forwards the long way.
  assert.ok(Math.abs(r) < 0.15 || Math.abs(r - Math.PI * 2) < 0.15, `got ${r}`);
});

test('a punch enters ATTACK and returns to IDLE after the clip', () => {
  const f = makeFighter();
  const world = { fighters: [f] };

  f.controller.presses.add('attack');
  f.update(1 / 60, world);
  assert.equal(f.state, State.ATTACK);
  assert.equal(f.swingLength, 0.5, 'swing length should come from the clip');

  step(world, 0.6);
  assert.equal(f.state, State.IDLE);
});

test('the hitbox is live only inside the timing window', () => {
  const f = makeFighter();
  const world = { fighters: [f] };
  f.controller.presses.add('attack');
  f.update(1 / 60, world);

  const start = f.swingLength * COMBAT.hitWindowStart;
  const end = f.swingLength * COMBAT.hitWindowEnd;

  const seen = [];
  for (let t = 0; t < f.swingLength; t += 1 / 120) {
    f.update(1 / 120, world);
    seen.push({ t: f.stateTime, live: f.hitboxLive });
  }
  const liveWindow = seen.filter((s) => s.live);
  assert.ok(liveWindow.length > 0, 'hitbox never went live');
  assert.ok(liveWindow[0].t >= start - 0.02, 'went live too early');
  assert.ok(liveWindow.at(-1).t <= end + 0.02, 'stayed live too long');
});

test('a punch in range damages the target exactly once per swing', () => {
  const attacker = makeFighter({ x: 0, y: 0, z: 0 });
  const target = makeFighter({ x: 0, y: 0, z: 1.0 });
  attacker.rotationY = 0;                       // facing +Z, toward the target
  const world = { fighters: [attacker, target] };

  attacker.controller.presses.add('attack');
  attacker.update(1 / 60, world);
  step(world, 0.6);

  assert.equal(target.health.current, 100 - COMBAT.attackDamage);
});

test('a punch out of range does nothing', () => {
  const attacker = makeFighter({ x: 0, y: 0, z: 0 });
  const target = makeFighter({ x: 0, y: 0, z: 5 });
  attacker.rotationY = 0;
  const world = { fighters: [attacker, target] };

  attacker.controller.presses.add('attack');
  attacker.update(1 / 60, world);
  step(world, 0.6);

  assert.equal(target.health.current, 100);
});

test('a punch aimed away from the target misses', () => {
  const attacker = makeFighter({ x: 0, y: 0, z: 0 });
  const target = makeFighter({ x: 0, y: 0, z: 1.0 });
  attacker.rotationY = Math.PI;                 // facing -Z, away
  const world = { fighters: [attacker, target] };

  attacker.controller.presses.add('attack');
  attacker.update(1 / 60, world);
  step(world, 0.6);

  assert.equal(target.health.current, 100, 'hitbox should not reach behind');
});

test('blocking toward the attacker cuts damage; blocking away does not', () => {
  const facing = makeFighter();
  facing.facingSign = 1;
  facing.state = State.BLOCK;
  facing.takeHit(20, new THREE.Vector3(2, 0, 0));     // attacker to the +X side
  assert.equal(facing.health.current, 100 - Math.round(20 * COMBAT.blockDamageMult));

  const turned = makeFighter();
  turned.facingSign = -1;
  turned.state = State.BLOCK;
  turned.takeHit(20, new THREE.Vector3(2, 0, 0));     // attacker behind the guard
  assert.equal(turned.health.current, 80, 'a block facing away should not protect');
});

test('a knockdown hit runs KNOCKDOWN -> GETUP -> IDLE', () => {
  const f = makeFighter();
  const world = { fighters: [f] };

  f.takeHit(10, new THREE.Vector3(1, 0, 0), true);
  assert.equal(f.state, State.KNOCKDOWN);

  // Reaction windows are authored in COMBAT.reaction, not read off the clip
  // — see the stun-lock fix. Drive the test from the same source the code uses
  // rather than from a clip length that no longer decides anything.
  step(world, COMBAT.reaction.knockdown + 0.05);
  assert.equal(f.state, State.GETUP);

  step(world, COMBAT.reaction.getup + 0.05);
  assert.equal(f.state, State.IDLE);
});

test('a fighter already down cannot be hit again', () => {
  const f = makeFighter();
  f.takeHit(10, new THREE.Vector3(1, 0, 0), true);
  const hp = f.health.current;
  f.takeHit(50, new THREE.Vector3(1, 0, 0));
  assert.equal(f.health.current, hp, 'hits should not stack on a downed fighter');
});

test('reaching zero health enters KO', () => {
  const f = makeFighter();
  f.takeHit(100, new THREE.Vector3(1, 0, 0));
  assert.equal(f.state, State.KO);
  assert.equal(f.health.current, 0);
});

test('the drop kick knocks down and stops its lunge on impact', () => {
  const attacker = makeFighter({ x: 0, y: 0, z: 0 });
  const target = makeFighter({ x: 0, y: 0, z: 1.2 });
  attacker.rotationY = 0;
  const world = { fighters: [attacker, target] };

  attacker.controller.holds.add('run');
  attacker.controller.move = () => ({ x: 0, y: 1 });
  attacker.controller.presses.add('kick');
  attacker.update(1 / 60, world);
  assert.equal(attacker.state, State.DROPKICK);

  step(world, 0.5);
  assert.ok(attacker.dropkickConnected, 'the lunge should register a hit');
  assert.equal(target.state, State.KNOCKDOWN);
  assert.equal(target.health.current, 100 - COMBAT.dropkickDamage);
});

test('fighters are pushed apart instead of overlapping', () => {
  const a = makeFighter({ x: 0, y: 0, z: 0 });
  const b = makeFighter({ x: 0.1, y: 0, z: 0 });
  const world = { fighters: [a, b] };
  step(world, 0.2);
  const gap = Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
  assert.ok(gap >= BODY.radius * 2 - 0.02, `fighters overlap: gap ${gap.toFixed(3)}`);
});

test('fighters stay inside the arena bounds', () => {
  const f = makeFighter({ x: 0, y: 0, z: 0 });
  f.controller.move = () => ({ x: 1, y: 0 });
  const world = { fighters: [f] };
  step(world, 4);
  assert.ok(f.position.x <= 2.75, `walked through the wall to x=${f.position.x}`);
});
