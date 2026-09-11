import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Fighter, State } from '../renderer/src/fighter.js';
import { ARENA, COMBAT, STATE_CLIP } from '../renderer/src/config.js';

const DT = 1 / 120;
const from = new THREE.Vector3(-1, ARENA.floorY, 0);

function makeFighter({
  x = 0, height = 0, stats = {}, clips = {},
} = {}) {
  const edges = new Set();
  const holds = new Set();
  const direction = { x: 0, y: 0 };
  const played = [];
  const sounds = [];
  const fighter = new Fighter({
    model: new THREE.Object3D(),
    animator: {
      has: (name) => Object.hasOwn(clips, name),
      length(name) {
        assert.ok(Object.hasOwn(clips, name), `read missing clip: ${name}`);
        return clips[name];
      },
      play(name, options) {
        played.push({ name, ...options });
        return Object.hasOwn(clips, name);
      },
      update() {},
    },
    controller: {
      move: () => direction,
      pressed(action) {
        // Deliberately consuming: Fighter must snapshot each edge only once.
        const pressed = edges.has(action);
        edges.delete(action);
        return pressed;
      },
      held: (action) => holds.has(action),
    },
    spawn: { x, y: ARENA.floorY + height, z: 0 },
    stats,
    onSound: (sound) => sounds.push(sound),
  });
  return { fighter, edges, holds, direction, played, sounds };
}

function step(fighter, dt = DT, fighters = [fighter]) {
  fighter.update(dt, { fighters });
}

function runUntil(fighter, predicate, maxFrames = 1200) {
  for (let i = 0; i < maxFrames && !predicate(); i++) step(fighter);
  assert.ok(predicate(), `timed out in ${fighter.state}`);
}

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}

const airCases = [
  ['light', State.AIR_LIGHT_ATTACK, State.LIGHT_ATTACK, COMBAT.airLightAttack],
  ['heavy', State.AIR_HEAVY_ATTACK, State.HEAVY_ATTACK, COMBAT.airHeavyAttack],
  ['kick', State.DIVE_KICK, State.KICK, COMBAT.diveKick],
];

for (const [action, airState, groundState, move] of airCases) {
  test(`${action}: air variant requires actual takeoff, including fresh floor spawns`, () => {
    const ground = makeFighter();
    assert.equal(ground.fighter.onFloor, false);
    ground.edges.add(action);
    step(ground.fighter);
    assert.equal(ground.fighter.state, groundState);
    assert.equal(ground.fighter.airborneSwing, false);

    const jumping = makeFighter();
    step(jumping.fighter);
    jumping.edges.add('jump');
    step(jumping.fighter);
    assert.equal(jumping.fighter.state, State.JUMP);
    assert.ok(jumping.fighter.position.y > ARENA.floorY);
    assert.equal(jumping.fighter.onFloor, false);

    jumping.edges.add(action);
    step(jumping.fighter);
    assert.equal(jumping.fighter.state, airState);
    assert.equal(jumping.fighter.airborneSwing, true);
    assert.equal(jumping.fighter.attackDamage, move.damage);
    assert.equal(jumping.fighter.attackKnockback, move.knockback);
    close(jumping.fighter.swingLength, move.duration);
  });

  test(`${action}: missing clips are safe; loaded clips do not change air timing`, () => {
    for (const clips of [{}, { [STATE_CLIP[airState]]: 3.7 }]) {
      const rig = makeFighter({ height: 2, stats: { damageScale: 1.5 }, clips });
      rig.fighter.state = State.JUMP;
      rig.edges.add(action);
      assert.doesNotThrow(() => step(rig.fighter));
      assert.equal(rig.fighter.state, airState);
      close(rig.fighter.swingLength, move.duration);
      close(rig.fighter.attackDamage, move.damage * 1.5);
      assert.equal(rig.played.at(-1).name, STATE_CLIP[airState]);
      assert.ok(Number.isFinite(rig.played.at(-1).speed));
    }
  });

  test(`${action}: landing cancels the swing and discards buffered air intent`, () => {
    const rig = makeFighter({ height: 1 });
    rig.fighter.state = State.JUMP;
    rig.edges.add(action);
    step(rig.fighter);
    assert.equal(rig.fighter.state, airState);

    rig.fighter.position.y = ARENA.floorY + 0.001;
    rig.fighter.velocity.y = -10;
    rig.edges.add('heavy');
    step(rig.fighter);

    assert.equal(rig.fighter.onFloor, true);
    assert.equal(rig.fighter.state, State.IDLE);
    assert.equal(rig.fighter.hitboxLive, false);
    assert.equal(rig.fighter.airborneSwing, false);
    assert.equal(rig.fighter.bufferedAttack, null);
    step(rig.fighter);
    assert.equal(rig.fighter.state, State.IDLE);
    assert.equal(rig.sounds.filter((sound) => sound === 'land').length, 1);
  });
}

