import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Fighter, State } from '../renderer/src/fighter.js';
import { ARENA, COMBAT, INPUT_MAPS } from '../renderer/src/config.js';

const DT = 1 / 120;

function controller() {
  const edges = new Set();
  const down = new Set();
  return {
    dir: { x: 0, y: 0 },
    move() { return this.dir; },
    // Deliberately consuming: each action may be read only once per update.
    pressed(action) {
      const result = edges.has(action);
      edges.delete(action);
      return result;
    },
    held: (action) => down.has(action),
    press(...actions) { actions.forEach((action) => edges.add(action)); },
    hold(...actions) { actions.forEach((action) => down.add(action)); },
    clear() {
      edges.clear();
      down.clear();
      this.dir = { x: 0, y: 0 };
    },
  };
}

function animator(lengths = {}) {
  return {
    has: (clip) => Object.hasOwn(lengths, clip),
    length(clip) {
      assert.ok(Object.hasOwn(lengths, clip), 'never query a missing clip length');
      return lengths[clip];
    },
    play: (clip) => Object.hasOwn(lengths, clip),
    update() {},
  };
}

function scene({ aStats = {}, bStats = {}, lengths = {} } = {}) {
  const ca = controller();
  const cb = controller();
  const make = (x, controls, stats) => {
    const fighter = new Fighter({
      model: new THREE.Object3D(),
      animator: animator(lengths),
      controller: controls,
      spawn: { x, y: ARENA.floorY, z: 0 },
      stats,
    });
    fighter.onFloor = true;
    return fighter;
  };
  const a = make(-0.5, ca, aStats);
  const b = make(0.5, cb, bStats);
  const world = { fighters: [a, b] };
  return {
    a, b, ca, cb, world,
    step(dt = DT) {
      a.update(dt, world);
      b.update(dt, world);
    },
    advance(seconds) {
      for (let left = seconds; left > 1e-9;) {
        const dt = Math.min(DT, left);
        this.step(dt);
        left -= dt;
      }
    },
    connect() {
      ca.press('grab');
      this.step();
      assert.equal(a.state, State.GRAB);
      this.advance(a.grabStartup + DT);
      assert.equal(a.state, State.GRABBING);
      assert.equal(b.state, State.HELD);
      assert.equal(a.grabbedFighter, b);
      assert.equal(b.heldBy, a);
    },
  };
}

function placeInRange(s) {
  s.ca.clear();
  s.cb.clear();
  s.a.position.set(-0.5, ARENA.floorY, 0);
  s.b.position.set(0.5, ARENA.floorY, 0);
  s.a.velocity.set(0, 0, 0);
  s.b.velocity.set(0, 0, 0);
  s.a.onFloor = s.b.onFloor = true;
  s.a.rotationY = Math.PI / 2;
  s.b.rotationY = -Math.PI / 2;
}

test('grab bindings are new, distinct, and do not shadow another action', () => {
  assert.equal(INPUT_MAPS.p1.grab, 'KeyO');
  assert.equal(INPUT_MAPS.p2.grab, 'KeyC');
  const keys = Object.values(INPUT_MAPS).flatMap((map) => Object.values(map));
  assert.equal(new Set(keys).size, keys.length);
});

test('grab startup is slower than a light jab with missing or long clips', () => {
  for (const lengths of [{}, { punch: 2 }]) {
    const s = scene({ lengths });
    s.ca.press('grab');
    s.step();

    const jabStartup = (lengths.punch ?? COMBAT.attackDuration)
      / COMBAT.lightAttack.speed * COMBAT.hitWindowStart;
    assert.ok(s.a.grabStartup > jabStartup);

    s.advance(s.a.grabStartup - DT);
    assert.equal(s.a.state, State.GRAB);
    assert.equal(s.b.state, State.IDLE);
    s.advance(DT * 2);
    assert.equal(s.b.state, State.HELD);
  }
});

test('grab requires close range, front facing, same lane, and floor contact', () => {
  const cases = [
    (s) => { s.b.position.x = s.a.position.x + COMBAT.grab.range + 0.05; },
    (s) => { s.a.rotationY = -Math.PI / 2; },
    (s) => {
      s.b.position.x = s.a.position.x + 0.5;
      s.b.position.z = COMBAT.grab.halfWidth + 0.1;
    },
    (s) => { s.b.onFloor = false; s.b.position.y = 2; },
  ];

  for (const setup of cases) {
    const s = scene();
    s.a.reachScale = 10; // Roster reach never expands a grab.
    setup(s);
    s.ca.press('grab');
    s.a.update(DT, s.world);
    s.a.update(s.a.grabStartup + DT, s.world);
    assert.equal(s.a.state, State.GRAB_RECOVERY);
    assert.equal(s.a.grabbedFighter, null);
    assert.equal(s.b.heldBy, null);
    assert.equal(s.b.health.current, s.b.health.max);
  }

  const s = scene();
  s.b.position.x = s.a.position.x + COMBAT.grab.range - 0.01;
  s.connect();
  assert.equal(s.b.health.current, s.b.health.max, 'connection itself deals no damage');
});

