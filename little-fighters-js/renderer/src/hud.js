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
  const clock = el('clock');
  const pips = { p1: el('p1-pips'), p2: el('p2-pips') };
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

    /** Round clock. Turns urgent under ten seconds. */
    setClock(seconds) {
      if (!clock) return;
      clock.textContent = String(Math.max(0, Math.ceil(seconds))).padStart(2, '0');
      clock.classList.toggle('urgent', seconds <= 10);
    },

    /** Filled pips for rounds won, hollow for rounds still to play. */
    setRounds(who, won, toWin) {
      const box = pips[who];
      if (!box) return;
      box.innerHTML = '';
      for (let i = 0; i < toWin; i++) {
        const pip = document.createElement('span');
        pip.className = i < won ? 'pip won' : 'pip';
        box.append(pip);
      }
    },

    /** A short banner that clears itself — used between rounds. */
    flashBanner(text, ms = 2000) {
      banner.textContent = text;
      banner.classList.add('visible');
      clearTimeout(banner._timer);
      banner._timer = setTimeout(() => banner.classList.remove('visible'), ms);
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