test('legacy airborne attack remains a knockdown punch', () => {
  const rig = makeFighter({ height: 1 });
  rig.fighter.state = State.JUMP;
  rig.edges.add('attack');
  step(rig.fighter);
  assert.equal(rig.fighter.state, State.ATTACK);
  assert.equal(rig.fighter.attackKnocksDown, true);
});

test('air light recovery returns to jump before landing', () => {
  const rig = makeFighter({ height: 10 });
  rig.fighter.state = State.JUMP;
  rig.edges.add('light');
  step(rig.fighter);
  runUntil(rig.fighter, () => rig.fighter.state !== State.AIR_LIGHT_ATTACK);
  assert.equal(rig.fighter.state, State.JUMP);
  assert.equal(rig.fighter.onFloor, false);
  assert.equal(rig.fighter.hitboxLive, false);
});

test('dive reverses ascent and cannot be cancelled after its hit window', () => {
  const rig = makeFighter({ height: 20 });
  rig.fighter.state = State.JUMP;
  rig.fighter.velocity.y = 7;
  rig.edges.add('kick');
  step(rig.fighter);
  assert.equal(rig.fighter.state, State.DIVE_KICK);
  assert.ok(rig.fighter.velocity.y <= -COMBAT.diveKick.downSpeed);

  rig.direction.x = -1;
  rig.holds.add('block');
  rig.holds.add('run');
  rig.edges.add('jump');
  rig.edges.add('dash');
  rig.edges.add('heavy');
  step(rig.fighter, COMBAT.diveKick.duration + DT);
  assert.equal(rig.fighter.state, State.DIVE_KICK);
  assert.ok(rig.fighter.velocity.y <= -COMBAT.diveKick.downSpeed);
  assert.equal(rig.fighter.velocity.x, 0);
  assert.equal(rig.fighter.hitboxLive, false);

  runUntil(rig.fighter, () => rig.fighter.onFloor);
  assert.equal(rig.fighter.state, State.IDLE);
});

test('airborne hits increment juggle count and scale damage after defence', () => {
  const { fighter } = makeFighter({ height: 2, stats: { defenceScale: 2 } });
  let previousLoss = Infinity;

  for (let count = 1; count <= COMBAT.juggle.limit; count++) {
    const before = fighter.health.current;
    assert.equal(fighter.takeHit(20, from), 'hit');
    assert.equal(fighter.juggleCount, count);
    assert.equal(fighter.comboCount, count);

    const loss = before - fighter.health.current;
    close(loss, 10 * Math.max(
      COMBAT.juggle.minDamageScale,
      COMBAT.juggle.damageDecay ** (count - 1),
    ));
    assert.ok(loss < previousLoss);
    previousLoss = loss;

    if (count < COMBAT.juggle.limit) {
      assert.equal(fighter.state, State.JUGGLE);
      assert.equal(fighter.velocity.y, 0);
    } else {
      assert.equal(fighter.state, State.KNOCKDOWN);
      assert.ok(fighter.velocity.y <= -COMBAT.juggle.endFallSpeed);
    }
  }

  const health = fighter.health.current;
  assert.equal(fighter.takeHit(20, from), undefined);
  assert.equal(fighter.health.current, health);
  assert.equal(fighter.juggleCount, COMBAT.juggle.limit);
});

test('juggle floats briefly, suppresses input, then falls while still in hitstun', () => {
  const rig = makeFighter({ height: 2 });
  rig.fighter.takeHit(5, from);
  const height = rig.fighter.position.y;
  rig.edges.add('heavy');
  rig.edges.add('jump');
  rig.edges.add('dash');
  rig.holds.add('block');
  rig.direction.x = 1;

  step(rig.fighter, COMBAT.juggle.floatSeconds / 2);
  close(rig.fighter.position.y, height);
  assert.equal(rig.fighter.state, State.JUGGLE);
  assert.equal(rig.fighter.bufferedAttack, null);

  step(rig.fighter, COMBAT.juggle.floatSeconds);
  assert.ok(rig.fighter.position.y < height);
  assert.ok(rig.fighter.velocity.y < 0);
  assert.equal(rig.fighter.state, State.JUGGLE);

  // A follow-up refreshes the brief float, not the juggle budget.
  rig.fighter.takeHit(5, from);
  assert.equal(rig.fighter.juggleCount, 2);
  const followupHeight = rig.fighter.position.y;
  step(rig.fighter, COMBAT.juggle.floatSeconds / 2);
  close(rig.fighter.position.y, followupHeight);
});

