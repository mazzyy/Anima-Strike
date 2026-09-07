/**
 * Health bars, the KO banner, and a small readout of what the Azure brain is
 * doing and what it has spent. That last part matters: the opponent calls the
 * model on a timer, so the cost should be visible while you play rather than
 * discovered afterwards.
 */

export function createHUD(root) {
  const el = (id) => root.querySelector(`#${id}`);

  const bars = {
    p1: el('p1-fill'),
    p2: el('p2-fill'),
  };
  const banner = el('banner');
  const planEl = el('ai-plan');
  const usageEl = el('ai-usage');
  const tauntEl = el('ai-taunt');

  return {
    setHealth(who, fraction) {
      const bar = bars[who];
      if (!bar) return;
      const pct = Math.max(0, Math.min(1, fraction)) * 100;
      bar.style.width = `${pct}%`;
      bar.classList.toggle('low', pct <= 30);
    },

    showBanner(text) {
      banner.textContent = text;
      banner.classList.add('visible');
    },

    hideBanner() {
      banner.classList.remove('visible');
    },

    setPlan(ai) {
      planEl.textContent = `${ai.stance} · ${ai.preferred} · aggression ${ai.aggression.toFixed(2)}`;
      if (ai.lastTaunt) {
        tauntEl.textContent = `“${ai.lastTaunt}”`;
        tauntEl.classList.add('visible');
        clearTimeout(tauntEl._timer);
        tauntEl._timer = setTimeout(() => tauntEl.classList.remove('visible'), 3200);
      }
    },

    setBrainStatus(text) {
      planEl.textContent = text;
    },

    setUsage(totals) {
      if (!totals || !totals.calls) {
        usageEl.textContent = 'no calls yet';
        return;
      }
      const cost = totals.priced
        ? `$${totals.cost_usd.toFixed(4)}`
        : 'unpriced';
      usageEl.textContent =
        `${totals.calls} calls · ${totals.total_tokens.toLocaleString()} tokens · ${cost}`;
    },
  };
}
