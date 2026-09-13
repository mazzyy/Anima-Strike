import test from 'node:test';
import assert from 'node:assert/strict';
import { Group } from 'three';
import { AIController } from '../renderer/src/ai.js';
import { Fighter, State } from '../renderer/src/fighter.js';
import { ARENA, DIFFICULTIES, METER, MOVE_RULES } from '../renderer/src/config.js';
import { MOVE_DATA } from '../renderer/src/game-data.js';
import { appendInput, directionToken, resolveMove } from '../renderer/src/moves.js';

const DT = 1 / 60;
const BUTTONS = ['light', 'heavy', 'kick', 'grab', 'dash'];
const idle = {
  move: () => ({ x: 0, y: 0 }),
  pressed: () => false,
  held: () => false,
};

function seeded(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

function fighter(character, controller, x) {
  const result = new Fighter({
    character,
    controller,
    model: new Group(),
    // No clips: authored gameplay must not depend on animation availability.
    animator: {
      play: () => false,
      update: () => {},
      duration: () => 0.45,
      getDuration: () => 0.45,
      isFinished: () => false,
    },
    spawn: { x, y: ARENA.floorY, z: 0 },
    stats: { maxHealth: 100000 },
  });
  result.onFloor = true;
  return result;
}

function setup(character, difficulty = 'hard', seed = 1, sign = 1, distance = 1.1) {
  const ai = new AIController({
    useLLM: false,
    ...DIFFICULTIES[difficulty],
    random: seeded(seed),
  });
  const me = fighter(character, ai, -sign * distance / 2);
  const foe = fighter('rook', idle, sign * distance / 2);
  ai.attach(me, foe);
  return { ai, me, foe, world: { fighters: [me, foe] }, sign, distance };
}

/**
 * Independently feed the controller sample through the player's command path.
 * The real Fighter update below must then activate that same resolved row.
 */
function expectedMove(me, ai, dt) {
  const buttons = BUTTONS.filter((button) => ai.pressed(button));
  if (!buttons.length) return null;
  assert.equal(buttons.length, 1);

  const now = me.inputClock + dt;
  let history = me.inputHistory.filter(
    (entry) => now - entry.time <= MOVE_RULES.commandSeconds,
  );
  const facing = history.length ? me.commandFacing : me.facingSign;
  const direction = directionToken(ai.move(), facing);
  if (direction !== me.lastDirection) history = appendInput(history, direction, now);
  history = appendInput(history, buttons[0], now);

  const move = me.currentMove;
  const time = me.stateTime + dt;
  const phase = !move ? null : time < move.startup ? 'startup'
    : time < move.startup + move.active ? 'active' : 'recovery';
  const state = !move && ai.held('block')
    && [State.IDLE, State.WALK, State.RUN].includes(me.state)
    ? State.BLOCK : me.state;
  const resolved = resolveMove(history, me.character, {
    now, state, phase, currentMove: move,
    airborne: !me.onFloor && me.position.y > ARENA.floorY,
  });
  assert.ok(resolved, `${me.character}: emitted ${buttons[0]} must resolve`);
  assert.equal(resolved.id, ai.lastSelection.move.id);
  assert.ok(MOVE_DATA[me.character].some((row) => row[0] === resolved.id));
  return resolved;
}

function step(match, dt = DT) {
  const { ai, me, foe, world } = match;
  ai.update(dt);
  const expected = expectedMove(me, ai, dt);
  me.update(dt, world);
  if (expected) assert.equal(me.currentMove?.id, expected.id);
  foe.update(dt, world);
  ai.endFrame();
  return expected;
}

function pin(match) {
  const { me, foe, sign, distance } = match;
  me.position.x = -sign * distance / 2;
  me.position.z = 0;
  foe.position.x = sign * distance / 2;
  foe.position.z = 0;
  me.velocity.x = me.velocity.z = 0;
  foe.velocity.x = foe.velocity.z = 0;
  me.meter = 0;
  foe.meter = 0;
}

function firstMove(character, distance, seed = 2, sign = 1) {
  const match = setup(character, 'hard', seed, sign, distance);
  for (let frame = 0; frame < 600; frame += 1) {
    pin(match);
    const move = step(match);
    if (move) return { move, match };
  }
  assert.fail(`${character} never selected a move at distance ${distance}`);
}

test('all six CPUs emit only owned moves, accepted by player resolution and Fighter', () => {
  let emitted = 0;
  for (const character of Object.keys(MOVE_DATA)) {
    for (const sign of [-1, 1]) {
      const match = setup(character, 'hard', 47, sign);
      let count = 0;
      for (let frame = 0; frame < 900; frame += 1) {
        pin(match);
        if (step(match)) count += 1;
      }
      assert.ok(count > 3, `${character}, facing ${sign}: no local offense`);
      emitted += count;
    }
  }
  assert.ok(emitted > 50);
});

test('longer range favors longer reach rather than short jabs', () => {
  let closeReach = 0;
  let farReach = 0;
  for (let seed = 1; seed <= 12; seed += 1) {
    closeReach += firstMove('pike', 1.1, seed).move.reach;
    farReach += firstMove('pike', 3.8, seed).move.reach;
  }
  assert.ok(farReach / 12 > closeReach / 12 + 0.4);
});

test('projectile commands execute on both sides, not as fallback light attacks', () => {
  for (const sign of [-1, 1]) {
    const { move, match } = firstMove('ember', 7, 8, sign);
    assert.equal(move.id, 'projectile');
    assert.deepEqual(match.ai.lastSelection.command, ['down', 'forward', 'light']);
    assert.equal(match.me.currentMove.id, 'projectile');
  }
});

test('an airborne target causes a high/air move rather than a low sweep', () => {
  const match = setup('axel', 'hard', 4);
  let selected = null;
  for (let frame = 0; frame < 300 && !selected; frame += 1) {
    pin(match);
    match.foe.position.y = 1.5;
    match.foe.onFloor = false;
    match.foe.state = State.JUMP;
    match.foe.velocity.y = 0;
    selected = step(match);
  }
  assert.ok(selected);
  assert.ok(['high', 'air'].includes(selected.hitHeight));
});

test('knockdown, getup and KO cancel pending input before the button edge', () => {
  for (const state of [State.KNOCKDOWN, State.GETUP, State.KO]) {
    const match = setup('ember', 'hard', 8, 1, 7);
    for (let frame = 0; frame < 300 && !match.ai.sequence; frame += 1) {
      pin(match);
      step(match);
    }
    assert.ok(match.ai.sequence, 'test must interrupt an in-progress command');
    const previous = match.ai.lastSelection;
    match.foe.state = state;
    for (let frame = 0; frame < 120; frame += 1) {
      match.ai.update(DT);
      assert.equal(match.ai.sequence, null);
      assert.equal(match.ai.presses.size, 0);
      assert.equal(match.ai.lastSelection, previous);
      assert.deepEqual(match.ai.move(), { x: 0, y: 0 });
      match.ai.endFrame();
    }
  }
});

function exchange(difficulty, seed) {
  const match = setup('zip', difficulty, seed);
  const strings = [];
  let length = 0;
  for (let frame = 0; frame < 2400; frame += 1) {
    pin(match);
    const before = match.me.currentMove;
    const selected = step(match);
    if (selected) {
      if (!before && length) {
        strings.push(length);
        length = 0;
      }
      length += 1;
    }
    if (!match.me.currentMove && length) {
      strings.push(length);
      length = 0;
    }
  }
  if (length) strings.push(length);
  return strings;
}

test('Easy produces measurably shorter confirmed strings than Hard', () => {
  const easy = [];
  const hard = [];
  for (let seed = 1; seed <= 5; seed += 1) {
    easy.push(...exchange('easy', seed));
    hard.push(...exchange('hard', seed));
  }
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  assert.ok(easy.length > 20 && hard.length > 20);
  assert.ok(Math.max(...easy) <= DIFFICULTIES.easy.maxString);
  assert.ok(mean(hard) > mean(easy) + 1, `${mean(easy)} Easy vs ${mean(hard)} Hard`);
  assert.ok(hard.some((length) => length >= 4));
});

test('difficulty inference preserves existing preset-only match construction', () => {
  for (const preset of Object.values(DIFFICULTIES)) {
    const ai = new AIController({
      useLLM: false,
      baseAggression: preset.baseAggression,
      thinkInterval: preset.thinkInterval,
    });
    assert.equal(ai.skill, preset);
    ai.pendingPlan = { aggression: 1 };
    const me = fighter('axel', ai, -1);
    const foe = fighter('rook', idle, 1);
    ai.attach(me, foe);
    ai.update(DT);
    assert.equal(ai.skill, preset, 'a model plan cannot upgrade execution difficulty');
  }
});

test('a stocked CPU saves its super for recovery, then uses the normal super edge', () => {
  const match = setup('axel', 'hard', 1, 1, 2.5);
  const { ai, me, foe, world } = match;
  // Fixed RNG: recognize the punish, but do not attack randomly in neutral.
  ai.random = () => 0.9;
  me.meter = METER.stockSize;
  ai.stance = 'defensive';

  for (let frame = 0; frame < 30; frame += 1) {
    ai.update(DT);
    assert.equal(ai.pressed('super'), false);
    ai.endFrame();
  }
  assert.equal(me.meter, METER.stockSize);

  foe.state = State.GRAB_RECOVERY;
  // A super recovery is long enough to punish after Hard's reaction delay.
  foe.state = State.SUPER;
  foe.currentSuper = {
    hits: [{ frame: 10 }],
    durationFrames: 100,
  };
  foe.stateTime = 0.5;
  let emitted = false;
  for (let frame = 0; frame < 30; frame += 1) {
    ai.update(DT);
    if (ai.pressed('super')) {
      emitted = true;
      me.update(DT, world);
      break;
    }
    foe.stateTime += DT;
    ai.endFrame();
  }
  assert.ok(emitted);
  assert.equal(me.state, State.SUPER);
  assert.equal(me.meter, 0);
});

test('a missing or rejected bridge leaves local play available', async () => {
  const previous = globalThis.lf;
  try {
    globalThis.lf = { requestTactic: () => Promise.reject(new Error('offline')) };
    const match = setup('axel');
    match.ai.useLLM = true;
    match.ai.thinkTimer = 0;
    step(match);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(match.ai.pendingPlan, null);
    let emitted = 0;
    for (let frame = 0; frame < 300; frame += 1) {
      pin(match);
      if (step(match)) emitted += 1;
    }
    assert.ok(emitted > 0);
    match.ai.dispose();
  } finally {
    if (previous === undefined) delete globalThis.lf;
    else globalThis.lf = previous;
  }
});
