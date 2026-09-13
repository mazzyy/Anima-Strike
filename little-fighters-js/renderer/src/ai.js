/**
 * Local move-list policy, optionally re-weighted by asynchronous model plans.
 * Only controller inputs cross into Fighter: no state, history or meter writes.
 * Plans are committed in update(), so pausing also freezes AI decisions.
 */
import {
  AI, COMBAT, ARENA, BODY, DIFFICULTIES, MOVE_RULES, METER, SUPER_RULES,
} from './config.js';
import { MOVE_DATA, SUPER_DATA } from './game-data.js';
import { State } from './fighter.js';
import { appendInput, directionToken, resolveMove } from './moves.js';

const ACTION_FOR = {
  light: 'light', jab: 'light', light_punch: 'light',
  light_attack: 'light', punch: 'light', attack: 'light',
  heavy: 'heavy', heavy_punch: 'heavy', heavy_attack: 'heavy',
  kick: 'kick', dropkick: 'kick', dash: 'dash', block: 'block',
};

const UNAVAILABLE = new Set([
  State.KO, State.KNOCKDOWN, State.GETUP, State.HIT, State.JUGGLE,
  State.HELD, State.GRAB, State.GRABBING, State.THROW, State.GRAB_RECOVERY,
  State.SUPER, State.DASH,
]);
const UNTARGЕTABLE = new Set([State.KO, State.KNOCKDOWN, State.GETUP]);
const LEGACY_SWINGS = new Set([
  State.ATTACK, State.LIGHT_ATTACK, State.HEAVY_ATTACK,
  State.KICK, State.DROPKICK, State.AIR_LIGHT_ATTACK,
  State.AIR_HEAVY_ATTACK, State.DIVE_KICK,
]);
const clampAggression = (value) => Math.max(0, Math.min(1, value));

function airborne(fighter) {
  return !fighter.onFloor && fighter.position.y > ARENA.floorY;
}

function phaseAt(fighter, ahead = 0) {
  const move = fighter.currentMove;
  if (!move) return null;
  const time = fighter.stateTime + ahead;
  return time < move.startup ? 'startup'
    : time < move.startup + move.active ? 'active' : 'recovery';
}

function recoveryLeft(fighter) {
  if (fighter.currentMove) {
    const move = fighter.currentMove;
    return phaseAt(fighter) === 'recovery'
      ? Math.max(0, move.startup + move.active + move.recovery - fighter.stateTime)
      : 0;
  }
  if (fighter.state === State.SUPER && fighter.currentSuper) {
    const move = fighter.currentSuper;
    const lastFrame = move.hits.at(-1)?.frame ?? move.counterEndFrame;
    if (fighter.stateTime < lastFrame / SUPER_RULES.fps) return 0;
    return Math.max(0, move.durationFrames / SUPER_RULES.fps - fighter.stateTime);
  }
  if (fighter.state === State.HIT || fighter.state === State.GRAB_RECOVERY) {
    const duration = fighter.state === State.HIT
      ? fighter.reactionLength : COMBAT.grab.recoverySeconds;
    return Math.max(0, duration - fighter.stateTime);
  }
  if (
    LEGACY_SWINGS.has(fighter.state)
    && fighter.stateTime >= fighter.swingLength * COMBAT.hitWindowEnd
  ) return Math.max(0, fighter.swingLength - fighter.stateTime);
  return 0;
}

function threatLeft(fighter) {
  if (fighter.currentMove?.damage > 0) {
    const move = fighter.currentMove;
    if (fighter.stateTime < move.startup + move.active) {
      return Math.max(0, move.startup - fighter.stateTime);
    }
  } else if (LEGACY_SWINGS.has(fighter.state)) {
    const end = fighter.swingLength * COMBAT.hitWindowEnd;
    if (fighter.stateTime < end) {
      return Math.max(0, fighter.swingLength * COMBAT.hitWindowStart - fighter.stateTime);
    }
  }
  return Infinity;
}

function difficultyFor(id, aggression) {
  if (Object.hasOwn(DIFFICULTIES, id)) return DIFFICULTIES[id];
  // Existing match creation passes baseAggression/thinkInterval rather than an ID.
  return Object.values(DIFFICULTIES).reduce((best, preset) => (
    Math.abs(preset.baseAggression - aggression) < Math.abs(best.baseAggression - aggression)
      ? preset : best
  ), DIFFICULTIES.normal);
}