test('combo-display timeout cannot replenish the airborne juggle budget', () => {
  const { fighter } = makeFighter({ height: 2 });
  fighter.takeHit(5, from);
  fighter.updateCombatTimers(COMBAT.comboWindowSeconds + DT);
  assert.equal(fighter.comboCount, 0);
  assert.equal(fighter.juggleCount, 1);
  fighter.takeHit(5, from);
  assert.equal(fighter.juggleCount, 2);
});

test('landing ends juggle hitstun and resets scaling for the next jump', () => {
  const { fighter } = makeFighter({ height: 1 });
  fighter.takeHit(10, from);
  fighter.takeHit(10, from);
  runUntil(fighter, () => fighter.onFloor);

  assert.equal(fighter.state, State.IDLE);
  assert.equal(fighter.juggleCount, 0);
  assert.equal(fighter.comboCount, 0);
  assert.equal(fighter.comboTimeLeft, 0);

  fighter.position.y = ARENA.floorY + 1;
  fighter.onFloor = false;
  fighter.state = State.JUMP;
  const before = fighter.health.current;
  fighter.takeHit(10, from);
  assert.equal(fighter.juggleCount, 1);
  close(before - fighter.health.current, 10);
});

test('limit knockdown cannot recover in midair and remains protected on landing', () => {
  const { fighter } = makeFighter({ height: 100 });
  for (let i = 0; i < COMBAT.juggle.limit; i++) fighter.takeHit(1, from);

  step(fighter, COMBAT.reaction.knockdown + DT);
  assert.equal(fighter.onFloor, false);
  assert.equal(fighter.state, State.KNOCKDOWN);

  runUntil(fighter, () => fighter.onFloor);
  assert.equal(fighter.juggleCount, 0);
  assert.equal(fighter.state, State.KNOCKDOWN);
  assert.equal(fighter.takeHit(10, from), undefined);

  runUntil(fighter, () => fighter.state === State.IDLE);
  assert.equal(fighter.invulnerable, true);
  assert.equal(fighter.takeHit(10, from), undefined);
});

test('grounded, blocked, invulnerable and zero-damage hits do not earn juggle count', () => {
  const ground = makeFighter();
  ground.fighter.takeHit(10, from);
  assert.equal(ground.fighter.state, State.HIT);
  assert.equal(ground.fighter.juggleCount, 0);

  const blocked = makeFighter({ height: 1 }).fighter;
  blocked.state = State.BLOCK;
  blocked.facingSign = -1;
  assert.equal(blocked.takeHit(10, from), 'block');
  assert.equal(blocked.juggleCount, 0);

  const immune = makeFighter({ height: 1 }).fighter;
  immune.invulnerable = true;
  assert.equal(immune.takeHit(10, from), undefined);
  assert.equal(immune.juggleCount, 0);

  const zero = makeFighter({ height: 1 }).fighter;
  zero.takeHit(0, from);
  assert.equal(zero.juggleCount, 0);
});

test('lethal airborne damage keeps KO and round reset clears air tracking', () => {
  const { fighter } = makeFighter({ height: 1, stats: { maxHealth: 5 } });
  fighter.takeHit(10, from);
  assert.equal(fighter.state, State.KO);
  assert.equal(fighter.juggleCount, 1);
  runUntil(fighter, () => fighter.onFloor);
  assert.equal(fighter.state, State.KO);
  assert.equal(fighter.juggleCount, 0);

  fighter.juggleCount = 3;
  fighter.airborneSwing = true;
  fighter.resetCombatTracking();
  assert.equal(fighter.juggleCount, 0);
  assert.equal(fighter.airborneSwing, false);
});

test('air hitboxes connect once per swing and allow a subsequent juggle hit', () => {
  const attacker = makeFighter({ x: -0.6, height: 1 });
  const defender = makeFighter({ x: 0.6, height: 1 });
  const a = attacker.fighter;
  const d = defender.fighter;
  const world = [a, d];
  a.state = State.JUMP;
  attacker.edges.add('light');
  step(a, DT, world);

  const activeStart = COMBAT.airLightAttack.duration * COMBAT.airLightAttack.hitWindowStart;
  step(a, activeStart + DT, world);
  assert.equal(d.state, State.JUGGLE);
  assert.equal(d.juggleCount, 1);
  const health = d.health.current;
  step(a, DT, world);
  assert.equal(d.health.current, health);
  assert.equal(d.juggleCount, 1);

  // A different swing uses its own alreadyHit set and can extend the juggle.
  const followup = makeFighter({ x: -0.6, height: 1 });
  followup.fighter.state = State.JUMP;
  followup.edges.add('heavy');
  step(followup.fighter, DT, [followup.fighter, d]);
  step(
    followup.fighter,
    COMBAT.airHeavyAttack.duration * COMBAT.airHeavyAttack.hitWindowStart + DT,
    [followup.fighter, d],
  );
  assert.equal(d.juggleCount, 2);
  assert.ok(d.health.current < health);
});
