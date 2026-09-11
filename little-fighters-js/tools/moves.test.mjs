import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MOVES, MOVE_TABLES, canCancel, resolveMove, directionToken, appendInput,
} from '../renderer/src/moves.js';
import {
  CHARACTER_ROSTER, MOVE_RULES, CLIPS, AUDIO,
} from '../renderer/src/config.js';

function history(command, step = .08) {
  return command.split(',').map((input, index) => ({ input, time: index * step }));
}

function contextFor(move, table) {
  if (move.followupOnly) {
    const from = table.find((entry) => entry.cancelInto.includes(move.id));
    if (!from) return null; // Automatic parry punish, not a manual command.
    return { state: 'ATTACK', currentMove: from, phase: 'recovery', airborne: move.airborne };
  }
  return {
    state: move.effects.fromBlock ? 'BLOCK' : move.airborne ? 'JUMP' : 'IDLE',
    airborne: move.airborne,
  };
}

test('all six move tables are immutable, complete, valid and acyclic', () => {
  assert.equal(MOVES, MOVE_TABLES);
  assert.deepEqual(Object.keys(MOVES), CHARACTER_ROSTER.map((entry) => entry.id));
  for (const [character, table] of Object.entries(MOVES)) {
    assert.ok(table.length >= 8 && table.length <= 12, character);
    assert.equal(new Set(table.map((move) => move.id)).size, table.length);
    for (const move of table) {
      for (const key of [
        'id', 'name', 'input', 'startup', 'active', 'recovery', 'damage',
        'knockback', 'knocksDown', 'reach', 'hitHeight', 'cancelInto',
        'meterGain', 'vfx', 'sound', 'clip', 'clipSpeed',
      ]) assert.ok(Object.hasOwn(move, key), `${character}/${move.id}/${key}`);
      assert.ok(Object.isFrozen(move));
      assert.ok(Object.isFrozen(move.cancelInto));
      for (const key of ['startup', 'active', 'recovery', 'clipSpeed']) {
        assert.ok(Number.isFinite(move[key]) && move[key] > 0);
      }
      assert.ok(move.startup + move.active + move.recovery <= MOVE_RULES.maxDuration);
      assert.ok(move.damage >= 0 && move.reach >= 0 && move.meterGain >= 0);
      assert.ok(['low', 'mid', 'high', 'air'].includes(move.hitHeight));
      assert.ok(CLIPS.includes(move.clip));
      assert.ok(AUDIO.sounds[move.sound]);
      assert.ok(Object.hasOwn(MOVE_RULES.colors, move.vfx));
      assert.ok(!move.knocksDown || move.cancelInto.length === 0);
      for (const id of move.cancelInto) {
        const target = table.find((entry) => entry.id === id);
        assert.ok(target, `${character}/${move.id} -> ${id}`);
        assert.ok(canCancel(move, target));
      }
      if (move.effects.parry) {
        assert.ok(table.some((entry) => entry.id === move.effects.parry));
      }
    }
    function visit(move, ancestors = new Set()) {
      assert.ok(!ancestors.has(move.id), `cancel cycle: ${character}/${move.id}`);
      const next = new Set([...ancestors, move.id]);
      for (const id of move.cancelInto) visit(table.find((entry) => entry.id === id), next);
    }
    table.forEach((move) => visit(move));
  }
});

test('every manually available move resolves; wrong buttons/directions do not select it', () => {
  for (const [character, table] of Object.entries(MOVES)) {
    for (const move of table) {
      const context = contextFor(move, table);
      if (!context) continue;
      const correct = history(move.input);
      assert.equal(resolveMove(correct, character, context)?.id, move.id, `${character}/${move.id}`);
      assert.equal(resolveMove(correct, { id: character }, context)?.id, move.id);
      const wrongButton = correct.map((entry) => ({ ...entry }));
      wrongButton.at(-1).input = 'not-a-button';
      assert.equal(resolveMove(wrongButton, character, context), null);
      const directionIndex = correct.findIndex((entry) =>
        ['forward', 'back', 'up', 'down'].includes(entry.input));
      if (directionIndex >= 0) {
        const wrong = correct.map((entry) => ({ ...entry }));
        wrong[directionIndex].input = wrong[directionIndex].input === 'up' ? 'down' : 'up';
        assert.notEqual(resolveMove(wrong, character, context)?.id, move.id);
        assert.notEqual(resolveMove(history(move.input, .3), character, context)?.id, move.id);
      }
      assert.equal(resolveMove(correct, character, {
        ...context,
        now: correct.at(-1).time + MOVE_RULES.buttonBufferSeconds + .001,
      }), null);
    }
  }
});

