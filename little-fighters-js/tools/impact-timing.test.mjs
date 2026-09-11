import test from 'node:test';
import assert from 'node:assert/strict';
import { ImpactTiming } from '../renderer/src/impact-timing.js';
import { IMPACT } from '../renderer/src/config.js';

function near(actual, expected) {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `Expected ${actual} to be approximately ${expected}`,
  );
}

test('ordinary hits leave simulation at normal speed', () => {
  const timing = new ImpactTiming();
  timing.notifyHit({ heavy: false, lethal: false });

  const frame = timing.advance(1 / 60);
  near(frame.dt, 1 / 60);
  assert.equal(frame.timeScale, 1);
  assert.equal(frame.finishing, false);
});

test('heavy hits freeze for the configured real-time duration', () => {
  const timing = new ImpactTiming();
  timing.notifyHit({ heavy: true });

  const frozen = timing.advance(IMPACT.hitStopSeconds / 2);
  assert.equal(frozen.dt, 0);
  assert.equal(frozen.timeScale, 0);

  const resumed = timing.advance(IMPACT.hitStopSeconds / 2 + 0.01);
  near(resumed.dt, 0.01);
  assert.equal(resumed.finishing, false);
  near(timing.hitStopLeft, 0);
});

test('overlapping heavy hits refresh rather than stack hit-stop', () => {
  const timing = new ImpactTiming();
  timing.notifyHit({ heavy: true });
  timing.advance(IMPACT.hitStopSeconds / 2);
  timing.notifyHit({ heavy: true });

  near(timing.hitStopLeft, IMPACT.hitStopSeconds);
  const frame = timing.advance(IMPACT.hitStopSeconds + 0.01);
  near(frame.dt, 0.01);
});

test('any lethal hit starts slow motion without requiring a heavy hit', () => {
  const timing = new ImpactTiming();
  timing.notifyHit({ lethal: true });

  const frame = timing.advance(0.02);
  assert.equal(frame.finishing, true);
  assert.equal(frame.timeScale, IMPACT.koTimeScale);
  near(frame.dt, 0.02 * IMPACT.koTimeScale);
  near(timing.finishLeft, IMPACT.koSeconds - 0.02);
});

test('a heavy KO pauses first, then gets the full real-time finish', () => {
  const timing = new ImpactTiming();
  timing.notifyHit({ heavy: true, lethal: true });

  const stopped = timing.advance(IMPACT.hitStopSeconds);
  assert.equal(stopped.dt, 0);
  assert.equal(stopped.finishing, true);
  near(timing.finishLeft, IMPACT.koSeconds);

  let simulated = 0;
  const steps = 100;
  for (let i = 0; i < steps; i++) {
    const frame = timing.advance(IMPACT.koSeconds / steps);
    assert.equal(frame.finishing, true);
    simulated += frame.dt;
  }
  near(simulated, IMPACT.koSeconds * IMPACT.koTimeScale);

  // Allow for floating-point residue at the exact duration boundary.
  timing.advance(1e-9);
  const resumed = timing.advance(0.01);
  assert.equal(resumed.finishing, false);
  assert.equal(resumed.timeScale, 1);
  near(resumed.dt, 0.01);
});

test('the last finish frame still defers round resolution', () => {
  const timing = new ImpactTiming();
  timing.notifyHit({ lethal: true });

  const finalFrame = timing.advance(IMPACT.koSeconds + 0.1);
  assert.equal(finalFrame.finishing, true);
  assert.equal(timing.finishing, false);
  near(finalFrame.dt, IMPACT.maxFrameSeconds * IMPACT.koTimeScale);

  assert.equal(timing.advance(0.01).finishing, false);
});

test('finish cannot retrigger until a round reset', () => {
  const timing = new ImpactTiming();
  timing.notifyHit({ lethal: true });
  timing.advance(IMPACT.koSeconds + 0.1);
  timing.notifyHit({ heavy: true, lethal: true });

  assert.equal(timing.finishing, false);
  assert.equal(timing.hitStopLeft, 0);

  timing.reset();
  timing.notifyHit({ heavy: true, lethal: true });
  assert.equal(timing.finishing, true);
  near(timing.hitStopLeft, IMPACT.hitStopSeconds);
});

test('reset clears all timing and suspended frames cannot teleport simulation', () => {
  const timing = new ImpactTiming();
  timing.notifyHit({ heavy: true, lethal: true });
  timing.reset();

  assert.equal(timing.finishing, false);
  assert.equal(timing.finishLeft, 0);
  assert.equal(timing.hitStopLeft, 0);
  near(timing.advance(30).dt, IMPACT.maxFrameSeconds);

  timing.notifyHit({ heavy: true, lethal: true });
  const resumed = timing.advance(30);
  near(resumed.dt, IMPACT.maxFrameSeconds * IMPACT.koTimeScale);
  assert.equal(timing.finishing, false);
  assert.equal(timing.hitStopLeft, 0);
});
