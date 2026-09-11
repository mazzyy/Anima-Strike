/**
 * The CPU opponent: a local heuristic layer, optionally re-weighted by
 * asynchronous model plans through the Electron preload bridge.
 *
 * Plans are committed only in update(), never in a promise callback. Stopping
 * simulation therefore freezes AI state too, even if a request finishes.
 */

import { AI, COMBAT } from './config.js';
import { State } from './fighter.js';

const ACTION_FOR = {
  light: 'light',
  jab: 'light',
  light_punch: 'light',
  light_attack: 'light',
  punch: 'light',
  attack: 'light',
  heavy: 'heavy',
  heavy_punch: 'heavy',
  heavy_attack: 'heavy',
  kick: 'kick',
  dropkick: 'kick',
  dash: 'dash',
  block: 'block',
};

const ATTACK_ACTIONS = ['light', 'heavy', 'kick'];

const clampAggression = (value) => Math.max(0, Math.min(1, value));

export class AIController {
  constructor({
    name = 'CPU',
    useLLM = true,
    debug = false,
    baseAggression = AI.baseAggression,
    thinkInterval = AI.thinkInterval,
  } = {}) {
    this.name = name;
    this.useLLM = useLLM;
    this.debug = debug;

    this.baseAggression = Number.isFinite(baseAggression)
      ? clampAggression(baseAggression)
      : AI.baseAggression;
    this.thinkInterval = Number.isFinite(thinkInterval) && thinkInterval > 0
      ? thinkInterval
      : AI.thinkInterval;

    this.fighter = null;
    this.opponent = null;

    this.stance = 'poke';
    this.preferred = 'light';
    this.wantsDropkick = false;
    this.aggression = this.baseAggression;
    this.lastTaunt = '';

    this.thinkTimer = Math.random() * this.thinkInterval;
    this.decisionTimer = 0;
    this.lastHealthBucket = -1;
    this.blockedStreak = 0;

    this.intentMove = { x: 0, y: 0 };
    this.holds = new Set();
    this.presses = new Set();
    this.onPlan = null;

    this.pendingPlan = null;
    this.requestPending = false;
    this.disposed = false;
  }

  attach(fighter, opponent) {
    this.fighter = fighter;
    this.opponent = opponent;
  }

  move() { return this.intentMove; }
  pressed(action) { return this.presses.has(action); }
  held(action) { return this.holds.has(action); }
  endFrame() { this.presses.clear(); }

  /**
   * Call when leaving a match, not when pausing it. A late request from this
   * controller can no longer affect a subsequent match or its HUD.
   */
  dispose() {
    this.disposed = true;
    this.pendingPlan = null;
    this.intentMove = { x: 0, y: 0 };
    this.holds.clear();
    this.presses.clear();
    this.onPlan = null;
    this.fighter = null;
    this.opponent = null;
  }

