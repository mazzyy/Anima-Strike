/**
 * Procedural renderer audio; no assets or simulation-clock scheduling.
 * play(name, { phase, speed }) accepts any AUDIO.sounds ID.
 * Unsupported audio, suspended contexts, and unknown IDs are silent no-ops.
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
      // Retry on every gesture, even while an earlier resume is pending.
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
    // The platform may have closed the context.
  }
}

function editableTarget(target) {
  return target?.isContentEditable
    || Boolean(target?.closest?.('input, textarea, select'));
}

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
 * One voice is one trigger, including all its layers.
 * All sources start immediately on the audio clock. Nothing is queued.
 * Jitter is shared by both layers: ±AUDIO.pitchVariationCents.
 * Only speed-sensitive voices receive the separate, bounded speed multiplier.
 */
export function play(name, { phase = 'impact', speed = 1 } = {}) {
  if (!Object.hasOwn(AUDIO.sounds, name)) return false;
  if (
    muted || !context || context.state !== 'running'
    || voices.size >= AUDIO.maxVoices
  ) return false;

  const definition = AUDIO.sounds[name];
  const sound = phase === 'swing' && definition.swing
    ? definition.swing : definition;
  const sources = [];
  const nodes = [];
  const scheduled = [];
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
    const cents = (Math.random() * 2 - 1) * AUDIO.pitchVariationCents;
    const jitter = 2 ** (cents / 1200);
    const swingSpeed = Number.isFinite(speed)
      ? Math.max(AUDIO.swingSpeed.min, Math.min(AUDIO.swingSpeed.max, speed))
      : 1;
    const rate = sound.speedSensitive ? swingSpeed : 1;
    const pitch = jitter * rate;

    function envelope(layer) {
      const gain = context.createGain();
      nodes.push(gain);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(layer.volume, now + layer.attack / rate);
      // Irregular, authored amplitude gates give electricity an actual crackle.
      for (const pulse of layer.pulses ?? []) {
        gain.gain.setValueAtTime(
          layer.volume * pulse.level,
          now + pulse.at / rate,
        );
      }
      gain.gain.exponentialRampToValueAtTime(
        AUDIO.envelopeFloor,
        now + layer.duration / rate,
      );
      gain.gain.linearRampToValueAtTime(
        0,
        now + layer.duration / rate + AUDIO.fadeSeconds,
      );
      gain.connect(master);
      return gain;
    }

    function frequency(parameter, layer) {
      parameter.setValueAtTime(layer.fromHz * pitch, now);
      for (const note of layer.notes ?? []) {
        parameter.setValueAtTime(note.hz * pitch, now + note.at / rate);
      }
      parameter.exponentialRampToValueAtTime(
        layer.toHz * pitch,
        now + layer.duration / rate,
      );
    }

    function register(source, duration) {
      sources.push(source);
      nodes.push(source);
      scheduled.push({ source, duration: duration / rate });
    }

    if (sound.noise) {
      const layer = sound.noise;
      const source = context.createBufferSource();
      register(source, layer.duration);
      source.buffer = noiseBuffer;
      source.loop = true;

      const filter = context.createBiquadFilter();
      nodes.push(filter);
      filter.type = layer.filter;
      filter.Q.value = layer.q;
      frequency(filter.frequency, layer);
      source.connect(filter);
      filter.connect(envelope(layer));
    }

    if (sound.tone) {
      const layer = sound.tone;
      const source = context.createOscillator();
      register(source, layer.duration);
      source.type = layer.type ?? 'sine';
      frequency(source.frequency, layer);
      source.connect(envelope(layer));
    }

    if (!scheduled.length) {
      voice.dispose();
      return false;
    }

    // Count every layer before starting any of them. The voice remains reserved
    // until the longest layer ends, not just until the noise burst ends.
    pending = scheduled.length;
    for (const { source, duration } of scheduled) {
      source.onended = () => {
        pending--;
        if (pending === 0) voice.dispose();
      };
      source.start(now);
      source.stop(now + duration + AUDIO.fadeSeconds);
    }
    return true;
  } catch {
    voice.dispose();
    return false;
  }
}