test('contact rechecks range at the end of startup and cannot connect during recovery', () => {
  const s = scene();
  s.ca.press('grab');
  s.step();
  s.b.position.x = s.a.position.x + COMBAT.grab.range + 0.2;
  s.advance(s.a.grabStartup + DT);
  assert.equal(s.a.state, State.GRAB_RECOVERY);

  placeInRange(s);
  s.advance(COMBAT.grab.recoverySeconds + DT);
  assert.equal(s.a.state, State.IDLE);
  assert.equal(s.b.state, State.IDLE);
});

test('blocking does not prevent a grab', () => {
  const s = scene();
  s.cb.hold('block');
  s.step();
  assert.equal(s.b.state, State.BLOCK);
  s.connect();
  assert.equal(s.b.state, State.HELD);
});

test('invulnerable, special, airborne, already held, and throwing targets reject grabs', () => {
  for (const state of [
    State.KNOCKDOWN, State.GETUP, State.KO, State.DASH, State.DROPKICK,
    State.JUMP, State.HELD, State.GRABBING, State.THROW,
    'SPECIAL', 'RISING_STRIKE',
  ]) {
    const s = scene();
    s.b.state = state;
    // Only update the attacker, keeping the target in the tested state.
    s.ca.press('grab');
    s.a.update(DT, s.world);
    s.a.update(s.a.grabStartup + DT, s.world);
    assert.equal(s.a.state, State.GRAB_RECOVERY, state);
    assert.equal(s.a.grabbedFighter, null, state);
  }

  const s = scene();
  s.b.invulnerable = true;
  s.ca.press('grab');
  s.a.update(DT, s.world);
  s.a.update(s.a.grabStartup + DT, s.world);
  assert.equal(s.a.state, State.GRAB_RECOVERY);
});

test('fast separate mash edges escape and do not leak a buffered attack', () => {
  const s = scene();
  s.connect();

  for (let i = 0; i < COMBAT.grab.mashPresses; i++) {
    s.cb.press('light');
    s.step();
    if (i + 1 < COMBAT.grab.mashPresses) {
      assert.equal(s.b.state, State.HELD);
      s.advance(0.05);
    }
  }

  assert.equal(s.b.state, State.IDLE);
  assert.equal(s.a.state, State.GRAB_RECOVERY);
  assert.equal(s.b.heldBy, null);
  assert.equal(s.a.grabbedFighter, null);
  assert.equal(s.b.bufferedAttack, null);
  assert.ok(s.b.grabImmunityLeft > 0);
  assert.equal(s.b.health.current, s.b.health.max);
});

test('slow mash never accumulates enough recent edges to escape', () => {
  const s = scene();
  s.connect();
  const gap = COMBAT.grab.mashWindowSeconds / (COMBAT.grab.mashPresses - 2);

  for (let i = 0; i < COMBAT.grab.mashPresses; i++) {
    s.cb.press('light');
    s.step();
    assert.equal(s.b.state, State.HELD);
    if (i + 1 < COMBAT.grab.mashPresses) s.advance(gap);
  }

  assert.equal(s.b.heldBy, s.a);
  assert.equal(s.b.health.current, s.b.health.max);
});

test('movement, held buttons, and a single chord cannot escape or attack from a hold', () => {
  const s = scene();
  s.connect();
  const before = s.b.position.clone();
  s.cb.dir = { x: 1, y: 0 };
  s.cb.hold(...COMBAT.grab.mashActions);
  s.cb.press(...COMBAT.grab.mashActions);
  s.advance(COMBAT.grab.mashWindowSeconds + 0.05);

  assert.equal(s.b.state, State.HELD);
  assert.equal(s.b.mashTimes.length, 0, 'the single chord expired');
  assert.ok(s.b.position.distanceTo(before) < 1e-9);
  assert.equal(s.b.bufferedAttack, null);
  assert.equal(s.a.health.current, s.a.health.max);
});

test('hold expires without damage and clears both links', () => {
  const s = scene();
  s.connect();
  s.advance(COMBAT.grab.holdSeconds + DT);
  assert.equal(s.a.state, State.GRAB_RECOVERY);
  assert.equal(s.b.state, State.IDLE);
  assert.equal(s.a.grabbedFighter, null);
  assert.equal(s.b.heldBy, null);
  assert.ok(s.b.grabImmunityLeft > 0);
  assert.equal(s.b.health.current, s.b.health.max);
});

test('throw requires a fresh punch edge together with direction', () => {
  const s = scene();
  s.connect();

  s.ca.press('light');
  s.step();
  assert.equal(s.a.state, State.GRABBING, 'neutral attack does not throw');

  s.ca.dir = { x: 1, y: 0 };
  s.ca.hold('light');
  s.step();
  assert.equal(s.a.state, State.GRABBING, 'direction does not consume an old attack');

  s.ca.press('light');
  s.step();
  assert.equal(s.a.state, State.THROW);
  assert.equal(s.b.state, State.KNOCKDOWN);
});

