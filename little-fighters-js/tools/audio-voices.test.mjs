import test from 'node:test';
import assert from 'node:assert/strict';
import { AUDIO, MOVE_DATA } from '../renderer/src/game-data.js';
import { MOVES } from '../renderer/src/moves.js';

test('every authored move has its own existing, distinct voice', () => {
  const ids = [];
  const signatures = [];
  for (const [character, rows] of Object.entries(MOVE_DATA)) {
    for (const row of rows) {
      const move = MOVES[character].find((entry) => entry.id === row[0]);
      assert.ok(move);
      assert.equal(move.sound, row[9].sound);
      assert.ok(Object.hasOwn(AUDIO.sounds, move.sound), move.sound);
      const voice = AUDIO.sounds[move.sound];
      assert.ok(voice.swing, `${move.sound}: swing phase`);
      ids.push(move.sound);
      signatures.push(JSON.stringify(voice));
    }
  }
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(signatures).size, signatures.length);
  for (const id of [
    'hit', 'block', 'whiff', 'land', 'jab', 'heavy', 'clash', 'parry',
    'grab', 'throw', 'lightning', 'projectileLaunch', 'projectileImpact',
    'pound', 'super', 'ko',
  ]) assert.ok(AUDIO.sounds[id], id);
});

test('every envelope and pitch contour is finite, positive, and ordered', () => {
  function check(sound, id) {
    for (const key of ['noise', 'tone']) {
      const layer = sound[key];
      assert.ok(layer, `${id}.${key}`);
      for (const field of ['volume', 'attack', 'duration', 'fromHz', 'toHz']) {
        assert.ok(Number.isFinite(layer[field]) && layer[field] > 0, `${id}.${key}.${field}`);
      }
      assert.ok(layer.attack < layer.duration);
      assert.ok(layer.volume > AUDIO.envelopeFloor);
      let last = layer.attack;
      for (const pulse of layer.pulses ?? []) {
        assert.ok(pulse.at > last && pulse.at < layer.duration);
        assert.ok(pulse.level > 0 && pulse.level <= 1);
        last = pulse.at;
      }
      last = 0;
      for (const note of layer.notes ?? []) {
        assert.ok(note.at > last && note.at < layer.duration);
        assert.ok(Number.isFinite(note.hz) && note.hz > 0);
        last = note.at;
      }
    }
    if (sound.swing) check(sound.swing, `${id}.swing`);
  }
  for (const [id, sound] of Object.entries(AUDIO.sounds)) check(sound, id);
});

class Parameter {
  value = 1;
  events = [];
  record(type, value, time) {
    assert.ok(Number.isFinite(value));
    assert.ok(Number.isFinite(time));
    this.events.push({ type, value, time });
    this.value = value;
  }
  setValueAtTime(value, time) { this.record('set', value, time); }
  linearRampToValueAtTime(value, time) { this.record('linear', value, time); }
  exponentialRampToValueAtTime(value, time) {
    assert.ok(value > 0);
    this.record('exponential', value, time);
  }
  cancelScheduledValues(time) { this.events.push({ type: 'cancel', time }); }
}

class Node {
  connections = [];
  disconnected = false;
  connect(node) { this.connections.push(node); }
  disconnect() { this.disconnected = true; }
}

class Source extends Node {
  frequency = new Parameter();
  started = false;
  ended = false;
  start(time) { this.started = true; this.startTime = time; }
  stop(time) {
    if (time !== undefined) this.stopTime = time;
    else this.ended = true;
  }
  finish() {
    if (this.ended) return;
    this.ended = true;
    this.onended?.();
  }
}

