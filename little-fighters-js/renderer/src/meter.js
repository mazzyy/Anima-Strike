import { METER } from './config.js';

function positive(value) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** Meter is a scalar number of points, including all banked stocks. */
export function clampMeter(value) {
  return Math.min(positive(value), METER.stockSize * METER.maxStocks);
}

/** Damage means actual health removed, after defence, block and overkill. */
export function fillMeter(value, damage, kind) {
  const rate = kind === 'dealt'
    ? METER.damageDealtRate
    : kind === 'taken' ? METER.damageTakenRate : 0;
  return clampMeter(clampMeter(value) + positive(damage) * rate);
}

export function meterStocks(value) {
  return Math.floor(clampMeter(value) / METER.stockSize);
}

/** Fill of a particular stock track, including already-banked stocks. */
export function stockFraction(value, index = 0) {
  return Math.max(0, Math.min(1, clampMeter(value) / METER.stockSize - index));
}

/** Pure transaction: failure leaves the supplied balance untouched. */
export function spendStock(value) {
  if (meterStocks(value) < 1) return { activated: false, value };
  return { activated: true, value: clampMeter(value) - METER.stockSize };
}
