/**
 * Boot once, then run matches under the menu system.
 * Persistent renderer/assets; match-local fighters, rounds, and CPU brain.
 */
import { loadGameAssets, createAnimator } from './assets.js';
import { characterById, applyCharacter } from './characters.js';
import { createArena } from './arena.js';
import { createHUD } from './hud.js';
import { initInput, endInputFrame, clearInput, keyboardController } from './input.js';
import { Fighter, State } from './fighter.js';
import { AIController } from './ai.js';
import { RoundManager, Phase } from './rounds.js';
import { ImpactTiming } from './impact-timing.js';
import { createMenus } from './menu.js';
import { play } from './audio.js';
import { ARENA, CAMERA, ROUNDS, SCALE, DIFFICULTIES } from './config.js';

const canvas = document.getElementById('game');
const loading = document.getElementById('loading');
const loadingLabel = document.getElementById('loading-label');
let stage = null;
let match = null;

function startMatch({
  mode, difficulty, ai: aiTuning, p1Character, p2Character, map,
}) {
  const { arena, hud, assets } = stage;
  arena.setMap(map);
  const twoPlayer = mode === 'two-player';
  const characters = [characterById(p1Character), characterById(p2Character)];

  const spawn = (name, character, at, controller) => {
    const model = applyCharacter(assets.createCharacter(), character);
    arena.scene.add(model);
    return new Fighter({
      model,
      animator: createAnimator(model, assets.clips),
      controller,
      spawn: at,
      name,
      stats: { ...character.stats },
      reachScale: character.scale / SCALE,
      // The legacy sphere callback is intentionally not connected as well.
      onVFX: (id, options) => arena.vfx.emit(id, options),
      onSound: play,
    });
  };

  const ai = twoPlayer
    ? null
    : new AIController({ name: 'CPU', useLLM: true, debug: true, ...aiTuning });
  const roles = twoPlayer ? ['PLAYER 1', 'PLAYER 2'] : ['YOU', 'CPU'];
  const names = characters.map((character, index) => `${roles[index]} — ${character.name}`);
  const p1 = spawn(names[0], characters[0], ARENA.spawnP1, keyboardController('p1'));
  const p2 = spawn(
    names[1], characters[1], ARENA.spawnP2,
    twoPlayer ? keyboardController('p2') : ai,
  );
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
  hud.setBrainStatus(twoPlayer
    ? 'Local two-player — AI disabled'
    : `${DIFFICULTIES[difficulty].label} CPU — ${stage.brainStatus}`);
  arena.resetCamera();

  for (const defender of world.fighters) {
    const takeHit = defender.takeHit.bind(defender);
    defender.takeHit = (...args) => {
      const healthBefore = defender.health.current;
      const comboBefore = defender.comboCount;
      const wasBlocking = defender.state === State.BLOCK;
      const attacker = world.fighters.find(
        (fighter) => fighter !== defender && fighter.position === args[1],
      );
      const heavy = attacker?.state === State.HEAVY_ATTACK;
      const result = takeHit(...args);
      if (ai && defender === p1 && wasBlocking && defender.state === State.BLOCK) {
        ai.noteBlocked();
      }
      if (defender.health.current < healthBefore) {
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
      arena.vfx.clear();
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
  // Release snapshots and projectile references before releasing fighters.
  arena.vfx.clear();
  for (const fighter of match.world.fighters) {
    arena.scene.remove(fighter.model);
    const materials = new Set();
    fighter.model.traverse((object) => {
      if (!object.material) return;
      const list = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of list) {
        if (material) materials.add(material);
      }
    });
    for (const material of materials) material.dispose();
  }
  arena.resetCamera();
  hud.hideBanner();
  hud.setPlan(null);
  match = null;
}

function simulate(realDt) {
  if (!match) return;
  const { arena, hud } = stage;
  const { p1, p2, ai, world, rounds, impact } = match;
  const { dt, finishing } = impact.advance(realDt);

  if (dt > 0) {
    const phase = finishing ? Phase.FIGHTING : rounds.update(dt);
    if (phase === Phase.FIGHTING && !finishing) {
      ai?.update(dt);
      p1.update(dt, world);
      p2.update(dt, world);
      ai?.endFrame();
    } else {
      p1.updateCombatTimers(dt);
      p2.updateCombatTimers(dt);
      p1.animator.update(dt);
      p2.animator.update(dt);
    }
    endInputFrame();
  }

  hud.setClock(rounds.timeLeft);
  hud.setCombo('p1', p1.comboCount);
  hud.setCombo('p2', p2.comboCount);
  const pushIn = finishing || impact.finishing ? CAMERA.koPush : 0;
  arena.updateCamera(dt, world.fighters, pushIn);
  // One update: effects freeze with hit-stop and slow with the KO finish.
  arena.vfx.update(dt);
}

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
  const status = await globalThis.lf?.status?.().catch(() => null);
  stage.brainStatus = status?.configured
    ? 'Azure brain ready'
    : (status?.reason ?? 'local tactics only');
  hud.setBrainStatus(stage.brainStatus);
  setInterval(async () => {
    const totals = await globalThis.lf?.usage?.().catch(() => null);
    if (totals) hud.setUsage(totals);
  }, 2000);

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