function commandSteps(command) {
  const steps = ['neutral'];
  const directions = command.slice(0, -1);
  for (let i = 0; i < directions.length; i += 1) {
    if (directions[i] === directions[i - 1]) steps.push('neutral');
    steps.push(directions[i]);
  }
  steps.push(command.at(-1));
  return steps;
}

export class AIController {
  constructor({
    name = 'CPU',
    useLLM = true,
    debug = false,
    baseAggression = AI.baseAggression,
    thinkInterval = AI.thinkInterval,
    difficulty = null,
    random = Math.random,
  } = {}) {
    this.name = name;
    this.useLLM = useLLM;
    this.debug = debug;
    this.random = random;
    this.baseAggression = Number.isFinite(baseAggression)
      ? clampAggression(baseAggression) : AI.baseAggression;
    this.thinkInterval = Number.isFinite(thinkInterval) && thinkInterval > 0
      ? thinkInterval : AI.thinkInterval;
    this.skill = difficultyFor(difficulty, this.baseAggression);

    this.fighter = null;
    this.opponent = null;
    this.stance = 'poke';
    this.preferred = 'light';
    this.wantsDropkick = false;
    this.aggression = this.baseAggression;
    this.lastTaunt = '';

    this.thinkTimer = this.random() * this.thinkInterval;
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
    this.sequence = null;
    // Diagnostic only: records emitted commands, not speculative selections.
    this.lastSelection = null;
    this.#resetExchange();
  }

