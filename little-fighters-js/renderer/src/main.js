/**
 * Boot the game: choose a mode, load assets, spawn two fighters, run the loop.
 *
 * Player 1 uses WASD, J light jab, and I heavy punch. Player 2 is either the
 * CPU or a second local keyboard player. M toggles master audio mute.
 *
 * Matches are best of three 60-second rounds, and the camera keeps both
 * fighters framed. Impact timing is applied here, not inside the fighters.
 */

import { loadGameAssets, createAnimator } from './assets.js';
import { createArena } from './arena.js';
import { createHUD } from './hud.js';
import { initInput, endInputFrame, keyboardController } from './input.js';
import { Fighter, State } from './fighter.js';
import { AIController } from './ai.js';
import { RoundManager, Phase } from './rounds.js';
import { ImpactTiming } from './impact-timing.js';
import { play } from './audio.js';
import { ARENA, CAMERA, ROUNDS } from './config.js';

const canvas = document.getElementById('game');
const loading = document.getElementById('loading');
const loadingLabel = document.getElementById('loading-label');

function chooseMode() {
  loadingLabel.textContent = 'Choose a match mode';

  const menu = document.createElement('div');
  menu.setAttribute('role', 'group');
  menu.setAttribute('aria-label', 'Match mode');
  menu.style.pointerEvents = 'auto';
  menu.innerHTML = `
    <p>
      <button type="button" data-mode="cpu">1 Player — vs CPU</button>
      <button type="button" data-mode="local">2 Players — Local</button>
    </p>
    <p>
      P1: WASD move · Space jump · Left Shift run · J light jab ·
      I heavy punch · K kick · L block · U dash
    </p>
    <p>
      P2: Arrows move · / jump · , run · . light jab ·
      H heavy punch · V kick · N block · B dash
    </p>
    <p>M: mute / unmute sound</p>
  `;
  loading.append(menu);

  return new Promise((resolve) => {
    for (const button of menu.querySelectorAll('button')) {
      button.addEventListener('click', () => {
        button.blur();
        menu.remove();
        loadingLabel.textContent = 'Loading assets…';
        resolve(button.dataset.mode);
      }, { once: true });
    }
    menu.querySelector('button').focus();
  });
}

async function boot() {
  const mode = await chooseMode();
  const localMultiplayer = mode === 'local';

  const arena = createArena(canvas);
  const hud = createHUD(document.body);
  const impact = new ImpactTiming();

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
      onSound: play,
    });
  };

  // Do not construct an AI at all in local two-player mode.
  const ai = localMultiplayer
    ? null
    : new AIController({ name: 'CPU', useLLM: true, debug: true });

  const names = localMultiplayer ? ['PLAYER 1', 'PLAYER 2'] : ['YOU', 'CPU'];

  const p1 = makeFighter(names[0], ARENA.spawnP1, keyboardController('p1'));
  const p2 = makeFighter(
    names[1],
    ARENA.spawnP2,
    localMultiplayer ? keyboardController('p2') : ai,
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
  hud.setCombo('p1', 0);
  hud.setCombo('p2', 0);
  hud.setRounds('p1', 0, ROUNDS.toWin);
  hud.setRounds('p2', 0, ROUNDS.toWin);
  hud.setClock(ROUNDS.seconds);

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

      // Preserve the existing CPU mixup feedback.
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

  // -- rounds --------------------------------------------------------------
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
    onMatchEnd: ({ name }) => {
      hud.showBanner(`${name} WINS THE MATCH`);
    },
  });

  // -- brain status + spend readout ---------------------------------------
  // Local mode does not call any of the model bridge methods.
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
    hud.setBrainStatus('Local two-player — AI disabled');
  }

  // -- loop ----------------------------------------------------------------
  loading.classList.add('done');

  let last = performance.now();
  function frame(now) {
    const realDt = Math.max(0, (now - last) / 1000);
    last = now;
    const { dt, finishing } = impact.advance(realDt);

    // Do not call update(0): input reads, state transitions, hit tests, and
    // collision separation can still have side effects with a zero delta.
    if (dt > 0) {
      // RoundManager detects death even with dt=0, so defer the call itself
      // until the finish has played. Its banner and intermission start then.
      const phase = finishing ? Phase.FIGHTING : rounds.update(dt);

      if (phase === Phase.FIGHTING && !finishing) {
        ai?.update(dt);

        // Both receive the same snapshot of dt. Hits request timing changes
        // for the next frame, never a different delta for the second fighter.
        p1.update(dt, world);
        p2.update(dt, world);
        ai?.endFrame();
      } else {
        // During a finish or intermission, play cosmetic timers/animations
        // without accepting attacks, applying damage, or running the AI.
        p1.updateCombatTimers(dt);
        p2.updateCombatTimers(dt);
        p1.animator.update(dt);
        p2.animator.update(dt);
      }

      // Keep keyboard edges pending during hit-stop, but discard them during
      // the cosmetic finish/intermission so they cannot leak into a new round.
      endInputFrame();
    }

    hud.setClock(rounds.timeLeft);
    hud.setCombo('p1', p1.comboCount);
    hud.setCombo('p2', p2.comboCount);

    // Include a finish first requested during this frame's hit resolution.
    const pushIn = finishing || impact.finishing ? CAMERA.koPush : 0;
    arena.updateCamera(dt, world.fighters, pushIn);
    arena.updateSparks(dt);
    arena.render();

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

boot().catch((err) => {
  console.error(err);
  loadingLabel.textContent = `Failed to start: ${err.message}`;
});
