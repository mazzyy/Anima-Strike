import test from 'node:test';
import assert from 'node:assert/strict';
import { Object3D } from 'three';
import { Fighter, State } from '../renderer/src/fighter.js';
import {
  ARENA, COMBAT, FIGHTER_STATS, HEALTH, MOVEMENT,
} from '../renderer/src/config.js';

function controller({ press, moving = false, run = false, block = false } = {}) {
  const edges = new Set(press ? [press] : []);
  return {
    move: () => ({ x: moving ? 1 : 0, y: 0 }),
    pressed: (action) => edges.delete(action),
    held: (action) => (action === 'run' && run) || (action === 'block' && block),
  };
}

function fighter(options = {}) {
  const result = new Fighter({
    model: new Object3D(),
    animator: {
      has: () => false,
      length: () => assert.fail('Missing clips must use fallback durations'),
      play: () => false,
      update: () => {},
    },
    controller: controller(),
    spawn: { x: 0, y: ARENA.floorY, z: 0 },
    ...options,
  });
  result.onFloor = true;
  return result;
}

test('omitting stats matches the config constants field for field', () => {
  const f = fighter();
  assert.deepEqual(f.stats, {
    maxHealth: HEALTH.max,
    walkSpeed: MOVEMENT.walkSpeed,
    runSpeed: MOVEMENT.runSpeed,
    jumpSpeed: MOVEMENT.jumpVelocity,
    damageScale: 1,
    defenceScale: 1,
  });
  assert.deepEqual(f.stats, FIGHTER_STATS);
  assert.notStrictEqual(f.stats, FIGHTER_STATS);
  assert.equal(f.health.max, HEALTH.max);
  assert.equal(f.health.current, HEALTH.max);
  assert.equal(f.attackDamage, COMBAT.attackDamage);
});

test('partial stats are copied independently and maxHealth initializes health', () => {
  const stats = { maxHealth: 180, damageScale: 2 };
  const first = fighter({ stats });
  const second = fighter({ stats });

  assert.deepEqual(first.stats, { ...FIGHTER_STATS, ...stats });
  assert.equal(first.health.max, 180);
  assert.equal(first.health.current, 180);
  assert.notStrictEqual(first.stats, stats);
  assert.notStrictEqual(first.stats, second.stats);

  stats.damageScale = 3;
  first.stats.walkSpeed = 9;
  assert.equal(first.stats.damageScale, 2);
  assert.equal(second.stats.damageScale, 2);
  assert.equal(second.stats.walkSpeed, MOVEMENT.walkSpeed);
  assert.equal(FIGHTER_STATS.walkSpeed, MOVEMENT.walkSpeed);
});

const attacks = [
  { action: 'attack', state: State.ATTACK, damage: COMBAT.attackDamage },
  { action: 'light', state: State.LIGHT_ATTACK, damage: COMBAT.lightAttack.damage },
  { action: 'heavy', state: State.HEAVY_ATTACK, damage: COMBAT.heavyAttack.damage },
  { action: 'kick', state: State.KICK, damage: COMBAT.kickDamage },
  {
    action: 'kick', state: State.DROPKICK, damage: COMBAT.dropkickDamage,
    moving: true, run: true,
  },
];

function landAttack(attack, attackerStats, defenderStats, blocked = false) {
  const attacker = fighter({
    stats: attackerStats,
    spawn: { x: -0.75, y: ARENA.floorY, z: 0 },
    controller: controller({ press: attack.action, ...attack }),
  });
  const defender = fighter({
    stats: defenderStats,
    spawn: { x: 0.75, y: ARENA.floorY, z: 0 },
    controller: controller({ block: blocked }),
  });
  const world = { fighters: [attacker, defender] };

  if (blocked) {
    defender.update(0.01, world);
    assert.equal(defender.state, State.BLOCK);
  }

  attacker.update(0.01, world);
  assert.equal(attacker.state, attack.state);
  const activeTime = attack.state === State.DROPKICK
    ? 0.15
    : attacker.swingLength * (COMBAT.hitWindowStart + COMBAT.hitWindowEnd) / 2;
  const before = defender.health.current;
  attacker.update(activeTime, world);

  assert.equal(attacker.swingConnected, true);
  assert.equal(attacker.alreadyHit.has(defender), true);
  const loss = before - defender.health.current;

  // Staying in the active window must not apply the scaled damage twice.
  attacker.update(0.001, world);
  assert.equal(defender.health.current, before - loss);
  return { attacker, defender, loss };
}

