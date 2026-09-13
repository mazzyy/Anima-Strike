/**
 * Pure move catalogue and command resolver. No clock or controller reads.
 *
 * History: chronological { input: 'forward' | 'neutral' | 'light' | ..., time }
 * entries, in simulation seconds. Directions are EDGES, not held samples.
 *
 * resolveMove(history, characterIdOrRosterEntry, {
 *   state: 'IDLE', now, airborne: false,
 *   currentMove: null, phase: 'startup' | 'active' | 'recovery'
 * })
 *
 * A string state is also accepted. With no explicit now, the latest sample's
 * time is used. Consumers must consume history after accepting a move.
 * Neutral entries separate repeated taps but are ignored while matching.
 * Other tokens are never skipped: a wrong direction breaks the command.
 */
import {
  MOVE_RULES,
} from './config.js';
import { MOVE_DATA } from './game-data.js';

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export const MOVES = freeze(Object.fromEntries(
  Object.entries(MOVE_DATA).map(([character, rows]) => [
    character,
    rows.map(([
      id, name, input, startup, active, recovery, damage, knockback, reach,
      options = {},
    ]) => ({
      ...MOVE_RULES.defaults,
      id, name, input, startup, active, recovery, damage, knockback, reach,
      ...options,
      character,
      cancelInto: [...(options.cancelInto ?? [])],
      effects: { ...(options.effects ?? {}) },
    })),
  ]),
));

export const MOVE_TABLES = MOVES;

export function canCancel(from, into) {
  if (!from || !into || from.knocksDown) return false;
  if (
    typeof into === 'object' && from.character && into.character
    && from.character !== into.character
  ) return false;
  return from.cancelInto?.includes(typeof into === 'string' ? into : into.id) ?? false;
}

/** Vertical wins for diagonals, matching the documented arena-plane commands. */
export function directionToken(direction, facingSign) {
  const threshold = MOVE_RULES.directionThreshold;
  if (direction.y > threshold) return 'down';
  if (direction.y < -threshold) return 'up';
  if (direction.x * facingSign > threshold) return 'forward';
  if (direction.x * facingSign < -threshold) return 'back';
  return 'neutral';
}

/** Returns a new bounded history, never mutates the caller's array. */
export function appendInput(history, input, time) {
  return [...history, { input, time }]
    .filter((entry) => time - entry.time <= MOVE_RULES.commandSeconds)
    .slice(-MOVE_RULES.historyLimit);
}

function eligible(move, context) {
  if (Boolean(context.airborne) !== move.airborne) return false;
  if (move.effects.fromBlock && context.state !== 'BLOCK') return false;

  if (context.currentMove) {
    return context.phase === 'recovery'
      && canCancel(context.currentMove, move)
      && !move.effects.fromBlock;
  }

  if (move.followupOnly) return false;
  if (context.state === 'BLOCK') return Boolean(move.effects.fromBlock);
  return ['IDLE', 'WALK', 'RUN', 'JUMP'].includes(context.state);
}

function matches(tokens, entries) {
  if (tokens.length > entries.length) return false;
  const start = entries.length - tokens.length;
  for (let i = 0; i < tokens.length; i += 1) {
    const entry = entries[start + i];
    if (entry.input !== tokens[i]) return false;
    if (i > 0 && entry.time - entries[start + i - 1].time > MOVE_RULES.stepSeconds) {
      return false;
    }
  }
  return entries.at(-1).time - entries[start].time <= MOVE_RULES.commandSeconds;
}

export function resolveMove(history, character, state = 'IDLE') {
  const moves = MOVES[typeof character === 'string' ? character : character?.id];
  if (!moves || !Array.isArray(history) || history.length === 0) return null;

  // Reject malformed/out-of-order history instead of silently sorting it.
  for (let i = 0; i < history.length; i += 1) {
    if (
      !Number.isFinite(history[i]?.time)
      || typeof history[i]?.input !== 'string'
      || (i > 0 && history[i].time < history[i - 1].time)
    ) return null;
  }

  const context = typeof state === 'string'
    ? { state, airborne: state === 'JUMP' }
    : { state: 'IDLE', ...state };
  const now = context.now ?? history.at(-1).time;
  if (!Number.isFinite(now) || now < history.at(-1).time) return null;

  const entries = history.filter((entry) => entry.input !== 'neutral');
  if (!entries.length) return null;
  if (now - entries.at(-1).time > MOVE_RULES.buttonBufferSeconds) return null;

  let best = null;
  let bestLength = 0;
  for (const move of moves) {
    if (!eligible(move, context)) continue;
    const tokens = move.input.split(',');
    // Deterministic author order resolves equal-length ties. Longer complete
    // commands always beat button-only/prefix alternatives.
    if (tokens.length > bestLength && matches(tokens, entries)) {
      best = move;
      bestLength = tokens.length;
    }
  }
  return best;
}
