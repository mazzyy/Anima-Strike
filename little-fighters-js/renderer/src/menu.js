import { DIFFICULTIES, MENU } from './config.js';

/**
 * DOM menus and the outer simulation gate.
 *
 * onStart({ mode, difficulty, ai }) must start a fresh match. It may return a
 * promise; simulation stays stopped until it completes.
 *
 * onQuit() releases the old match's AI/resources. It may also return a promise.
 *
 * clearInput() clears keyboard held/pressed state at menu boundaries.
 * Do not clear Fighter combat buffers here: pausing must preserve simulation.
 *
 * Call advance(dt, simulate) once per RAF. Keep reading the frame clock and
 * rendering outside advance(), including while menus are open.
 */
export function createMenus({
  onStart,
  onQuit,
  clearInput,
  focusGame = () => document.querySelector('canvas')?.focus(),
}) {
  if (typeof onStart !== 'function'
    || typeof onQuit !== 'function'
    || typeof clearInput !== 'function') {
    throw new TypeError('createMenus requires onStart, onQuit and clearInput.');
  }

  let state = 'menu';
  let busy = false;
  let destroyed = false;
  let skipFrame = true;

  const style = document.createElement('style');
  style.textContent = `
    .lf-menu-root {
      position: fixed;
      inset: 0;
      z-index: 10000;
      display: grid;
      place-items: center;
      overflow: auto;
      padding: 24px;
      box-sizing: border-box;
      background: rgba(5, 6, 15, .88);
      color: #f4f3ff;
      font: 16px/1.5 system-ui, sans-serif;
      pointer-events: auto;
    }

    .lf-menu-root[hidden],
    .lf-menu-root [hidden] {
      display: none !important;
    }

    .lf-menu-card {
      box-sizing: border-box;
      width: min(100%, 400px);
      padding: 32px;
      border: 1px solid #555b91;
      border-radius: 16px;
      background: #111426;
      box-shadow: 0 20px 80px #0009;
    }

    .lf-menu-card h1 {
      margin: 0 0 8px;
      color: #fff;
      font-size: 2rem;
      line-height: 1.15;
    }

    .lf-menu-card p {
      margin: 0 0 24px;
      color: #b9bedc;
    }

    .lf-menu-actions {
      display: grid;
      gap: 12px;
    }

    .lf-menu-card label {
      display: block;
      margin: 24px 0 8px;
      color: #d7daf1;
    }

    .lf-menu-card button,
    .lf-menu-card select {
      box-sizing: border-box;
      width: 100%;
      min-height: 46px;
      padding: 10px 14px;
      border: 1px solid #59618e;
      border-radius: 8px;
      color: #f4f3ff;
      background: #252b48;
      font: inherit;
    }

    .lf-menu-card button {
      cursor: pointer;
      font-weight: 650;
    }

    .lf-menu-card button:first-child {
      background: #515cbd;
      border-color: #818ce9;
    }

    .lf-menu-card button:hover:not(:disabled) {
      filter: brightness(1.18);
    }

    .lf-menu-card :focus-visible {
      outline: 3px solid #d8ceff;
      outline-offset: 3px;
    }

    .lf-menu-card :disabled {
      cursor: wait;
      opacity: .55;
    }

    .lf-menu-card .lf-menu-hint {
      margin: 12px 0 0;
      font-size: .85rem;
    }

    .lf-menu-card .lf-menu-error {
      margin: 16px 0 0;
      color: #ffb8bd;
    }
  `;

  const root = document.createElement('div');
  root.className = 'lf-menu-root';
  root.innerHTML = `
    <section class="lf-menu-card" role="dialog" aria-modal="true"
      aria-labelledby="lf-menu-heading" tabindex="-1">
      <h1 id="lf-menu-heading">Little Fighters</h1>
      <p data-description>Step into the arena.</p>

      <div data-title>
        <div class="lf-menu-actions">
          <button type="button" data-cpu>Fight the CPU</button>
          <button type="button" data-two>Two players</button>
        </div>
        <label for="lf-menu-difficulty">CPU difficulty</label>
        <select id="lf-menu-difficulty"></select>
        <p class="lf-menu-hint">
          Difficulty only affects the CPU. Escape pauses during a match.
        </p>
      </div>

      <div data-pause hidden>
        <div class="lf-menu-actions">
          <button type="button" data-resume>Resume</button>
          <button type="button" data-quit>Quit to menu</button>
        </div>
        <p class="lf-menu-hint">Press Escape to resume.</p>
      </div>

      <p class="lf-menu-error" role="alert" hidden></p>
    </section>
  `;

  const card = root.querySelector('.lf-menu-card');
  const heading = root.querySelector('h1');
  const description = root.querySelector('[data-description]');
  const titlePanel = root.querySelector('[data-title]');
  const pausePanel = root.querySelector('[data-pause]');
  const cpuButton = root.querySelector('[data-cpu]');
  const twoButton = root.querySelector('[data-two]');
  const resumeButton = root.querySelector('[data-resume]');
  const quitButton = root.querySelector('[data-quit]');
  const difficultySelect = root.querySelector('select');
  const error = root.querySelector('[role="alert"]');

  for (const [key, preset] of Object.entries(DIFFICULTIES)) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = preset.label;
    difficultySelect.append(option);
  }
  difficultySelect.value = MENU.defaultDifficulty;

  function clearError() {
    error.hidden = true;
    error.textContent = '';
  }

  function showError(message) {
    error.textContent = message;
    error.hidden = false;
  }

  function refresh() {
    root.hidden = state === 'playing';
    titlePanel.hidden = state !== 'menu';
    pausePanel.hidden = state !== 'paused';
    heading.textContent = state === 'paused' ? 'Paused' : 'Little Fighters';
    description.textContent = state === 'paused'
      ? 'The fight will wait.'
      : 'Step into the arena.';

    card.setAttribute('aria-busy', String(busy));
    for (const control of root.querySelectorAll('button, select')) {
      control.disabled = busy;
    }
  }

  function focusMenu() {
    if (destroyed || state === 'playing') return;
    if (busy) card.focus();
    else if (state === 'paused') resumeButton.focus();
    else cpuButton.focus();
  }

  function setState(next) {
    clearInput();
    state = next;
    skipFrame = true;
    clearError();
    refresh();

    if (next === 'playing') {
      // A hidden Resume button must not retain keyboard activation focus.
      if (root.contains(document.activeElement)) {
        document.activeElement.blur();
      }
      focusGame();
    } else {
      focusMenu();
    }
  }

  async function start(mode) {
    if (destroyed || busy || state !== 'menu') return;

    const difficulty = difficultySelect.value;
    const preset = DIFFICULTIES[difficulty];
    if (!preset) return;

    busy = true;
    clearInput();
    clearError();
    refresh();
    focusMenu();

    try {
      await onStart({
        mode,
        difficulty,
        ai: {
          baseAggression: preset.baseAggression,
          thinkInterval: preset.thinkInterval,
        },
      });
      if (destroyed) return;

      busy = false;
      setState(document.hidden ? 'paused' : 'playing');
    } catch (cause) {
      if (destroyed) return;
      busy = false;
      refresh();
      showError('Could not start the match. Please try again.');
      focusMenu();
      console.error('Could not start match:', cause);
    }
  }

  function pause() {
    if (destroyed || busy || state !== 'playing') return;
    setState('paused');
  }

  function resume() {
    if (destroyed || busy || state !== 'paused') return;
    setState('playing');
  }

  async function quit() {
    if (destroyed || busy || state !== 'paused') return;

    busy = true;
    clearInput();
    clearError();
    refresh();
    focusMenu();

    try {
      await onQuit();
      if (destroyed) return;

      busy = false;
      setState('menu');
    } catch (cause) {
      if (destroyed) return;
      busy = false;
      refresh();
      showError('Could not leave the match. Please try again.');
      focusMenu();
      console.error('Could not quit match:', cause);
    }
  }

  function trapTab(event) {
    const controls = [...root.querySelectorAll('button, select')]
      .filter((element) => !element.disabled && !element.closest('[hidden]'));

    event.preventDefault();
    if (controls.length === 0) {
      card.focus();
      return;
    }

    const index = controls.indexOf(document.activeElement);
    const next = index < 0
      ? (event.shiftKey ? controls.length - 1 : 0)
      : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;

    controls[next].focus();
  }

  function onKeyDown(event) {
    if (destroyed) return;

    if (event.code === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();

      if (!event.repeat && !busy) {
        if (state === 'playing') pause();
        else if (state === 'paused') resume();
      }
      return;
    }

    if (state !== 'playing') {
      // Block gameplay keydown listeners, but keep the browser's native
      // button/select activation. Keyup is deliberately allowed through.
      event.stopImmediatePropagation();
      if (event.code === 'Tab') trapTab(event);
    }
  }

  function onVisibilityChange() {
    if (document.hidden) pause();
  }

  function onFocusIn(event) {
    if (state !== 'playing' && !root.contains(event.target)) focusMenu();
  }

  cpuButton.addEventListener('click', () => start('cpu'));
  twoButton.addEventListener('click', () => start('two-player'));
  resumeButton.addEventListener('click', resume);
  quitButton.addEventListener('click', quit);

  document.head.append(style);
  document.body.append(root);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('blur', pause);
  document.addEventListener('visibilitychange', onVisibilityChange);
  document.addEventListener('focusin', onFocusIn);

  clearInput();
  refresh();
  focusMenu();

  return {
    get state() { return state; },
    get playing() { return !destroyed && !busy && state === 'playing'; },

    pause,
    resume,

    /**
     * Wrap ALL simulation work, not just Fighter.update().
     *
     * RAF and clock sampling continue while paused. Skipping the first frame
     * after a transition also prevents pre-resume elapsed time leaking into
     * simulation.
     */
    advance(dt, simulate) {
      if (destroyed || busy || state !== 'playing') return false;

      if (skipFrame) {
        skipFrame = false;
        return false;
      }

      if (!Number.isFinite(dt) || dt <= 0) return false;
      simulate(dt);
      return true;
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearInput();

      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('blur', pause);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      document.removeEventListener('focusin', onFocusIn);
      root.remove();
      style.remove();
    },
  };
}
