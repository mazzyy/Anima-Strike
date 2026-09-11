/**
 * Procedural renderer audio. The only public entry point is play(name):
 * 'hit', 'block', 'whiff', or 'land'.
 *
 * Audio is unlocked by a pointer/key gesture, never by a simulation event.
 * Unsupported audio, suspended contexts, and unknown names are silent no-ops.
 */

import { AUDIO } from './config.js';

let context = null;
let master = null;
let noiseBuffer = null;
let muted = false;
const voices = new Set();

function unlock() {
  try {
    if (!context) {
      const AudioContext = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!AudioContext) return;

      const nextContext = new AudioContext();
      try {
        const nextMaster = nextContext.createGain();
        nextMaster.gain.value = muted ? 0 : AUDIO.masterVolume;
        nextMaster.connect(nextContext.destination);

        const buffer = nextContext.createBuffer(
          1,
          Math.ceil(nextContext.sampleRate * AUDIO.noiseBufferSeconds),
          nextContext.sampleRate,
        );
        const samples = buffer.getChannelData(0);
        for (let i = 0; i < samples.length; i++) {
          samples[i] = Math.random() * 2 - 1;
        }

        context = nextContext;
        master = nextMaster;
        noiseBuffer = buffer;
      } catch {
        Promise.resolve(nextContext.close()).catch(() => {});
        return;
      }
    }

    if (context.state !== 'running' && context.state !== 'closed') {
      // Retry directly on each gesture. An earlier resume promise (or its
      // delayed handlers) must not prevent unlocking a suspended context.
      Promise.resolve(context.resume()).catch(() => {});
    }
  } catch {
    // Audio failure must never stop input or the game loop.
  }
}

function toggleMute() {
  muted = !muted;
  if (!context || !master) return;

  try {
    const now = context.currentTime;
    const gain = master.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(
      muted ? 0 : AUDIO.masterVolume,
      now + AUDIO.fadeSeconds,
    );
  } catch {
    // The context may have been closed by the platform.
  }
}

function editableTarget(target) {
  return target?.isContentEditable
    || Boolean(target?.closest?.('input, textarea, select'));
}

// Guard browser globals so importing this module in headless tests is safe.
if (typeof globalThis.window?.addEventListener === 'function') {
  globalThis.window.addEventListener('pointerdown', unlock, { passive: true });
  globalThis.window.addEventListener('keydown', (event) => {
    if (event.repeat) return;

    if (
      event.code === AUDIO.muteKey
      && !event.ctrlKey && !event.metaKey && !event.altKey
      && !editableTarget(event.target)
    ) {
      event.preventDefault();
      toggleMute();
    }

    unlock();
  });
}

/**
 * Schedule an immediate sound on the audio clock, independently of hit-stop.
 * Returns true if scheduled. Muted/locked sounds are dropped, never queued.
 */
export function play(name) {
  if (!Object.hasOwn(AUDIO.sounds, name)) return false;
  if (
    muted || !context || context.state !== 'running'
    || voices.size >= AUDIO.maxVoices
  ) {
    return false;
  }

  const sound = AUDIO.sounds[name];
  const sources = [];
  const nodes = [];
  let pending = 0;
  let disposed = false;

  const voice = {
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const source of sources) {
        source.onended = null;
        try { source.stop(); } catch {}
      }
      for (const node of nodes) {
        try { node.disconnect(); } catch {}
      }
      voices.delete(voice);
    },
  };

  voices.add(voice);

  try {
    const now = context.currentTime;

    function envelope(layer) {
      const gain = context.createGain();
      nodes.push(gain);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(layer.volume, now + layer.attack);
      gain.gain.exponentialRampToValueAtTime(
        AUDIO.envelopeFloor,
        now + layer.duration,
      );
      gain.gain.linearRampToValueAtTime(
        0,
        now + layer.duration + AUDIO.fadeSeconds,
      );
      gain.connect(master);
      return gain;
    }

    function schedule(source, duration) {
      pending++;
      source.onended = () => {
        pending--;
        if (pending === 0) voice.dispose();
      };
      source.start(now);
      source.stop(now + duration + AUDIO.fadeSeconds);
    }

    if (sound.noise) {
      const layer = sound.noise;
      const source = context.createBufferSource();
      sources.push(source);
      nodes.push(source);
      source.buffer = noiseBuffer;
      source.loop = true;

      const filter = context.createBiquadFilter();
      nodes.push(filter);
      filter.type = layer.filter;
      filter.Q.value = layer.q;
      filter.frequency.setValueAtTime(layer.fromHz, now);
      filter.frequency.exponentialRampToValueAtTime(
        layer.toHz,
        now + layer.duration,
      );

      source.connect(filter);
      filter.connect(envelope(layer));
      schedule(source, layer.duration);
    }

    if (sound.tone) {
      const layer = sound.tone;
      const source = context.createOscillator();
      sources.push(source);
      nodes.push(source);
      source.type = 'sine';
      source.frequency.setValueAtTime(layer.fromHz, now);
      source.frequency.exponentialRampToValueAtTime(
        layer.toHz,
        now + layer.duration,
      );
      source.connect(envelope(layer));
      schedule(source, layer.duration);
    }

    if (pending === 0) {
      voice.dispose();
      return false;
    }
    return true;
  } catch {
    voice.dispose();
    return false;
  }
}
