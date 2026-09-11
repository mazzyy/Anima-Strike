import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Fighter, State } from '../renderer/src/fighter.js';
import { AUDIO, ARENA, COMBAT, INPUT_MAPS } from '../renderer/src/config.js';
import { play } from '../renderer/src/audio.js';

function makeFighter(x = -0.6) {
  const sounds = [];
  const pressed = new Set();
  const held = new Set();
  const direction = { x: 0, y: 0 };
  const fighter = new Fighter({
    model: new THREE.Object3D(),
    animator: {
      has: () => false,
      length: () => { throw new Error('Missing clip must not be measured'); },
      play: () => false,
      update() {},
    },
    controller: {
      move: () => direction,
      pressed: (action) => pressed.delete(action),
      held: (action) => held.has(action),
    },
    spawn: { x, y: ARENA.floorY, z: 0 },
    onSound: (name) => sounds.push(name),
  });
  fighter.onFloor = true;
  return { fighter, sounds, pressed, held, direction };
}

test('M is exclusively master mute; Player 2 kick moves to V', () => {
  assert.equal(AUDIO.muteKey, 'KeyM');
  assert.equal(INPUT_MAPS.p2.kick, 'KeyV');
  for (const map of Object.values(INPUT_MAPS)) {
    assert.ok(!Object.values(map).includes(AUDIO.muteKey));
  }
});

test('audio import and play are safe without browser audio', () => {
  for (const name of ['hit', 'block', 'whiff', 'land', 'unknown']) {
    assert.equal(play(name), false);
  }
});

test('accepted hits and blocks sound once, with no following whiff', () => {
  for (const blocked of [false, true]) {
    const a = makeFighter();
    const b = makeFighter(0.6);
    const world = { fighters: [a.fighter, b.fighter] };
    if (blocked) b.fighter.state = State.BLOCK;

    a.pressed.add('light');
    a.fighter.update(0.01, world);
    const length = a.fighter.swingLength;
    a.fighter.update(length * 0.5, world);
    a.fighter.update(length * 0.05, world);
    a.fighter.update(length, world);

    assert.deepEqual(b.sounds, [blocked ? 'block' : 'hit']);
    assert.deepEqual(a.sounds, []);
    const damage = blocked
      ? Math.round(COMBAT.lightAttack.damage * COMBAT.blockDamageMult)
      : COMBAT.lightAttack.damage;
    assert.equal(b.fighter.health.current, b.fighter.health.max - damage);
  }
});

test('blocks with zero chip and lethal chip still sound; rear hits are hits', () => {
  const zero = makeFighter(0.6);
  zero.fighter.state = State.BLOCK;
  const front = new THREE.Vector3(-0.6, ARENA.floorY, 0);
  assert.equal(zero.fighter.takeHit(1, front), 'block');
  assert.equal(zero.fighter.health.current, zero.fighter.health.max);
  assert.deepEqual(zero.sounds, ['block']);

  const lethal = makeFighter(0.6);
  lethal.fighter.state = State.BLOCK;
  lethal.fighter.health.current = 1;
  assert.equal(lethal.fighter.takeHit(10, front), 'block');
  assert.equal(lethal.fighter.state, State.KO);
  assert.deepEqual(lethal.sounds, ['block']);

  const rear = makeFighter(0.6);
  rear.fighter.state = State.BLOCK;
  assert.equal(
    rear.fighter.takeHit(10, new THREE.Vector3(1.6, ARENA.floorY, 0)),
    'hit',
  );
  assert.deepEqual(rear.sounds, ['hit']);
});

test('missed swings sound once per swing, including missing clips and dropkicks', () => {
  for (const action of ['attack', 'light', 'heavy', 'kick', 'dropkick']) {
    const a = makeFighter();
    const world = { fighters: [a.fighter] };
    if (action === 'dropkick') {
      a.held.add('run');
      a.direction.x = 1;
    }

    for (let swing = 0; swing < 2; swing++) {
      a.pressed.add(action === 'dropkick' ? 'kick' : action);
      a.fighter.update(0.01, world);
      assert.equal(a.sounds.length, swing);
      a.fighter.update(a.fighter.swingLength + 0.01, world);
      a.fighter.update(0.01, world);
      assert.equal(a.sounds.length, swing + 1);
    }
    assert.deepEqual(a.sounds, ['whiff', 'whiff']);
  }
});

test('invulnerable overlaps are silent contacts and count as whiffs', () => {
  for (const state of [State.KO, State.KNOCKDOWN, State.GETUP]) {
    const a = makeFighter();
    const b = makeFighter(0.6);
    b.fighter.state = state;
    const world = { fighters: [a.fighter, b.fighter] };
    a.pressed.add('light');
    a.fighter.update(0.01, world);
    a.fighter.update(a.fighter.swingLength * 0.5, world);
    a.fighter.update(a.fighter.swingLength, world);
    assert.deepEqual(b.sounds, []);
    assert.deepEqual(a.sounds, ['whiff']);
    assert.equal(b.fighter.health.current, b.fighter.health.max);
  }
});

