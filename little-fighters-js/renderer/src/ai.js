/**
 * The CPU opponent — ported from AIController.gd, same two-layer design.
 *
 *   · A local heuristic layer runs every frame and actually presses the
 *     buttons: approach, spacing, guard reflexes, attack mixups.
 *   · Every few seconds the Azure model returns a *plan* (stance, preferred
 *     attack, aggression) that re-weights the local layer.
 *
 * The model is never in the critical path of a frame. No key, a slow network,
 * or a garbled reply all degrade to the local layer and the match plays on.
 * The request goes through the preload bridge, so the API key stays in the
 * main process and never reaches this code.
 */

import { AI } from './config.js';
import { State } from './fighter.js';

/** The model speaks fighting-game words; the fighter has action names. */
const ACTION_FOR = {
  punch: 'attack',
  attack: 'attack',
  kick: 'kick',
  dropkick: 'kick',
  dash: 'dash',
  block: 'block',
};

export class AIController {
  constructor({ name = 'CPU', useLLM = true, debug = false } = {}) {
    this.name = name;
    this.useLLM = useLLM;
    this.debug = debug;

    this.fighter = null;
    this.opponent = null;

    this.stance = 'poke';
    this.preferred = 'attack';     // already a fighter action name
    this.wantsDropkick = false;
    this.aggression = 0.5;
    this.lastTaunt = '';

    this.thinkTimer = Math.random() * AI.thinkInterval;
    this.decisionTimer = 0;
    this.lastHealthBucket = -1;
    this.blockedStreak = 0;

    this.intentMove = { x: 0, y: 0 };
    this.holds = new Set();
    this.presses = new Set();
    this.onPlan = null;
  }

  attach(fighter, opponent) {
    this.fighter = fighter;
    this.opponent = opponent;
  }

  // -- the controller interface a Fighter reads ---------------------------

  move() { return this.intentMove; }
  pressed(action) { return this.presses.has(action); }
  held(action) { return this.holds.has(action); }
  /** The game loop calls this after every fighter update. */
  endFrame() { this.presses.clear(); }

  // -- per-frame -----------------------------------------------------------

  update(dt) {
    if (!this.fighter || !this.opponent) return;

    if (this.fighter.state === State.KO) {
      this.intentMove = { x: 0, y: 0 };
      this.holds.clear();
      return;
    }

    this.#maybeThink(dt);

    this.decisionTimer -= dt;
    if (this.decisionTimer > 0) return;
    this.decisionTimer = AI.reactionDelay;

    this.#act();
  }

  #act() {
    const me = this.fighter;
    const foe = this.opponent;

    const dx = foe.position.x - me.position.x;
    const dz = foe.position.z - me.position.z;
    const dist = Math.hypot(dx, dz);
    const dir = dist > 0.001 ? { x: dx / dist, y: dz / dist } : { x: 0, y: 0 };
    const back = { x: -dir.x, y: -dir.y };

    const foeAttacking = foe.state === State.ATTACK
      || foe.state === State.KICK
      || foe.state === State.DROPKICK;
    const myHealth = me.health.fraction;

    // Holds are re-asserted every decision tick, not latched.
    this.holds.clear();

    // Reflex: guard an incoming swing we are inside the range of.
    const guardChance = 0.75 - this.aggression * 0.45;
    if (foeAttacking && dist < AI.attackRange + 0.6 && Math.random() < guardChance) {
      this.intentMove = { x: 0, y: 0 };
      this.holds.add('block');
      return;
    }