  #resetExchange() {
    this.sequence = null;
    this.observedMove = null;
    this.observedTime = 0;
    this.observedClock = -1;
    this.stringLength = 0;
    this.cancelDecided = false;
    this.cancelAllowed = false;
    this.opportunityKey = null;
    this.opportunityAge = 0;
    this.recognizedPunish = false;
  }

  attach(fighter, opponent) {
    this.fighter = fighter;
    this.opponent = opponent;
    this.#resetExchange();
    this.#neutral();
    this.decisionTimer = 0;
    this.lastSelection = null;
  }

  move() { return this.intentMove; }
  pressed(action) { return this.presses.has(action); }
  held(action) { return this.holds.has(action); }
  endFrame() { this.presses.clear(); }

  #neutral() {
    this.intentMove = { x: 0, y: 0 };
    this.holds.clear();
    this.presses.clear();
  }

  dispose() {
    this.disposed = true;
    this.pendingPlan = null;
    this.#resetExchange();
    this.#neutral();
    this.onPlan = null;
    this.fighter = null;
    this.opponent = null;
  }

  #observe(dt) {
    const me = this.fighter;
    if (me.inputClock < this.observedClock) this.#resetExchange();

    if (!me.currentMove) {
      this.stringLength = 0;
      this.cancelDecided = false;
    } else if (
      me.currentMove !== this.observedMove || me.stateTime < this.observedTime
    ) {
      this.stringLength += 1;
      this.cancelDecided = false;
    }
    this.observedMove = me.currentMove;
    this.observedTime = me.stateTime;
    this.observedClock = me.inputClock;

    const foe = this.opponent;
    const recovering = recoveryLeft(foe) > 0;
    const counterThreat = SUPER_DATA[me.character]?.kind === 'counter'
      && Number.isFinite(threatLeft(foe));
    const key = recovering || counterThreat
      ? foe.currentMove ?? foe.currentSuper ?? foe.state : null;
    if (key !== this.opportunityKey) {
      this.opportunityKey = key;
      this.opportunityAge = 0;
      // One recognition roll per opportunity, not a retry every frame.
      this.recognizedPunish = key !== null && this.random() < this.skill.punishChance;
    } else {
      this.opportunityAge += dt;
    }
  }

  update(dt) {
    if (this.disposed || !this.fighter || !this.opponent) return;
    this.presses.clear();
    this.#observe(dt);

    if (this.fighter.state === State.KO) {
      this.sequence = null;
      this.#neutral();
      return;
    }
    if (this.pendingPlan) {
      const plan = this.pendingPlan;
      this.pendingPlan = null;
      this.#applyPlan(plan);
    }
    this.#maybeThink(dt);

    // Safety is evaluated every frame, independently of difficulty/reaction delay.
    if (
      UNTARGЕTABLE.has(this.opponent.state) || this.opponent.invulnerable
      || UNAVAILABLE.has(this.fighter.state)
    ) {
      this.sequence = null;
      this.#neutral();
      return;
    }

    if (this.sequence) {
      this.#advanceCommand(dt);
      return;
    }

    // Confirmed cancel decisions are sampled once per swing. Execution then runs
    // at input cadence, not at the model/request cadence.
    if (this.fighter.currentMove) {
      if (!this.fighter.swingConnected) return;
      if (!this.cancelDecided) {
        this.cancelDecided = true;
        this.cancelAllowed = this.stringLength < this.skill.maxString
          && this.random() < this.skill.cancelChance;
      }
      if (!this.cancelAllowed) return;
    } else {
      this.decisionTimer -= dt;
      if (this.decisionTimer > 0) return;
      this.decisionTimer = this.skill.reactionDelay;
    }

    this.#act(dt);
  }

  #context(now, guard = false) {
    const me = this.fighter;
    const state = !me.currentMove && guard
      && [State.IDLE, State.WALK, State.RUN].includes(me.state)
      ? State.BLOCK : me.state;
    return {
      now, state, airborne: airborne(me), currentMove: me.currentMove,
      phase: phaseAt(me, now - me.inputClock),
    };
  }

  #vector(token) {
    const me = this.fighter;
    const facing = me.inputHistory.length ? me.commandFacing : me.facingSign;
    switch (token) {
      case 'forward': return { x: facing, y: 0 };
      case 'back': return { x: -facing, y: 0 };
      case 'up': return { x: 0, y: -1 };
      case 'down': return { x: 0, y: 1 };
      default: return { x: 0, y: 0 };
    }
  }

  #reach(move) {
    const projectile = move.effects.projectile;
    if (projectile) {
      return projectile.offset + projectile.speed * projectile.life + move.reach;
    }
    if (move.effects.grab) return Math.min(move.reach, COMBAT.grab.range);
    if (move.effects.parry) return AI.attackRange;
    return move.reach * this.fighter.reachScale
      + Math.max(0, move.effects.speed ?? 0) * (move.startup + move.active);
  }

  #canReach(move, distance) {
    if (move.damage === 0 && !move.effects.parry) return true;
    const tolerance = move.effects.grab ? 0 : BODY.hurtRadius;
    if (distance > this.#reach(move) + tolerance) return false;
    const height = MOVE_RULES.heights[move.hitHeight];
    const me = this.fighter;
    const foe = this.opponent;
    if (
      height && (me.position.y + height.top < foe.position.y
        || me.position.y + height.bottom > foe.position.y + BODY.height)
    ) return false;
    if (move.effects.grab && (
      airborne(foe) || foe.grabImmunityLeft > 0 || foe.heldBy || foe.grabbedFighter
    )) return false;
    return true;
  }

  #candidates(distance, dt) {
    const me = this.fighter;
    const candidates = [];
    for (const row of MOVE_DATA[me.character] ?? []) {
      const command = row[2].split(',');
      const steps = commandSteps(command);
      const duration = (steps.length - 1) * Math.max(dt, AI.moves.inputStepSeconds);
      const now = me.inputClock + duration + dt;
      const guard = command.length > 1 && me.onFloor && !me.currentMove;

      // Ask the real resolver which row this command means in this context.
      // In particular, identical light/heavy inputs are not interchangeable
      // between openers, follow-ups and from-block moves.
      let history = [];
      command.forEach((token, index) => {
        history = appendInput(
          history, token, now - (command.length - 1 - index) * AI.moves.inputStepSeconds,
        );
      });
      const move = resolveMove(history, me.character, this.#context(now, guard));
      if (!move || move.id !== row[0] || !this.#canReach(move, distance)) continue;
      if ((move.effects.selfDamage ?? 0) >= me.health.current) continue;
      candidates.push({ move, command, steps, guard, duration });
    }
    return candidates;
  }

  #score(candidate, distance, recovering, threatening) {
    const { move, command } = candidate;
    const w = AI.moves.weights;
    const band = distance <= AI.moves.closeRange ? 'close'
      : distance <= AI.spacingRange ? 'mid' : 'far';
    let score = w.speed / (move.startup + move.recovery)
      + move.damage * w.damage
      + Math.min(distance, move.reach * this.fighter.reachScale) * w.range[band];

    if (move.cancelInto?.length) score += w.stringStarter;
    if (command.at(-1) === this.preferred) score += AI.preferredAttackChance;
    if (this.wantsDropkick && (move.effects.dive || move.effects.speed > 0)) {
      score += AI.preferredAttackChance;
    }
    if (airborne(this.opponent)) {
      if (move.hitHeight === 'high' || move.hitHeight === 'air') score += w.antiAir;
      if (move.effects.launch) score += w.launch;
    }
    if (this.opponent.state === State.BLOCK || this.blockedStreak >= AI.moves.blockedThreshold) {
      if (move.effects.grab) score += w.grab;
      if (move.hitHeight === 'low') score += w.low;
    }
    if (recovering) score += move.damage * w.punishDamage;
    if (move.effects.parry) score += threatening ? w.parry : -w.unsuitable;
    if (move.effects.armor && threatening) score += w.armor;
    if (move.effects.projectile && band === 'far') score += w.projectile;

    if (move.damage === 0 && !move.effects.parry) {
      score -= w.unsuitable;
      if (this.stance === 'retreat' && move.effects.teleport) score += w.escape;
      if (this.fighter.currentMove && move.effects.finish === State.RUN) {
        score += w.mobilityCancel;
      }
    }
    score -= (move.effects.selfDamage ?? 0) * w.selfDamage
      / Math.max(this.fighter.health.fraction, AI.moves.healthFloor);
    return score + this.random() * w.variation;
  }

  #trySuper(distance, recover, threat) {
    const me = this.fighter;
    const move = SUPER_DATA[me.character];
    if (
      !move || me.currentMove || !me.onFloor || me.meter < METER.stockSize
      || !SUPER_RULES.allowedStates.includes(me.state)
      || !this.recognizedPunish || this.opportunityAge < this.skill.reactionDelay
    ) return false;

    const reach = ['column', 'flurry', 'pound', 'counter'].includes(move.kind)
      ? move.reach : move.reach * me.reachScale;
    if (distance > reach + BODY.hurtRadius) return false;

    const startup = move.startupFrames / SUPER_RULES.fps;
    if (move.kind === 'counter') {
      // Counter supers need an incoming commitment, not an idle/recovering foe.
      if (
        !Number.isFinite(threat) || threat < startup
        || threat >= move.counterEndFrame / SUPER_RULES.fps
      ) return false;
    } else if (recover < startup + AI.moves.punishMargin) {
      return false;
    }

    this.presses.add('super');
    return true;
  }

  #act(dt) {
    const me = this.fighter;
    const foe = this.opponent;
    const dx = foe.position.x - me.position.x;
    const dz = foe.position.z - me.position.z;
    const distance = Math.hypot(dx, dz);
    const dir = distance > 0 ? { x: dx / distance, y: dz / distance } : { x: 0, y: 0 };
    const back = { x: -dir.x, y: -dir.y };
    const recover = recoveryLeft(foe);
    const threat = threatLeft(foe);
    const threatening = Number.isFinite(threat) && distance < AI.spacingRange;
    const punish = recover > 0 && this.recognizedPunish
      && this.opportunityAge >= this.skill.reactionDelay;

    this.#neutral();

    // Grounded directional commands are entered under guard. This is ordinary
    // player input and prevents a down/back tap from turning the strike away.
    // First orient using normal movement; never assign Fighter's facing/yaw.
    const facing = Math.sin(me.rotationY) * dir.x + Math.cos(me.rotationY) * dir.y;
    if (!me.currentMove && distance > 0 && facing < AI.moves.facingDot) {
      this.intentMove = dir;
      return;
    }

    if (this.#trySuper(distance, recover, threat)) return;

    // Missing a punish is a decision, not malformed inputs or a weaker move.
    if (recover > 0 && !punish && !me.currentMove) return;

    let candidates = this.#candidates(distance, dt);
    if (punish && !me.currentMove) {
      candidates = candidates.filter(({ move, duration }) => {
        const projectile = move.effects.projectile;
        const travel = projectile
          ? Math.max(0, distance - projectile.offset) / projectile.speed : 0;
        return move.damage > 0
          && duration + move.startup + travel + AI.moves.punishMargin <= recover;
      });
    }

    candidates.sort((a, b) => {
      // Score once below instead of rolling noise from inside Array.sort().
      return a.move.id.localeCompare(b.move.id);
    });
    const ranked = candidates.map((candidate) => ({
      ...candidate,
      score: this.#score(candidate, distance, punish, threatening),
    })).sort((a, b) => b.score - a.score);

    if (me.currentMove) {
      // resolveMove itself enforces the table's cancel graph and phase rules.
      if (ranked.length) this.#beginCommand(ranked[0], dt);
      return;
    }

    if (this.stance === 'retreat') {
      const escape = ranked.find(({ move }) => move.effects.teleport);
      if (escape && threatening) this.#beginCommand(escape, dt);
      else this.intentMove = back;
      return;
    }

    const guardChance = AI.moves.guardBase - this.aggression * AI.moves.guardAggression;
    if (threatening && !punish && this.random() < guardChance) {
      const parry = ranked.find(({ move }) => move.effects.parry);
      if (parry) this.#beginCommand(parry, dt);
      else this.holds.add('block');
      return;
    }

    if (
      me.onFloor && !punish && !threatening
      && (airborne(foe) || foe.state === State.BLOCK)
      && distance <= AI.moves.closeRange
      && (MOVE_DATA[me.character] ?? []).some((row) => row[9].airborne)
      && this.random() < AI.moves.jumpChance * this.aggression
    ) {
      this.intentMove = dir;
      this.presses.add('jump');
      return;
    }

    const stanceWeight = AI.moves.stanceAttack[this.stance] ?? AI.moves.stanceAttack.poke;
    const attackChance = stanceWeight * (
      AI.moves.attackBase + this.aggression * AI.moves.attackAggression
    );
    const selected = ranked.find(({ score }) => score > 0);
    if (selected && (punish || this.random() < attackChance)) {
      this.#beginCommand(selected, dt);
      return;
    }

    if (!selected) {
      this.intentMove = dir;
      if (distance > AI.spacingRange && this.stance === 'rush') this.holds.add('run');
    } else if (this.stance === 'spacing' || this.stance === 'defensive') {
      if (distance < AI.spacingRange) this.intentMove = back;
      if (this.stance === 'defensive' && threatening) this.holds.add('block');
    }
  }

  #beginCommand(candidate, dt) {
    this.sequence = {
      ...candidate, index: -1, left: 0,
      source: this.fighter.currentMove,
      started: this.fighter.inputClock,
    };
    this.#advanceCommand(dt);
  }

  #advanceCommand(dt) {
    const me = this.fighter;
    const sequence = this.sequence;
    this.#neutral();
    if (
      me.currentMove !== sequence.source
      || me.inputClock - sequence.started > MOVE_RULES.commandSeconds
    ) {
      this.sequence = null;
      return;
    }

    sequence.left -= dt;
    if (sequence.left <= 0) {
      sequence.index += 1;
      sequence.left = AI.moves.inputStepSeconds;
    }
    const token = sequence.steps[sequence.index];
    if (sequence.guard) this.holds.add('block');

    if (sequence.index < sequence.steps.length - 1) {
      this.intentMove = this.#vector(token);
      return;
    }

    // Validate the exact history Fighter will see this frame. Movement history,
    // a facing change, landing, or a longer matching command can invalidate a
    // speculative choice. Never emit its button and fall back to a legacy swing.
    const now = me.inputClock + dt;
    let history = me.inputHistory.filter(
      (entry) => now - entry.time <= MOVE_RULES.commandSeconds,
    );
    const facing = history.length ? me.commandFacing : me.facingSign;
    const direction = directionToken(this.intentMove, facing);
    if (direction !== me.lastDirection) history = appendInput(history, direction, now);
    history = appendInput(history, token, now);
    const resolved = resolveMove(
      history, me.character, this.#context(now, sequence.guard),
    );

    this.sequence = null;
    this.holds.clear();
    if (
      !resolved || resolved.id !== sequence.move.id
      || !this.#canReach(resolved, Math.hypot(
        this.opponent.position.x - me.position.x,
        this.opponent.position.z - me.position.z,
      ))
    ) {
      // Neutral time lets an obstructing suffix expire without editing history.
      this.decisionTimer = MOVE_RULES.commandSeconds;
      return;
    }
    // Preserve a from-block context through the same held-input path as a human.
    if (sequence.guard) this.holds.add('block');
    this.presses.add(token);
    this.lastSelection = {
      character: me.character, move: resolved,
      command: [...sequence.command], clock: now,
    };
    this.decisionTimer = this.skill.reactionDelay;
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
