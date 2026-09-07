/**
 * Boot the game: load assets, build the arena, spawn two fighters, run the loop.
 *
 * Player 1 is you (WASD + JKL). Player 2 is the CPU, driven by the local
 * tactics layer and re-planned by the Azure model when it is configured.
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

async function boot() {
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

  const ai = new AIController({ name: 'CPU', useLLM: true, debug: true });

  const p1 = makeFighter('Player', ARENA.spawnP1, keyboardController('p1'));
  const p2 = makeFighter('CPU', ARENA.spawnP2, ai);
  ai.attach(p2, p1);
  ai.onPlan = () => hud.setPlan(ai);

  const world = { fighters: [p1, p2] };

  // -- HUD wiring ----------------------------------------------------------
  hud.setHealth('p1', 1);
  hud.setHealth('p2', 1);
  p1.health.onChanged = (cur, max) => hud.setHealth('p1', cur / max);
  p2.health.onChanged = (cur, max) => hud.setHealth('p2', cur / max);

  // A blocked hit feeds the AI's mixup logic, same as note_blocked() did.
  const p1Block = p1.takeHit.bind(p1);
  p1.takeHit = (...args) => {
    const wasBlocking = p1.state === State.BLOCK;
    p1Block(...args);
    if (wasBlocking && p1.state === State.BLOCK) ai.noteBlocked();
  };

  let over = false;
  const checkOver = () => {
    if (over) return;
    if (p1.state === State.KO) { over = true; hud.showBanner('K.O.  —  CPU WINS'); }
    else if (p2.state === State.KO) { over = true; hud.showBanner('K.O.  —  YOU WIN'); }
  };

  // -- brain status + spend readout ---------------------------------------
  const status = await globalThis.lf?.status?.().catch(() => null);
  if (!status?.configured) {
    hud.setBrainStatus(status?.reason ?? 'local tactics only');
  }
  setInterval(async () => {
    const totals = await globalThis.lf?.usage?.().catch(() => null);
    hud.setUsage(totals);
  }, 2000);

  // -- loop ----------------------------------------------------------------
  loading.classList.add('done');

  let last = performance.now();
  function frame(now) {
    // Clamped so a paused window doesn't teleport everyone on resume.
    const dt = Math.min((now - last) / 1000, 1 / 20);
    last = now;

    ai.update(dt);
    p1.update(dt, world);
    p2.update(dt, world);
    ai.endFrame();
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