    switch (this.stance) {
      case 'retreat':
        this.intentMove = back;
        if (dist < AI.attackRange && Math.random() < 0.25) this.presses.add('dash');
        return;

      case 'defensive':
        if (dist < AI.spacingRange) {
          this.intentMove = { x: back.x * 0.6, y: back.y * 0.6 };
          if (dist < AI.attackRange) this.holds.add('block');
        } else {
          this.intentMove = { x: 0, y: 0 };
        }
        if (dist < AI.attackRange && Math.random() < 0.15 * this.aggression) {
          this.presses.add(this.#pickAttack());
        }
        return;

      case 'spacing': {
        const band = AI.spacingRange;
        if (dist > band + 0.5) this.intentMove = { x: dir.x * 0.7, y: dir.y * 0.7 };
        else if (dist < band - 0.5) this.intentMove = { x: back.x * 0.7, y: back.y * 0.7 };
        else this.intentMove = { x: -dir.y * 0.5, y: dir.x * 0.5 };   // strafe
        if (dist <= AI.attackRange && Math.random() < 0.35 * this.aggression) {
          this.presses.add(this.#pickAttack());
        }
        return;
      }

      case 'rush':
        if (dist > AI.attackRange) {
          this.intentMove = dir;
          if (dist > AI.spacingRange) {
            this.holds.add('run');
            // run + kick is the drop kick — good for closing a big gap
            if (this.wantsDropkick && Math.random() < 0.05) this.presses.add('kick');
          }
        } else {
          this.intentMove = { x: dir.x * 0.2, y: dir.y * 0.2 };
          if (Math.random() < 0.5 + this.aggression * 0.4) {
            this.presses.add(this.#pickAttack());
          }
        }
        return;

      default:   // "poke"
        if (dist > AI.attackRange) {
          const s = 0.6 + this.aggression * 0.4;
          this.intentMove = { x: dir.x * s, y: dir.y * s };
          if (myHealth < 0.35 && Math.random() < 0.02) this.presses.add('dash');
        } else {
          this.intentMove = { x: 0, y: 0 };
          if (Math.random() < 0.3 + this.aggression * 0.35) {
            this.presses.add(this.#pickAttack());
          }
        }
    }
  }

  #pickAttack() {
    // Bias toward the plan's attack, but stay unpredictable so a human can't
    // just hold block against one button. dash/block are not attacks.
    const base = (this.preferred === 'attack' || this.preferred === 'kick')
      ? this.preferred : 'attack';
    if (this.blockedStreak >= 3) {
      this.blockedStreak = 0;
      return base === 'attack' ? 'kick' : 'attack';
    }
    if (Math.random() < 0.65) return base;
    return Math.random() < 0.5 ? 'attack' : 'kick';
  }

  noteBlocked() { this.blockedStreak += 1; }

  // -- the model layer -----------------------------------------------------

  #maybeThink(dt) {
    if (!this.useLLM || !globalThis.lf?.requestTactic) return;

    this.thinkTimer -= dt;

    // Re-plan immediately when the match state shifts meaningfully.
    const bucket = Math.floor(this.fighter.health.fraction * 4);
    if (bucket !== this.lastHealthBucket) {
      this.lastHealthBucket = bucket;
      this.thinkTimer = Math.min(this.thinkTimer, 0.2);
    }

    if (this.thinkTimer > 0) return;
    this.thinkTimer = AI.thinkInterval;

    globalThis.lf.requestTactic(this.#snapshot())
      .then((tactic) => { if (tactic) this.#applyPlan(tactic); })
      .catch(() => { /* local layer carries the fight */ });
  }

  #snapshot() {
    const dx = this.opponent.position.x - this.fighter.position.x;
    const dz = this.opponent.position.z - this.fighter.position.z;
    return {
      my_health_pct: Math.round(this.fighter.health.fraction * 100),
      enemy_health_pct: Math.round(this.opponent.health.fraction * 100),
      distance: Math.round(Math.hypot(dx, dz) * 10) / 10,
      attack_range: AI.attackRange,
      my_state: this.fighter.state,
      enemy_state: this.opponent.state,
      enemy_blocked_my_last_hits: this.blockedStreak,
      current_stance: this.stance,
    };
  }

  #applyPlan(tactic) {
    this.stance = tactic.stance ?? this.stance;
    const raw = String(tactic.preferred ?? 'punch').toLowerCase();
    this.wantsDropkick = raw === 'dropkick';
    this.preferred = ACTION_FOR[raw] ?? 'attack';
    if (Number.isFinite(tactic.aggression)) this.aggression = tactic.aggression;
    if (tactic.taunt) this.lastTaunt = tactic.taunt;

    if (this.debug) {
      console.log(`[AI] plan: ${this.stance} / ${this.preferred} / `
        + `aggression ${this.aggression.toFixed(2)}  ${this.lastTaunt}`);
    }
    this.onPlan?.(this);
  }
}
