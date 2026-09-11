import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatchSelection } from '../renderer/src/match-selection.js';
import {
  CHARACTER_ROSTER,
  CHARACTER_DEFAULTS,
  MAP_THEMES,
  DIFFICULTIES,
  MENU,
} from '../renderer/src/config.js';

test('setup requires both characters and a map before producing a start payload', () => {
  const selection = createMatchSelection();

  assert.equal(selection.step, 'mode');
  assert.equal(selection.difficulty, MENU.defaultDifficulty);
  assert.equal(selection.confirm(), null);
  assert.deepEqual(selection.entries, []);

  assert.equal(selection.chooseMode('cpu'), true);
  assert.equal(selection.step, 'p1');
  assert.equal(selection.selectedId, CHARACTER_DEFAULTS.p1);
  assert.equal(selection.entries, CHARACTER_ROSTER);
  assert.equal(selection.confirm(), null);

  assert.equal(selection.step, 'p2');
  assert.equal(selection.selectedId, CHARACTER_DEFAULTS.p2);
  assert.equal(selection.confirm(), null);

  assert.equal(selection.step, 'map');
  assert.equal(selection.entries, MAP_THEMES);
  assert.equal(selection.selectedId, MAP_THEMES[0].id);

  const preset = DIFFICULTIES[MENU.defaultDifficulty];
  assert.deepEqual(selection.confirm(), {
    mode: 'cpu',
    difficulty: MENU.defaultDifficulty,
    ai: {
      baseAggression: preset.baseAggression,
      thinkInterval: preset.thinkInterval,
    },
    p1Character: CHARACTER_DEFAULTS.p1,
    p2Character: CHARACTER_DEFAULTS.p2,
    map: MAP_THEMES[0].id,
  });
});

test('each mode delivers independent character selections and the chosen map', () => {
  for (const mode of ['cpu', 'two-player']) {
    const selection = createMatchSelection();
    assert.equal(selection.setDifficulty('hard'), true);
    selection.chooseMode(mode);

    assert.equal(selection.highlight('zip'), true);
    assert.equal(selection.selectedId, 'zip');
    selection.confirm();

    assert.equal(selection.highlight('bastion'), true);
    selection.confirm();

    assert.equal(selection.highlight('rooftop'), true);
    const options = selection.confirm();
    assert.deepEqual(options, {
      mode,
      difficulty: 'hard',
      ai: {
        baseAggression: DIFFICULTIES.hard.baseAggression,
        thinkInterval: DIFFICULTIES.hard.thinkInterval,
      },
      p1Character: 'zip',
      p2Character: 'bastion',
      map: 'rooftop',
    });

    // A failed asynchronous start can retry without losing selections.
    options.ai.baseAggression = -1;
    options.p1Character = 'axel';
    const retry = selection.confirm();
    assert.equal(selection.step, 'map');
    assert.equal(retry.p1Character, 'zip');
    assert.equal(retry.ai.baseAggression, DIFFICULTIES.hard.baseAggression);
  }
});

test('Back retraces setup screens without discarding highlighted choices', () => {
  const selection = createMatchSelection();
  assert.equal(selection.back(), false);
  selection.chooseMode('two-player');
  selection.highlight('ember');
  selection.confirm();
  selection.highlight('pike');
  selection.confirm();
  selection.highlight('neon-street');

  assert.equal(selection.back(), true);
  assert.equal(selection.step, 'p2');
  assert.equal(selection.selectedId, 'pike');
  assert.equal(selection.back(), true);
  assert.equal(selection.step, 'p1');
  assert.equal(selection.selectedId, 'ember');
  assert.equal(selection.back(), true);
  assert.equal(selection.step, 'mode');

  selection.chooseMode('cpu');
  selection.confirm();
  selection.confirm();
  assert.equal(selection.selectedId, 'neon-street');
  assert.equal(selection.confirm().mode, 'cpu');

  selection.reset();
  assert.equal(selection.step, 'mode');
  selection.chooseMode('two-player');
  assert.equal(selection.selectedId, 'ember');
});

test('invalid actions cannot skip steps or inject unknown selections', () => {
  const selection = createMatchSelection();
  assert.equal(selection.chooseMode('unknown'), false);
  assert.equal(selection.step, 'mode');
  assert.equal(selection.setDifficulty('unknown'), false);
  assert.equal(selection.setDifficulty('__proto__'), false);
  assert.equal(selection.highlight('axel'), false);

  selection.chooseMode('cpu');
  assert.equal(selection.chooseMode('two-player'), false);
  assert.equal(selection.setDifficulty('easy'), false);
  assert.equal(selection.highlight('rooftop'), false);
  assert.equal(selection.selectedId, CHARACTER_DEFAULTS.p1);

  selection.confirm();
  selection.confirm();
  assert.equal(selection.highlight('axel'), false);
  assert.equal(selection.selectedId, MAP_THEMES[0].id);
});
