/**
 * Boot once, then run matches under the menu system.
 *
 * The split matters. Boot is everything that survives a match — the renderer,
 * the HUD, the loaded character and clips, the keyboard listeners. A match is
 * everything that does not: two fighters, the round clock, the CPU brain.
 * Quitting to the menu tears down only the second kind, so starting a fight is
 * instant and nothing leaks between matches.
 *
 * P1: WASD move · Space jump · Left Shift run · J light jab · I heavy punch ·
 *     K kick · L block · U dash.  P2: arrows · / jump · , run · . light ·
 *     H heavy · V kick · N block · B dash.  M mutes.  Escape pauses.
 *
 * Matches are best of three 60-second rounds. Impact timing is applied here,
 * in the loop, rather than inside the fighters.
 */

import { loadGameAssets, createAnimator } from './assets.js';
import { createArena } from './arena.js';
import { createHUD } from './hud.js';
import { initInput, endInputFrame, clearInput, keyboardController } from './input.js';
import { Fighter, State } from './fighter.js';
import { AIController } from './ai.js';
import { RoundManager, Phase } from './rounds.js';
import { ImpactTiming } from './impact-timing.js';
import { createMenus } from './menu.js';
import { play } from './audio.js';
import { ARENA, CAMERA, ROUNDS } from './config.js';

const canvas = document.getElementById('game');
const loading = document.getElementById('loading');
const loadingLabel = document.getElementById('loading-label');

/** Set once by boot(): the renderer, HUD and character that outlive a match. */
let stage = null;

/** The match in progress, or null while the menu is up. */
let match = null;

// ---------------------------------------------------------------------------
// one match
// ---------------------------------------------------------------------------

function startMatch({ mode, ai: aiTuning }) {
  const { arena, hud, assets } = stage;
  const twoPlayer = mode === 'two-player';

  const spawn = (name, at, controller) => {
    const model = assets.createCharacter();
    arena.scene.add(model);
    return new Fighter({
      model,
      animator: createAnimator(model, assets.clips),
      controller,
      spawn: at,
      name,
      onHitEffect: (pos, color) => arena.spawnHitEffect(pos, color),
      onSound: play,
    });
  };

  // No AI object at all in two-player mode — nothing to think, nothing to bill.
  const ai = twoPlayer
    ? null
    : new AIController({ name: 'CPU', useLLM: true, debug: true, ...aiTuning });

  const names = twoPlayer ? ['PLAYER 1', 'PLAYER 2'] : ['YOU', 'CPU'];
  const p1 = spawn(names[0], ARENA.spawnP1, keyboardController('p1'));
  const p2 = spawn(names[1], ARENA.spawnP2, twoPlayer ? keyboardController('p2') : ai);

  if (ai) {
    ai.attach(p2, p1);
    ai.onPlan = () => hud.setPlan(ai);
  }

  const world = { fighters: [p1, p2] };
  const impact = new ImpactTiming();

  hud.hideBanner();
  hud.setHealth('p1', 1);
  hud.setHealth('p2', 1);
  hud.setCombo('p1', 0);
  hud.setCombo('p2', 0);
  hud.setRounds('p1', 0, ROUNDS.toWin);
  hud.setRounds('p2', 0, ROUNDS.toWin);
  hud.setClock(ROUNDS.seconds);
  hud.setBrainStatus(twoPlayer ? 'Local two-player — AI disabled' : stage.brainStatus);
  arena.resetCamera();

  // Observe resolved hits without changing Fighter's damage, invulnerability,
  // death callback, per-swing fields, or controller interface.
  for (const defender of world.fighters) {
    const takeHit = defender.takeHit.bind(defender);
    defender.takeHit = (...args) => {
      const healthBefore = defender.health.current;
      const comboBefore = defender.comboCount;
      const wasBlocking = defender.state === State.BLOCK;

      // Fighter passes its own position to takeHit. Read the swing state
      // before resolving damage, rather than guessing from damage magnitude.
      const attacker = world.fighters.find(
        (fighter) => fighter !== defender && fighter.position === args[1],
      );
      const heavy = attacker?.state === State.HEAVY_ATTACK;

      const result = takeHit(...args);

      if (ai && defender === p1 && wasBlocking && defender.state === State.BLOCK) {
        ai.noteBlocked();
      }

      if (defender.health.current < healthBefore) {
        // Fighter increments the defender's combo only on accepted, unblocked
        // damage. This also handles rear hits against a blocking fighter.
        const unblocked = defender.comboCount > comboBefore;
        const lethal = healthBefore > 0 && !defender.health.isAlive();
        impact.notifyHit({ heavy: heavy && unblocked, lethal });
        if (lethal) hud.hideBanner();
      }

      return result;
    };
  }

  const rounds = new RoundManager({
    p1, p2, names,
    onRoundEnd: (result) => {
      hud.setRounds('p1', result.wins.p1, ROUNDS.toWin);
      hud.setRounds('p2', result.wins.p2, ROUNDS.toWin);
      hud.flashBanner(rounds.describe(result), ROUNDS.intermissionSeconds * 1000);
    },
    onRoundStart: ({ round }) => {
      impact.reset();
      arena.resetCamera();
      p1.resetCombatTracking();
      p2.resetCombatTracking();
      hud.setCombo('p1', 0);
      hud.setCombo('p2', 0);
      hud.setClock(rounds.timeLeft);
      hud.flashBanner(`ROUND ${round}`, 1200);
    },
    onMatchEnd: ({ name }) => hud.showBanner(`${name} WINS THE MATCH`),
  });

  match = { p1, p2, ai, world, rounds, impact };
}

