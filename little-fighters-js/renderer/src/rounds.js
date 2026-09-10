/**
 * Rounds: a 60-second countdown, best of three.
 *
 * A round ends when someone is knocked out, or when the clock runs out — in
 * which case whoever has more health left takes it. First to two rounds wins
 * the match. Between rounds both fighters are put back on their marks with
 * full health after a short pause.
 *
 * The manager owns no rendering and no input; it is driven by update(dt) and
 * reports what happened through callbacks, which is what makes it testable
 * without a browser.
 */

import { ROUNDS, ARENA } from './config.js';
import { State } from './fighter.js';

export const Phase = {
  FIGHTING: 'FIGHTING',
  INTERMISSION: 'INTERMISSION',
  MATCH_OVER: 'MATCH_OVER',
};

/** Put a fighter back on its mark, at full health, ready to go again. */
export function resetFighter(fighter, spawn) {
  fighter.position.set(spawn.x, spawn.y, spawn.z);
  fighter.velocity.set(0, 0, 0);
  fighter.onFloor = false;

  fighter.health.current = fighter.health.max;
  fighter.health.onChanged?.(fighter.health.current, fighter.health.max);

  fighter.state = State.IDLE;
  fighter.stateTime = 0;
  fighter.hitboxLive = false;
  fighter.alreadyHit.clear();
  fighter.dropkickConnected = false;

  fighter.facingSign = spawn.x <= 0 ? 1 : -1;
  fighter.rotationY = fighter.facingSign > 0 ? Math.PI / 2 : -Math.PI / 2;

  fighter.animator.play('idle', { loop: true });
  fighter.syncModel();
}

export class RoundManager {
  /**
   * @param {object} opts
   * @param {object} opts.p1  fighter on the left
   * @param {object} opts.p2  fighter on the right
   * @param {string[]} [opts.names]  display names, [p1, p2]
   * @param {(e: object) => void} [opts.onRoundEnd]   { winner, reason, wins }
   * @param {(e: object) => void} [opts.onMatchEnd]   { winner, wins }
   * @param {(e: object) => void} [opts.onRoundStart] { round }
   */
  constructor({ p1, p2, names = ['PLAYER 1', 'PLAYER 2'],
                onRoundEnd, onMatchEnd, onRoundStart } = {}) {
    this.p1 = p1;
    this.p2 = p2;
    this.names = names;
    this.onRoundEnd = onRoundEnd ?? (() => {});
    this.onMatchEnd = onMatchEnd ?? (() => {});
    this.onRoundStart = onRoundStart ?? (() => {});

    this.wins = { p1: 0, p2: 0 };
    this.round = 1;
    this.phase = Phase.FIGHTING;
    this.timeLeft = ROUNDS.seconds;
    this._intermission = 0;
    this.lastResult = null;
  }

  /** True while fighters should be accepting input and simulating. */
  get active() {
    return this.phase === Phase.FIGHTING;
  }

  get timeLeftCeil() {
    return Math.max(0, Math.ceil(this.timeLeft));
  }

  update(dt) {
    if (this.phase === Phase.MATCH_OVER) return this.phase;

    if (this.phase === Phase.INTERMISSION) {
      this._intermission -= dt;
      if (this._intermission <= 0) this.#startRound();
      return this.phase;
    }

    this.timeLeft -= dt;

    if (this.p1.state === State.KO) return this.#endRound('p2', 'KO');
    if (this.p2.state === State.KO) return this.#endRound('p1', 'KO');

    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      const a = this.p1.health.fraction;
      const b = this.p2.health.fraction;
      if (Math.abs(a - b) < 1e-6) return this.#endRound(null, 'DRAW');
      return this.#endRound(a > b ? 'p1' : 'p2', 'TIME');
    }

    return this.phase;
  }

  #endRound(winner, reason) {
    if (winner) this.wins[winner] += 1;
    this.lastResult = { winner, reason, wins: { ...this.wins }, round: this.round };
    this.onRoundEnd(this.lastResult);

    const target = ROUNDS.toWin;
    if (this.wins.p1 >= target || this.wins.p2 >= target) {
      this.phase = Phase.MATCH_OVER;
      const champion = this.wins.p1 >= target ? 'p1' : 'p2';
      this.onMatchEnd({ winner: champion, wins: { ...this.wins },
                        name: this.names[champion === 'p1' ? 0 : 1] });
      return this.phase;
    }

    this.phase = Phase.INTERMISSION;
    this._intermission = ROUNDS.intermissionSeconds;
    return this.phase;
  }

  #startRound() {
    this.round += 1;
    resetFighter(this.p1, ARENA.spawnP1);
    resetFighter(this.p2, ARENA.spawnP2);
    this.timeLeft = ROUNDS.seconds;
    this.phase = Phase.FIGHTING;
    this.onRoundStart({ round: this.round });
  }

  /** Human-readable label for a round result, for the banner. */
  describe(result = this.lastResult) {
    if (!result) return '';
    if (result.reason === 'DRAW') return 'DRAW';
    const name = this.names[result.winner === 'p1' ? 0 : 1];
    return result.reason === 'KO' ? `K.O.  —  ${name}` : `TIME UP  —  ${name}`;
  }
}
