import {
  CHARACTER_ROSTER,
  CHARACTER_DEFAULTS,
  MAP_THEMES,
  DIFFICULTIES,
  MENU,
} from './config.js';

/**
 * Headless match-setup state machine. Character and map payloads are IDs.
 * No DOM, fighters, controllers or match resources belong here.
 *
 * Confirming a character advances to the next screen. Confirming a map
 * returns a fresh start payload without advancing, allowing a failed start
 * to be retried with the same choices.
 */
export function createMatchSelection() {
  let step = 'mode';
  let mode = 'cpu';
  let difficulty = MENU.defaultDifficulty;
  const choices = {
    p1Character: CHARACTER_DEFAULTS.p1,
    p2Character: CHARACTER_DEFAULTS.p2,
    map: MAP_THEMES[0].id,
  };

  function entries() {
    if (step === 'map') return MAP_THEMES;
    if (step === 'p1' || step === 'p2') return CHARACTER_ROSTER;
    return [];
  }

  function choiceKey() {
    if (step === 'p1') return 'p1Character';
    if (step === 'p2') return 'p2Character';
    if (step === 'map') return 'map';
    return null;
  }

  return {
    get step() { return step; },
    get mode() { return mode; },
    get difficulty() { return difficulty; },
    get entries() { return entries(); },
    get selectedId() { return choices[choiceKey()] ?? null; },

    setDifficulty(next) {
      if (step !== 'mode' || !Object.hasOwn(DIFFICULTIES, next)) return false;
      difficulty = next;
      return true;
    },

    chooseMode(next) {
      if (step !== 'mode' || !['cpu', 'two-player'].includes(next)) return false;
      mode = next;
      step = 'p1';
      return true;
    },

    highlight(id) {
      const key = choiceKey();
      if (!key || !entries().some((entry) => entry.id === id)) return false;
      choices[key] = id;
      return true;
    },

    confirm() {
      if (step === 'p1') {
        step = 'p2';
      } else if (step === 'p2') {
        step = 'map';
      } else if (step === 'map') {
        const preset = DIFFICULTIES[difficulty];
        return {
          mode,
          difficulty,
          ai: {
            baseAggression: preset.baseAggression,
            thinkInterval: preset.thinkInterval,
          },
          ...choices,
        };
      }
      return null;
    },

    back() {
      const previous = { p1: 'mode', p2: 'p1', map: 'p2' }[step];
      if (!previous) return false;
      step = previous;
      return true;
    },

    // Preserve choices when returning from a match, but show the mode screen.
    reset() {
      step = 'mode';
    },
  };
}