function endMatch() {
  if (!match) return;
  const { arena, hud } = stage;

  match.ai?.dispose();
  for (const fighter of match.world.fighters) arena.scene.remove(fighter.model);

  hud.hideBanner();
  hud.setPlan(null);
  match = null;
}

/**
 * One step of simulation. Called by the menu only while a match is playing, so
 * a paused game advances no clock, takes no input and resolves no damage.
 */
function simulate(realDt) {
  if (!match) return;
  const { arena, hud } = stage;
  const { p1, p2, ai, world, rounds, impact } = match;

  const { dt, finishing } = impact.advance(realDt);

  // Never call update(0): input reads, state transitions, hit tests and
  // collision separation all still have side effects with a zero delta.
  if (dt > 0) {
    // RoundManager detects death even with dt=0, so defer the call itself
    // until the finish has played. Its banner and intermission start then.
    const phase = finishing ? Phase.FIGHTING : rounds.update(dt);

    if (phase === Phase.FIGHTING && !finishing) {
      ai?.update(dt);
      // Both fighters receive the same snapshot of dt. Hits request timing
      // changes for the next frame, never a different delta for the second.
      p1.update(dt, world);
      p2.update(dt, world);
      ai?.endFrame();
    } else {
      // During a finish or intermission, play cosmetic timers and animations
      // without accepting attacks, applying damage, or running the AI.
      p1.updateCombatTimers(dt);
      p2.updateCombatTimers(dt);
      p1.animator.update(dt);
      p2.animator.update(dt);
    }

    // Keep keyboard edges pending through hit-stop, but discard them during
    // the cosmetic finish so they cannot leak into the next round.
    endInputFrame();
  }

  hud.setClock(rounds.timeLeft);
  hud.setCombo('p1', p1.comboCount);
  hud.setCombo('p2', p2.comboCount);

  // Include a finish first requested during this frame's hit resolution.
  const pushIn = finishing || impact.finishing ? CAMERA.koPush : 0;
  arena.updateCamera(dt, world.fighters, pushIn);
  arena.updateSparks(dt);
}

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------

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
  stage = { arena, hud, assets, brainStatus: 'local tactics only' };

  // The model bridge lives in the Electron main process; the key never reaches
  // here. Absent bridge (a plain browser) is a normal case, not an error.
  const status = await globalThis.lf?.status?.().catch(() => null);
  stage.brainStatus = status?.configured
    ? 'Azure brain ready'
    : (status?.reason ?? 'local tactics only');
  hud.setBrainStatus(stage.brainStatus);

  setInterval(async () => {
    const totals = await globalThis.lf?.usage?.().catch(() => null);
    if (totals) hud.setUsage(totals);
  }, 2000);

  // Assets are in memory, so the menu can appear. It owns Escape, pausing,
  // the match lifecycle, and focus.
  loading.classList.add('done');

  const menus = createMenus({
    onStart: (options) => startMatch(options),
    onQuit: () => endMatch(),
    clearInput,
  });

  let last = performance.now();
  function frame(now) {
    const realDt = Math.max(0, (now - last) / 1000);
    last = now;

    // Simulation runs only while a match is playing; rendering always does, so
    // the arena stays live behind the menu instead of freezing to a dead image.
    menus.advance(realDt, simulate);
    arena.render();

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

boot().catch((err) => {
  console.error(err);
  loadingLabel.textContent = `Failed to start: ${err.message}`;
});
