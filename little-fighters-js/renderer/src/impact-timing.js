/**
 * Loop-owned impact timing. No fighter, renderer, or round-manager dependencies.
 * advance() consumes real seconds and returns the globally scaled simulation dt.
 */
import { IMPACT } from './config.js';

export class ImpactTiming {
  constructor() {
    this.reset();
  }

  reset() {
    this.hitStopLeft = 0;
    this.finishLeft = 0;
    this.finishing = false;
    this.finishStarted = false;
  }

  /** Called only for confirmed damage; heavy means an unblocked heavy punch. */
  notifyHit({ heavy = false, lethal = false } = {}) {
    // A finish is one-shot until the next round, including simultaneous KOs.
    if (this.finishStarted) return;

    if (heavy) {
      // Refresh, rather than stack, overlapping impact pauses.
      this.hitStopLeft = Math.max(this.hitStopLeft, IMPACT.hitStopSeconds);
    }

    if (lethal) {
      this.finishStarted = true;
      this.finishing = true;
      this.finishLeft = IMPACT.koSeconds;
    }
  }

  advance(realDt) {
    let available = Number.isFinite(realDt) ? Math.max(0, realDt) : 0;

    // Hit-stop takes precedence. A heavy KO gets the full slow-motion duration
    // AFTER its pause, rather than spending part of that duration frozen.
    const stopped = Math.min(available, this.hitStopLeft);
    this.hitStopLeft = Math.max(0, this.hitStopLeft - stopped);
    available -= stopped;

    const finishing = this.finishing;
    const timeScale = available === 0
      ? 0
      : finishing ? IMPACT.koTimeScale : 1;

    if (finishing) {
      available = Math.min(available, this.finishLeft);
      this.finishLeft = Math.max(0, this.finishLeft - available);
      this.finishing = this.finishLeft > 0;
    }

    // Clamp simulation only, not effect lifetimes: resuming a suspended window
    // must neither teleport fighters nor leave a stale slow-motion timer.
    const dt = Math.min(available, IMPACT.maxFrameSeconds) * timeScale;

    // Keep the final slow-motion frame cosmetic too. RoundManager may resolve
    // the KO on the following frame, without consuming intermission time early.
    return { dt, timeScale, finishing };
  }
}