  update(dt) {
    if (this.disposed || !this.fighter || !this.opponent) return;

    if (this.fighter.state === State.KO) {
      this.intentMove = { x: 0, y: 0 };
      this.holds.clear();
      this.presses.clear();
      return;
    }

    if (this.pendingPlan) {
      const plan = this.pendingPlan;
      this.pendingPlan = null;
      this.#applyPlan(plan);
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
    const dir = dist > 0.001
      ? { x: dx / dist, y: dz / dist }
      : { x: 0, y: 0 };
    const back = { x: -dir.x, y: -dir.y };

    const foeAttacking = foe.state === State.ATTACK
      || foe.state === State.LIGHT_ATTACK
      || foe.state === State.HEAVY_ATTACK
      || foe.state === State.KICK
      || foe.state === State.DROPKICK;
    const myHealth = me.health.fraction;

    this.holds.clear();

    const guardChance = 0.75 - this.aggression * 0.45;
    if (foeAttacking && dist < AI.attackRange + 0.6
      && Math.random() < guardChance) {
      this.intentMove = { x: 0, y: 0 };
      this.holds.add('block');
      return;
    }

    switch (this.stance) {
      case 'retreat':
        this.intentMove = back;
        if (dist < AI.attackRange && Math.random() < 0.25) {
          this.presses.add('dash');
        }
        return;

      case 'defensive':
        if (dist < AI.spacingRange) {
          this.intentMove = { x: back.x * 0.6, y: back.y * 0.6 };
          if (dist < AI.attackRange) this.holds.add('block');
        } else {
          this.intentMove = { x: 0, y: 0 };
        }
        if (dist < AI.attackRange
          && Math.random() < 0.15 * this.aggression) {
          this.presses.add(this.#pickAttack());
        }
        return;

      case 'spacing': {
        const band = AI.spacingRange;
        if (dist > band + 0.5) {
          this.intentMove = { x: dir.x * 0.7, y: dir.y * 0.7 };
        } else if (dist < band - 0.5) {
          this.intentMove = { x: back.x * 0.7, y: back.y * 0.7 };
        } else {
          this.intentMove = { x: -dir.y * 0.5, y: dir.x * 0.5 };
        }
        if (dist <= AI.attackRange
          && Math.random() < 0.35 * this.aggression) {
          this.presses.add(this.#pickAttack());
        }
        return;
      }

      case 'rush':
        if (dist > AI.attackRange) {
          this.intentMove = dir;
          if (dist > AI.spacingRange) {
            this.holds.add('run');
            if (this.wantsDropkick && Math.random() < 0.05) {
              this.presses.add('kick');
            }
          }
        } else {
          this.intentMove = { x: dir.x * 0.2, y: dir.y * 0.2 };
          if (Math.random() < 0.5 + this.aggression * 0.4) {
            this.presses.add(this.#pickAttack());
          }
        }
        return;

      default:
        if (dist > AI.attackRange) {
          const speed = 0.6 + this.aggression * 0.4;
          this.intentMove = { x: dir.x * speed, y: dir.y * speed };
          if (myHealth < 0.35 && Math.random() < 0.02) {
            this.presses.add('dash');
          }
        } else {
          this.intentMove = { x: 0, y: 0 };
          if (Math.random() < 0.3 + this.aggression * 0.35) {
            this.presses.add(this.#pickAttack());
          }
        }
    }
  }

  #pickAttack() {
    const base = ATTACK_ACTIONS.includes(this.preferred) ? this.preferred : 'light';

    if (this.blockedStreak >= 3) {
      this.blockedStreak = 0;
      const alternatives = ATTACK_ACTIONS.filter((action) => action !== base);
      return alternatives[Math.floor(Math.random() * alternatives.length)];
    }
    if (Math.random() < AI.preferredAttackChance) return base;
    return ATTACK_ACTIONS[Math.floor(Math.random() * ATTACK_ACTIONS.length)];
  }

  noteBlocked() { this.blockedStreak += 1; }

  #maybeThink(dt) {
    if (!this.useLLM || !globalThis.lf?.requestTactic) return;

    this.thinkTimer -= dt;

    const bucket = Math.floor(this.fighter.health.fraction * 4);
    if (bucket !== this.lastHealthBucket) {
      this.lastHealthBucket = bucket;
      this.thinkTimer = Math.min(this.thinkTimer, 0.2);
    }

    if (this.thinkTimer > 0 || this.requestPending) return;
    this.thinkTimer = this.thinkInterval;
    this.requestPending = true;

    const snapshot = this.#snapshot();

    // Promise.resolve also puts synchronous bridge errors on the fallback path.
    Promise.resolve()
      .then(() => {
        if (this.disposed) return null;
        return globalThis.lf.requestTactic(snapshot);
      })
      .then((tactic) => {
        if (!this.disposed && tactic && typeof tactic === 'object') {
          this.pendingPlan = tactic;
        }
      })
      .catch(() => { /* local layer carries the fight */ })
      .finally(() => {
        this.requestPending = false;
      });
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
      // Advertise the extended preferred-action vocabulary to model plans.
      // Old punch/attack responses are still accepted as light jabs.
      available_attacks: {
        light: {
          description: 'Light jab: fast startup and short recovery.',
          damage: COMBAT.lightAttack.damage,
          knockback: COMBAT.lightAttack.knockback,
          playback_speed: COMBAT.lightAttack.speed,
        },
        heavy: {
          description: 'Heavy punch: slower startup and longer recovery, stronger impact.',
          damage: COMBAT.heavyAttack.damage,
          knockback: COMBAT.heavyAttack.knockback,
          playback_speed: COMBAT.heavyAttack.speed,
        },
        kick: { damage: COMBAT.kickDamage },
        dropkick: { damage: COMBAT.dropkickDamage, knocks_down: true },
      },
    };
  }

  #applyPlan(tactic) {
    this.stance = tactic.stance ?? this.stance;
    const raw = String(tactic.preferred ?? 'light')
      .trim().toLowerCase().replace(/[\s-]+/g, '_');

    this.wantsDropkick = raw === 'dropkick';
    this.preferred = Object.hasOwn(ACTION_FOR, raw) ? ACTION_FOR[raw] : 'light';

    if (Number.isFinite(tactic.aggression)) {
      this.aggression = clampAggression(
        this.baseAggression
          + (clampAggression(tactic.aggression) - AI.planAggressionNeutral)
          * AI.planAggressionWeight,
      );
    }

    if (tactic.taunt) this.lastTaunt = tactic.taunt;

    if (this.debug) {
      console.log(`[AI] plan: ${this.stance} / ${this.preferred} / `
        + `aggression ${this.aggression.toFixed(2)}  ${this.lastTaunt}`);
    }
    this.onPlan?.(this);
  }
}
