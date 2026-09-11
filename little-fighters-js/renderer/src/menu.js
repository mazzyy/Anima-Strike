import { DIFFICULTIES } from './config.js';
import { createMatchSelection } from './match-selection.js';

/**
 * DOM menus and the outer simulation gate.
 *
 * onStart({ mode, difficulty, ai, p1Character, p2Character, map }) starts a
 * fresh match. Characters and map are IDs. It may return a promise;
 * simulation stays stopped until it completes.
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

  const selection = createMatchSelection();
  let state = 'menu';
  let busy = false;
  let destroyed = false;
  let skipFrame = true;
  let renderedStep = null;

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

    .lf-menu-card.lf-menu-selecting {
      width: min(100%, 800px);
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

    .lf-menu-actions > button:first-child {
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

    .lf-menu-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }

    .lf-menu-grid .lf-menu-choice {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
      text-align: left;
      border: 2px solid #59618e;
    }

    .lf-menu-grid .lf-menu-choice[aria-pressed="true"] {
      border-color: #e2d6ff;
      background: #454c91;
      box-shadow: inset 0 0 0 1px #e2d6ff;
    }

    .lf-menu-swatch {
      display: block;
      width: 100%;
      height: 20px;
      border: 1px solid #ffffff70;
      border-radius: 4px;
    }

    .lf-menu-tagline {
      font-size: .85rem;
      font-weight: 400;
      color: #d7daf1;
    }

    .lf-menu-selected {
      margin-top: auto;
      font-size: .8rem;
      visibility: hidden;
    }

    .lf-menu-choice[aria-pressed="true"] .lf-menu-selected {
      visibility: visible;
    }

    .lf-menu-card [data-back] {
      margin-top: 20px;
    }

    @media (max-width: 640px) {
      .lf-menu-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .lf-menu-card {
        padding: 20px;
      }
    }

    @media (max-width: 380px) {
      .lf-menu-grid {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  `;

  const root = document.createElement('div');
  root.className = 'lf-menu-root';
  root.innerHTML = `
    <section class="lf-menu-card" role="dialog" aria-modal="true"
      aria-labelledby="lf-menu-heading" aria-describedby="lf-menu-description"
      tabindex="-1">
      <h1 id="lf-menu-heading">Little Fighters</h1>
      <p id="lf-menu-description" data-description>Step into the arena.</p>

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

      <div data-selection hidden>
        <div class="lf-menu-grid" role="group"
          aria-labelledby="lf-menu-heading"
          aria-describedby="lf-menu-selection-hint"></div>
        <p id="lf-menu-selection-hint" class="lf-menu-hint">
          Arrow keys highlight a card. Enter or click confirms it.
          Tab reaches Back. Escape goes back.
        </p>
        <button type="button" data-back>Back</button>
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
  const selectionPanel = root.querySelector('[data-selection]');
  const grid = root.querySelector('.lf-menu-grid');
  const pausePanel = root.querySelector('[data-pause]');
  const cpuButton = root.querySelector('[data-cpu]');
  const twoButton = root.querySelector('[data-two]');
  const backButton = root.querySelector('[data-back]');
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
  difficultySelect.value = selection.difficulty;

  function clearError() {
    error.hidden = true;
    error.textContent = '';
  }

  function showError(message) {
    error.textContent = message;
    error.hidden = false;
  }

  function refreshHighlight() {
    for (const button of grid.querySelectorAll('[data-choice]')) {
      const selected = button.dataset.choice === selection.selectedId;
      button.setAttribute('aria-pressed', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
  }

  function renderChoices() {
    // Keep the focused DOM node alive when only highlight/busy state changes.
    if (renderedStep !== selection.step) {
      renderedStep = selection.step;
      grid.replaceChildren();

      for (const entry of selection.entries) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'lf-menu-choice';
        button.dataset.choice = entry.id;

        if (entry.tint !== undefined) {
          const swatch = document.createElement('span');
          swatch.className = 'lf-menu-swatch';
          swatch.setAttribute('aria-hidden', 'true');
          swatch.style.backgroundColor = typeof entry.tint === 'number'
            ? `#${entry.tint.toString(16).padStart(6, '0')}`
            : entry.tint;
          button.append(swatch);
        }

        const name = document.createElement('strong');
        name.textContent = entry.name;
        button.append(name);

        if (entry.tagline) {
          const tagline = document.createElement('span');
          tagline.className = 'lf-menu-tagline';
          tagline.textContent = entry.tagline;
          button.append(tagline);
        }

        const marker = document.createElement('span');
        marker.className = 'lf-menu-selected';
        marker.textContent = '✓ Selected';
        marker.setAttribute('aria-hidden', 'true');
        button.append(marker);

        button.addEventListener('focus', () => {
          if (destroyed || busy || state !== 'menu') return;
          selection.highlight(entry.id);
          refreshHighlight();
        });
        button.addEventListener('click', () => {
          if (destroyed || busy || state !== 'menu') return;
          if (!selection.highlight(entry.id)) return;
          confirmSelection();
        });
        grid.append(button);
      }
    }

    refreshHighlight();
  }

  function refresh() {
    const selecting = state === 'menu' && selection.step !== 'mode';
    root.hidden = state === 'playing';
    titlePanel.hidden = state !== 'menu' || selecting;
    selectionPanel.hidden = !selecting;
    pausePanel.hidden = state !== 'paused';
    card.classList.toggle('lf-menu-selecting', selecting);

    if (state === 'paused') {
      heading.textContent = 'Paused';
      description.textContent = 'The fight will wait.';
    } else if (selecting) {
      const opponent = selection.mode === 'cpu' ? 'CPU' : 'Player 2';
      heading.textContent = {
        p1: 'Player 1 — choose a fighter',
        p2: `${opponent} — choose a fighter`,
        map: 'Choose an arena',
      }[selection.step];
      description.textContent = selection.step === 'map'
        ? 'Step 3 of 3 — confirm an arena to start the match.'
        : `Step ${selection.step === 'p1' ? '1' : '2'} of 3 — choose your character.`;
      renderChoices();
    } else {
      heading.textContent = 'Little Fighters';
      description.textContent = 'Step into the arena.';
    }

    card.setAttribute('aria-busy', String(busy));
    for (const control of root.querySelectorAll('button, select')) {
      control.disabled = busy;
    }
  }

  function focusMenu() {
    if (destroyed || state === 'playing') return;
    if (busy) card.focus();
    else if (state === 'paused') resumeButton.focus();
    else if (selection.step !== 'mode') {
      grid.querySelector('[aria-pressed="true"]')?.focus();
    } else {
      (selection.mode === 'two-player' ? twoButton : cpuButton).focus();
    }
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

  function refreshSelectionScreen() {
    clearInput();
    skipFrame = true;
    clearError();
    refresh();
    focusMenu();
  }

  function chooseMode(mode) {
    if (destroyed || busy || state !== 'menu') return;
    if (selection.chooseMode(mode)) refreshSelectionScreen();
  }

  function back() {
    if (destroyed || busy || state !== 'menu') return;
    if (selection.back()) refreshSelectionScreen();
  }

  function confirmSelection() {
    const options = selection.confirm();
    if (options) void start(options);
    else refreshSelectionScreen();
  }

  async function start(options) {
    if (destroyed || busy || state !== 'menu' || selection.step !== 'map') return;

    busy = true;
    clearInput();
    clearError();
    refresh();
    focusMenu();

    try {
      await onStart(options);
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
      selection.reset();
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

  function visibleControls() {
    return [...root.querySelectorAll('button, select')]
      .filter((element) => !element.disabled
        && element.tabIndex >= 0
        && !element.closest('[hidden]'));
  }

  function trapTab(event) {
    const controls = visibleControls();

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

  function navigateArrow(event) {
    // Preserve native difficulty-select navigation.
    if (document.activeElement === difficultySelect) return;
    event.preventDefault();
    if (busy) return;

    if (state === 'menu' && selection.step !== 'mode') {
      const buttons = [...grid.querySelectorAll('[data-choice]')];
      const index = buttons.findIndex(
        (button) => button.dataset.choice === selection.selectedId,
      );
      if (index < 0) return;

      // Use the rendered layout, so vertical movement follows responsive rows.
      const firstTop = buttons[0].offsetTop;
      const columns = buttons.filter((button) => button.offsetTop === firstTop).length;
      const delta = {
        ArrowLeft: -1,
        ArrowRight: 1,
        ArrowUp: -columns,
        ArrowDown: columns,
      }[event.code];
      const next = Math.max(0, Math.min(buttons.length - 1, index + delta));
      buttons[next].focus();
      return;
    }

    const controls = visibleControls();
    if (!controls.length) return;
    const index = controls.indexOf(document.activeElement);
    const delta = event.code === 'ArrowLeft' || event.code === 'ArrowUp' ? -1 : 1;
    const next = index < 0 ? 0 : (index + delta + controls.length) % controls.length;
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
        else back();
      }
      return;
    }

    if (state !== 'playing') {
      // Block gameplay keydown listeners, but keep native button activation
      // and native difficulty-select handling. Keyup is allowed through.
      event.stopImmediatePropagation();
      if (event.code === 'Tab') {
        trapTab(event);
      } else if (event.code.startsWith('Arrow')) {
        navigateArrow(event);
      } else if (busy || (event.repeat
        && ['Enter', 'NumpadEnter', 'Space'].includes(event.code))) {
        // A held confirmation key must not confirm subsequent screens.
        event.preventDefault();
      }
    }
  }

  function onVisibilityChange() {
    if (document.hidden) pause();
  }

  function onFocusIn(event) {
    if (state !== 'playing' && !root.contains(event.target)) focusMenu();
  }

  cpuButton.addEventListener('click', () => chooseMode('cpu'));
  twoButton.addEventListener('click', () => chooseMode('two-player'));
  difficultySelect.addEventListener('change', () => {
    selection.setDifficulty(difficultySelect.value);
    difficultySelect.value = selection.difficulty;
    clearInput();
  });
  backButton.addEventListener('click', back);
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