test('interrupted startup does not emit a delayed whiff', () => {
  const a = makeFighter();
  const world = { fighters: [a.fighter] };
  a.pressed.add('heavy');
  a.fighter.update(0.01, world);
  a.fighter.takeHit(5, new THREE.Vector3(0.6, ARENA.floorY, 0));
  a.fighter.update(1, world);
  assert.deepEqual(a.sounds, ['hit']);
});

test('jump landing emits one thud, with no grounded spawn/frame spam', () => {
  const a = makeFighter();
  const world = { fighters: [a.fighter] };
  a.fighter.onFloor = false;
  a.fighter.update(0.01, world);
  assert.deepEqual(a.sounds, []);

  a.pressed.add('jump');
  a.fighter.update(0.01, world);
  assert.ok(a.fighter.position.y > ARENA.floorY);
  assert.deepEqual(a.sounds, []);

  for (let i = 0; i < 150; i++) a.fighter.update(0.01, world);
  assert.equal(a.fighter.onFloor, true);
  assert.deepEqual(a.sounds, ['land']);
});

test('Web Audio unlock, mute, polyphony, and cleanup', async () => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const oldAudioContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  const listeners = new Map();
  const contexts = [];

  class Param {
    constructor() { this.value = 0; }
    setValueAtTime(value) { this.value = value; }
    linearRampToValueAtTime(value) { this.value = value; }
    exponentialRampToValueAtTime(value) { this.value = value; }
    cancelScheduledValues() {}
  }

  class Node {
    constructor() {
      this.gain = new Param();
      this.frequency = new Param();
      this.Q = new Param();
      this.disconnected = false;
    }
    connect() {}
    disconnect() { this.disconnected = true; }
    start() { this.started = true; }
    stop() {}
  }

  class FakeAudioContext {
    constructor() {
      this.state = 'suspended';
      this.currentTime = 0;
      this.sampleRate = 48000;
      this.destination = {};
      this.nodes = [];
      this.sources = [];
      this.gains = [];
      contexts.push(this);
    }
    node() {
      const node = new Node();
      this.nodes.push(node);
      return node;
    }
    createGain() {
      const node = this.node();
      this.gains.push(node);
      return node;
    }
    createBiquadFilter() { return this.node(); }
    createBufferSource() {
      const node = this.node();
      this.sources.push(node);
      return node;
    }
    createOscillator() { return this.createBufferSource(); }
    createBuffer(channels, length) {
      const data = new Float32Array(length);
      return { getChannelData: () => data };
    }
    resume() {
      this.state = 'running';
      return Promise.resolve();
    }
    close() {
      this.state = 'closed';
      return Promise.resolve();
    }
  }

  function restore(name, descriptor) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }

  try {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        addEventListener: (name, callback) => listeners.set(name, callback),
      },
    });
    Object.defineProperty(globalThis, 'AudioContext', {
      configurable: true,
      value: FakeAudioContext,
    });

    const audio = await import('../renderer/src/audio.js?audio-regression');
    assert.equal(audio.play('hit'), false);
    assert.equal(contexts.length, 0);

    listeners.get('pointerdown')({});
    await Promise.resolve();
    assert.equal(contexts.length, 1);
    const context = contexts[0];
    const master = context.gains[0];

    assert.equal(audio.play('unknown'), false);
    assert.equal(audio.play('hit'), true);
    assert.equal(context.sources.length, 2);
    assert.ok(context.sources.every((source) => source.started));

    const key = (repeat = false) => listeners.get('keydown')({
      code: 'KeyM', repeat, preventDefault() {},
    });

    key();
    assert.equal(master.gain.value, 0);
    assert.equal(audio.play('land'), false);
    key(true);
    assert.equal(audio.play('block'), false);

    // Muting affects the existing shared master as well as future sounds.
    key();
    assert.equal(master.gain.value, AUDIO.masterVolume);
    assert.equal(audio.play('block'), true);
    assert.equal(audio.play('whiff'), true);
    assert.equal(audio.play('land'), true);

    // Finish every scheduled source and verify per-voice nodes disconnect.
    for (const source of [...context.sources]) source.onended?.();
    assert.ok(context.nodes.slice(1).every((node) => node.disconnected));
    assert.equal(master.disconnected, false);

    for (let i = 0; i < AUDIO.maxVoices; i++) {
      assert.equal(audio.play('whiff'), true);
    }
    assert.equal(audio.play('whiff'), false);
    for (const source of [...context.sources]) source.onended?.();
    assert.equal(audio.play('whiff'), true);

    context.state = 'suspended';
    assert.equal(audio.play('hit'), false);
    listeners.get('pointerdown')({});
    await Promise.resolve();
    assert.equal(context.state, 'running');
    assert.equal(contexts.length, 1);
  } finally {
    restore('window', oldWindow);
    restore('AudioContext', oldAudioContext);
  }
});