test('long complete commands beat shorter suffixes; incomplete prefixes do not execute', () => {
  assert.equal(resolveMove(history('forward,down,light'), 'axel')?.id, 'elbow');
  assert.equal(resolveMove(history('down,light'), 'axel')?.id, 'jab');
  assert.equal(resolveMove(history('forward,down'), 'axel'), null);
  assert.equal(resolveMove(history('forward,down,heavy'), 'axel')?.id, 'uppercut');
  assert.equal(resolveMove(history('down,heavy'), 'axel')?.id, 'launcher');
  assert.equal(resolveMove(history('down,up,heavy'), 'bastion', 'BLOCK')?.id, 'reversal');
  assert.equal(resolveMove(history('heavy'), 'bastion', 'BLOCK')?.id, 'push');
});

test('neutral permits double taps; wrong intervening directions cannot be skipped', () => {
  assert.equal(resolveMove(history('back,neutral,back,heavy'), 'rook')?.id, 'lariat');
  assert.notEqual(resolveMove(history('back,up,back,heavy'), 'rook')?.id, 'lariat');
  assert.notEqual(resolveMove(history('back,heavy'), 'rook')?.id, 'lariat');
});

test('phase/state restrictions and knockdowns prevent illegal cancels', () => {
  const [jab, cross] = MOVES.axel;
  for (const phase of ['startup', 'active']) {
    assert.equal(resolveMove(history('light'), 'axel', {
      state: 'ATTACK', currentMove: jab, phase,
    }), null);
  }
  assert.equal(resolveMove(history('light'), 'axel', {
    state: 'ATTACK', currentMove: jab, phase: 'recovery',
  }), cross);
  assert.equal(canCancel(jab, 'cross'), true);
  assert.equal(canCancel(jab, MOVES.zip[1]), false);
  assert.equal(canCancel({ ...jab, knocksDown: true }, cross), false);
  for (const state of ['HIT', 'JUGGLE', 'HELD', 'KO', 'GETUP', 'KNOCKDOWN']) {
    assert.equal(resolveMove(history('light'), 'axel', state), null);
  }
  assert.notEqual(resolveMove(history('down,up,heavy'), 'bastion')?.id, 'reversal');
  assert.equal(resolveMove(history('kick'), 'ember', 'JUMP')?.id, 'dive');
  assert.equal(resolveMove(history('kick'), 'ember')?.id, 'sweep');
});

test('pure helpers preserve input, mirror facing, and bound history', () => {
  assert.equal(directionToken({ x: 1, y: 0 }, 1), 'forward');
  assert.equal(directionToken({ x: 1, y: 0 }, -1), 'back');
  assert.equal(directionToken({ x: 1, y: 1 }, 1), 'down');
  assert.equal(directionToken({ x: 0, y: 0 }, 1), 'neutral');
  const original = Object.freeze([Object.freeze({ input: 'back', time: 0 })]);
  const next = appendInput(original, 'heavy', 1);
  assert.deepEqual(next, [{ input: 'heavy', time: 1 }]);
  assert.equal(original.length, 1);
  assert.equal(resolveMove(original, 'unknown'), null);
  assert.equal(resolveMove([{ input: 'light', time: NaN }], 'axel'), null);
  assert.equal(resolveMove([
    { input: 'down', time: 1 }, { input: 'heavy', time: 0 },
  ], 'axel'), null);
  assert.doesNotThrow(() => resolveMove(original, 'rook'));
});

test('best finite string damage differs meaningfully for every roster member', () => {
  const totals = CHARACTER_ROSTER.map((character) => {
    const table = MOVES[character.id];
    function damage(move) {
      const followups = move.cancelInto.map((id) => damage(table.find((entry) => entry.id === id)));
      // Parry conversion is a real route, but not a manually cancellable edge.
      if (move.effects.parry) followups.push(damage(table.find((entry) => entry.id === move.effects.parry)));
      return move.damage + Math.max(0, ...followups);
    }
    return Math.max(...table.filter((move) => !move.followupOnly).map(damage))
      * character.stats.damageScale;
  });
  for (let i = 0; i < totals.length; i += 1) {
    for (let j = i + 1; j < totals.length; j += 1) {
      assert.ok(Math.abs(totals[i] - totals[j]) >= 4, `${totals[i]} versus ${totals[j]}`);
    }
  }
  assert.ok(totals[5] > totals[1] && totals[1] > totals[2]);
});