class FakeContext {
  static instances = [];
  state = 'running';
  currentTime = 12;
  sampleRate = 44100;
  destination = new Node();
  sources = [];
  filters = [];
  gains = [];
  failOscillator = false;
  constructor() { FakeContext.instances.push(this); }
  createGain() {
    const node = new Node();
    node.gain = new Parameter();
    this.gains.push(node);
    return node;
  }
  createBuffer(channels, size) {
    const data = new Float32Array(size);
    return { getChannelData: () => data };
  }
  createBufferSource() {
    const node = new Source();
    node.kind = 'noise';
    this.sources.push(node);
    return node;
  }
  createOscillator() {
    if (this.failOscillator) throw new Error('device allocation failed');
    const node = new Source();
    node.kind = 'tone';
    this.sources.push(node);
    return node;
  }
  createBiquadFilter() {
    const node = new Node();
    node.frequency = new Parameter();
    node.Q = new Parameter();
    this.filters.push(node);
    return node;
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
  finishAll() {
    for (const source of [...this.sources]) source.finish();
  }
}

test('procedural scheduling: caps, mute, phases, bounded jitter, and cleanup', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  const originalRandom = Math.random;
  const listeners = new Map();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { addEventListener: (name, callback) => listeners.set(name, callback) },
  });
  Object.defineProperty(globalThis, 'AudioContext', {
    configurable: true, value: FakeContext,
  });

  try {
    const { play } = await import('../renderer/src/audio.js?voice-tests');
    assert.equal(play('jab'), false, 'simulation cannot unlock audio');
    listeners.get('pointerdown')();
    const context = FakeContext.instances.at(-1);
    const master = context.gains[0];
    assert.equal(master.gain.value, AUDIO.masterVolume);
    assert.equal(play('not-a-sound'), false);

    const ids = Object.keys(AUDIO.sounds);
    let accepted = 0;
    for (let i = 0; i < 500; i++) {
      if (play(ids[i % ids.length])) accepted++;
    }
    assert.equal(accepted, AUDIO.maxVoices);
    assert.equal(context.sources.filter((source) => source.started).length, AUDIO.maxVoices * 2);

    // Ending one layer must not free a whole voice.
    context.sources[0].finish();
    assert.equal(play('jab'), false);
    context.sources[1].finish();
    assert.equal(play('jab'), true);
    assert.equal(play('jab'), false);
    context.finishAll();
    const sourceCount = context.sources.length;
    assert.equal(context.sources.length, sourceCount, 'dropped sounds never replay');
    assert.ok(context.sources.every((source) => source.disconnected));

    function key(overrides = {}) {
      listeners.get('keydown')({
        code: AUDIO.muteKey, repeat: false,
        ctrlKey: false, metaKey: false, altKey: false,
        target: null, preventDefault() {}, ...overrides,
      });
    }
    key();
    assert.equal(master.gain.events.at(-1).value, 0);
    for (const id of ids) assert.equal(play(id), false);
    assert.equal(context.sources.length, sourceCount);
    key({ repeat: true });
    assert.equal(play('jab'), false, 'key repeat does not unmute');
    key({ target: { isContentEditable: true } });
    assert.equal(play('jab'), false, 'typing does not unmute');
    key();
    assert.equal(master.gain.events.at(-1).value, AUDIO.masterVolume);

    // Exercise every ID and both phases at both jitter bounds and midpoint.
    for (const id of ids) {
      for (const phase of ['impact', 'swing']) {
        const sound = phase === 'swing' && AUDIO.sounds[id].swing
          ? AUDIO.sounds[id].swing : AUDIO.sounds[id];
        const measured = [];
        for (const random of [0, 0.5, 1 - Number.EPSILON]) {
          Math.random = () => random;
          assert.equal(play(id, { phase }), true, `${id}/${phase}`);
          const source = context.sources.at(-1);
          const filter = context.filters.at(-1);
          const ratio = source.frequency.events[0].value / sound.tone.fromHz;
          measured.push(ratio);
          const cents = 1200 * Math.log2(ratio);
          assert.ok(Math.abs(cents) <= AUDIO.pitchVariationCents + 1e-9);
          assert.ok(Math.abs(
            filter.frequency.events[0].value / sound.noise.fromHz - ratio,
          ) < 1e-12, 'both layers share one pitch variation');
          assert.equal(source.startTime, context.currentTime);
          assert.ok(source.stopTime > source.startTime);
          context.finishAll();
        }
        assert.ok(measured[0] < measured[1] && measured[1] < measured[2]);
      }
    }

    Math.random = () => 0.5;
    for (const [speed, expected] of [
      [-100, AUDIO.swingSpeed.min], [100, AUDIO.swingSpeed.max],
      [NaN, 1], [Infinity, 1],
    ]) {
      assert.equal(play('whiff', { speed }), true);
      assert.equal(
        context.sources.at(-1).frequency.events[0].value,
        AUDIO.sounds.whiff.tone.fromHz * expected,
      );
      assert.equal(
        context.sources.at(-1).stopTime,
        context.currentTime + AUDIO.sounds.whiff.tone.duration / expected + AUDIO.fadeSeconds,
      );
      context.finishAll();
    }
    assert.equal(play('heavy', { speed: 100 }), true);
    assert.equal(
      context.sources.at(-1).frequency.events[0].value,
      AUDIO.sounds.heavy.tone.fromHz,
      'speed scaling cannot detune a contact thud',
    );
    context.finishAll();

    context.state = 'suspended';
    assert.equal(play('ko'), false);
    listeners.get('pointerdown')();
    assert.equal(play('ko'), true);
    context.finishAll();

    // A partially constructed graph must release its reservation and nodes.
    context.failOscillator = true;
    for (let i = 0; i < AUDIO.maxVoices * 3; i++) assert.equal(play('heavy'), false);
    context.failOscillator = false;
    for (let i = 0; i < AUDIO.maxVoices; i++) assert.equal(play('heavy'), true);
    assert.equal(play('heavy'), false);
    context.finishAll();
  } finally {
    Math.random = originalRandom;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
    if (originalContext) Object.defineProperty(globalThis, 'AudioContext', originalContext);
    else delete globalThis.AudioContext;
  }
});