test('forward and backward throws deal scaled damage, bypass block, and set knockdown', () => {
  for (const facing of [1, -1]) {
    for (const direction of [1, -1]) {
      const s = scene({
        aStats: { damageScale: 1.5 },
        bStats: { defenceScale: 2 },
      });
      if (facing < 0) {
        s.a.position.x = 0.5;
        s.b.position.x = -0.5;
        s.a.rotationY = -Math.PI / 2;
        s.b.rotationY = Math.PI / 2;
        s.a.facingSign = -1;
        s.b.facingSign = 1;
      }
      s.cb.hold('block');
      s.connect();
      const health = s.b.health.current;
      const xSign = facing * direction;
      s.ca.dir = { x: xSign, y: 0 };
      s.ca.press('attack');
      // Observe the exact launch velocity before the victim's friction step.
      s.a.update(DT, s.world);

      assert.equal(s.a.state, State.THROW);
      assert.equal(s.b.state, State.KNOCKDOWN);
      assert.equal(s.b.health.current, health - COMBAT.grab.damage * 1.5 / 2);
      assert.equal(s.a.attackDamage, COMBAT.grab.damage * 1.5);
      assert.equal(s.a.attackKnocksDown, true);
      assert.equal(s.b.velocity.x, xSign * COMBAT.grab.knockback);
      assert.ok(Math.abs(s.b.velocity.z) < 1e-9);
      assert.equal(s.a.grabbedFighter, null);
      assert.equal(s.b.heldBy, null);
      assert.ok(s.b.grabImmunityLeft > 0);

      s.advance(COMBAT.grab.throwRecoverySeconds + DT);
      assert.equal(s.b.health.current, health - COMBAT.grab.damage * 1.5 / 2);
    }
  }
});

test('throw direction follows the captured yaw, including depth-axis throws', () => {
  const s = scene();
  s.a.position.set(0, ARENA.floorY, -0.5);
  s.b.position.set(0, ARENA.floorY, 0.5);
  s.a.rotationY = 0;
  s.connect();
  s.ca.dir = { x: 0, y: -1 };
  s.ca.press('heavy');
  s.a.update(DT, s.world);

  assert.equal(s.b.state, State.KNOCKDOWN);
  assert.equal(s.b.velocity.x, 0);
  assert.equal(s.b.velocity.z, -COMBAT.grab.knockback);
});

test('a thrown victim cannot be regrabbed during or immediately after recovery', () => {
  const s = scene();
  s.connect();
  s.ca.dir = { x: 1, y: 0 };
  s.ca.press('light');
  s.step();
  s.ca.clear();

  const immunity = s.b.grabImmunityLeft;
  assert.equal(s.b.state, State.KNOCKDOWN);
  for (let i = 0; i < 1000 && s.b.state !== State.IDLE; i++) s.step();
  assert.equal(s.b.state, State.IDLE);
  assert.equal(s.b.grabImmunityLeft, immunity, 'immunity survives knockdown/getup');

  placeInRange(s);
  s.ca.press('grab');
  s.step();
  s.advance(s.a.grabStartup + DT);
  assert.equal(s.a.state, State.GRAB_RECOVERY);
  assert.equal(s.b.state, State.IDLE);
  assert.equal(s.b.heldBy, null);

  s.advance(COMBAT.grab.immunitySeconds + COMBAT.grab.recoverySeconds);
  placeInRange(s);
  s.connect();
});

test('damage or death interrupts either end of a hold without leaving stale links', () => {
  for (const target of ['a', 'b']) {
    for (const lethal of [false, true]) {
      const s = scene();
      s.connect();
      const fighter = s[target];
      fighter.takeHit(
        lethal ? fighter.health.current : 1,
        new THREE.Vector3(-2, ARENA.floorY, 0),
      );

      assert.equal(fighter.state, lethal ? State.KO : State.HIT);
      assert.equal(s.a.grabbedFighter, null);
      assert.equal(s.b.heldBy, null);
      assert.notEqual(s.a.state, State.GRABBING);
      assert.notEqual(s.b.state, State.HELD);
    }
  }
});

test('lethal throw preserves KO and round combat reset clears grab tracking', () => {
  const s = scene();
  s.connect();
  s.b.health.current = 1;
  s.ca.dir = { x: -1, y: 0 };
  s.ca.press('light');
  s.step();
  assert.equal(s.b.state, State.KO);
  assert.equal(s.b.health.current, 0);

  const held = scene();
  held.connect();
  const states = [held.a.state, held.b.state];
  held.a.resetCombatTracking();
  held.b.resetCombatTracking();
  assert.deepEqual([held.a.state, held.b.state], states, 'reset has no state/animation side effects');
  for (const fighter of [held.a, held.b]) {
    assert.equal(fighter.grabbedFighter, null);
    assert.equal(fighter.heldBy, null);
    assert.equal(fighter.grabImmunityLeft, 0);
    assert.deepEqual(fighter.mashTimes, []);
    assert.equal(fighter.bufferedAttack, null);
  }
});
