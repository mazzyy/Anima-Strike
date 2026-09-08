/**
 * Boot the game: choose a mode, load assets, spawn two fighters, run the loop.
 *
 * Player 1 uses WASD + JKL. Player 2 uses either the CPU controller or the
 * existing second-player keyboard bindings, selected before the match.
 */

import { loadGameAssets, createAnimator } from './assets.js';
import { createArena } from './arena.js';
import { createHUD } from './hud.js';
import { initInput, endInputFrame, keyboardController } from './input.js';
import { Fighter, State } from './fighter.js';
import { AIController } from './ai.js';
import { ARENA } from './config.js';

const canvas = document.getElementById('game');
const loading = document.getElementById('loading');
const loadingLabel = document.getElementById('loading-label');

function chooseMode() {
  loadingLabel.textContent = 'Little Fighters — Choose a game mode';

  const menu = document.createElement('div');
  menu.setAttribute('role', 'group');
  menu.setAttribute('aria-label', 'Game mode');

  const cpuButton = document.createElement('button');
  cpuButton.type = 'button';
  cpuButton.textContent = '1 Player vs CPU';

  const localButton = document.createElement('button');
  localButton.type = 'button';
  localButton.textContent = '2 Players (local)';

  const p1Help = document.createElement('p');
  p1Help.textContent =
    'P1: WASD move · Space jump · Left Shift run · J punch · K kick · L block · U dash';

  const p2Help = document.createElement('p');
  p2Help.textContent =
    'P2: Arrows move · / jump · , run · . punch · M kick · N block · B dash';

  menu.append(cpuButton, localButton, p1Help, p2Help);
  loadingLabel.append(menu);

  return new Promise((resolve) => {
    let selected = false;

    const select = (mode) => {
      if (selected) return;
      selected = true;
      cpuButton.disabled = true;
      localButton.disabled = true;
      loadingLabel.textContent = 'Loading…';
      resolve(mode);
    };

    cpuButton.addEventListener('click', () => select('cpu'), { once: true });
    localButton.addEventListener('click', () => select('local'), { once: true });
    cpuButton.focus();
  });
}

async function boot() {
  // Choose before creating any controller or registering gameplay input.
  const mode = await chooseMode();
  const twoPlayer = mode === 'local';

  const arena = createArena(canvas);
  const hud = createHUD(document.body);

  let assets;
  try {
    assets = await loadGameAssets((what) => {
      loadingLabel.textContent = `loading ${what}…`;
    });
  } catch (err) {
    loadingLabel.textContent =
      'Could not load the character. Run `npm run assets` and restart.';
    console.error(err);
    return;
  }

  initInput(window);

  // -- fighters ------------------------------------------------------------
  const makeFighter = (name, spawn, controller) => {
    const model = assets.createCharacter();
    arena.scene.add(model);
    return new Fighter({
      model,
      animator: createAnimator(model, assets.clips),
      controller,
      spawn,
      name,
      onHitEffect: (pos, color) => arena.spawnHitEffect(pos, color),
    });
  };

  // Do not construct an AI at all in local two-player mode.
  const ai = twoPlayer
    ? null
    : new AIController({ name: 'CPU', useLLM: true, debug: true });

  const p1 = makeFighter(
    twoPlayer ? 'Player 1' : 'Player',
    ARENA.spawnP1,
    keyboardController('p1'),
  );
  const p2 = makeFighter(
    twoPlayer ? 'Player 2' : 'CPU',
    ARENA.spawnP2,
    twoPlayer ? keyboardController('p2') : ai,
  );

  if (ai) {
    ai.attach(p2, p1);
    ai.onPlan = () => hud.setPlan(ai);
  }

  const world = { fighters: [p1, p2] };

  // -- HUD wiring ----------------------------------------------------------
  hud.setHealth('p1', 1);
  hud.setHealth('p2', 1);
  p1.health.onChanged = (cur, max) => hud.setHealth('p1', cur / max);
  p2.health.onChanged = (cur, max) => hud.setHealth('p2', cur / max);

  if (ai) {
    // A blocked hit feeds the AI's mixup logic, same as note_blocked() did.
    const p1Block = p1.takeHit.bind(p1);
    p1.takeHit = (...args) => {
      const wasBlocking = p1.state === State.BLOCK;
      p1Block(...args);
      if (wasBlocking && p1.state === State.BLOCK) ai.noteBlocked();
    };
  }

  let over = false;
  const checkOver = () => {
    if (over) return;
    if (p1.state === State.KO) {
      over = true;
      hud.showBanner(twoPlayer ? 'K.O.  —  PLAYER 2 WINS' : 'K.O.  —  CPU WINS');
    } else if (p2.state === State.KO) {
      over = true;
      hud.showBanner(twoPlayer ? 'K.O.  —  PLAYER 1 WINS' : 'K.O.  —  YOU WIN');
    }
  };

  // -- brain status + spend readout ---------------------------------------
  // Local play never touches the model bridge, including status and usage.
  if (ai) {
    const status = await globalThis.lf?.status?.().catch(() => null);
    if (!status?.configured) {
      hud.setBrainStatus(status?.reason ?? 'local tactics only');
    }
    setInterval(async () => {
      const totals = await globalThis.lf?.usage?.().catch(() => null);
      hud.setUsage(totals);
    }, 2000);
  } else {
    hud.setBrainStatus('local two-player — AI disabled');
  }

  // -- loop ----------------------------------------------------------------
  loading.classList.add('done');

  let last = performance.now();
  function frame(now) {
    // Clamped so a paused window doesn't teleport everyone on resume.
    const dt = Math.min((now - last) / 1000, 1 / 20);
    last = now;

    ai?.update(dt);
    p1.update(dt, world);
    p2.update(dt, world);
    ai?.endFrame();
    endInputFrame();

    arena.updateSparks(dt);
    arena.render();
    checkOver();

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

boot().catch((err) => {
  console.error(err);
  loadingLabel.textContent = `Failed to start: ${err.message}`;
});