for (const attack of attacks) {
  test(`${attack.state}: damageScale 2 deals double damage`, () => {
    const normal = landAttack(attack);
    const strong = landAttack(attack, { damageScale: 2 });
    assert.equal(normal.loss, attack.damage);
    assert.equal(strong.loss, normal.loss * 2);
    assert.equal(strong.attacker.attackDamage, attack.damage * 2);
    assert.equal(strong.attacker.attackKnockback, normal.attacker.attackKnockback);
  });

  test(`${attack.state}: defenceScale 2 takes half damage`, () => {
    const normal = landAttack(attack);
    const defended = landAttack(attack, undefined, { defenceScale: 2 });
    assert.equal(defended.loss, normal.loss / 2);
    assert.equal(defended.defender.velocity.x, normal.defender.velocity.x);
  });
}

test('outgoing and incoming scales compose without applying either twice', () => {
  const result = landAttack(attacks[1], { damageScale: 2 }, { defenceScale: 2 });
  assert.equal(result.loss, COMBAT.lightAttack.damage);
});

test('defenceScale divides rounded block chip, retaining fractional damage', () => {
  const attack = attacks[1];
  const normal = landAttack(attack, undefined, undefined, true);
  const defended = landAttack(attack, undefined, { defenceScale: 2 }, true);
  assert.equal(normal.loss, Math.round(attack.damage * COMBAT.blockDamageMult));
  assert.equal(defended.loss, normal.loss / 2);
  assert.equal(defended.defender.state, State.BLOCK);
  assert.equal(defended.defender.comboCount, 0);
});

test('damageScale zero deals no damage', () => {
  const result = landAttack(attacks[0], { damageScale: 0 });
  assert.equal(result.loss, 0);
  assert.equal(result.defender.comboCount, 0);
});

test('a faster walkSpeed covers more ground in the same dt', () => {
  const normal = fighter({ controller: controller({ moving: true }) });
  const fast = fighter({
    stats: { walkSpeed: MOVEMENT.walkSpeed * 2 },
    controller: controller({ moving: true }),
  });
  const dt = 0.2;
  for (const f of [normal, fast]) {
    f.update(dt, { fighters: [f] });
    assert.equal(f.state, State.WALK);
    assert.equal(f.velocity.x, f.stats.walkSpeed);
    assert.equal(f.position.x, f.stats.walkSpeed * dt);
    assert.ok(f.position.x < ARENA.limitX, 'Movement must not hit the wall');
  }
  assert.ok(fast.position.x > normal.position.x);
});

test('runSpeed overrides grounded running speed', () => {
  const f = fighter({
    stats: { runSpeed: 8 },
    controller: controller({ moving: true, run: true }),
  });
  f.update(0.2, { fighters: [f] });
  assert.equal(f.state, State.RUN);
  assert.equal(f.velocity.x, 8);
  assert.equal(f.position.x, 8 * 0.2);
});

test('jumpSpeed overrides vertical takeoff without changing airborne move speed', () => {
  const f = fighter({
    stats: { jumpSpeed: 10 },
    controller: controller({ press: 'jump', moving: true }),
  });
  f.update(0.05, { fighters: [f] });
  assert.equal(f.state, State.JUMP);
  assert.equal(f.velocity.y, 10);
  assert.equal(f.position.y, ARENA.floorY + 10 * 0.05);
  assert.equal(f.velocity.x, MOVEMENT.jumpMoveSpeed);

  f.update(0.05, { fighters: [f] });
  assert.equal(f.velocity.y, 10 - MOVEMENT.gravity * 0.05);
  assert.equal(f.velocity.x, MOVEMENT.jumpMoveSpeed);
});
