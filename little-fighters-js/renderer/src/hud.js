/**
 * Health bars, defender combo counters, the KO banner, and a small readout
 * of what the Azure brain is doing and what it has spent.
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

  // Insert beside each health track, not inside the shrinking fill.
  // Keep this self-contained so the existing HTML/CSS need no changes.
  const combos = {};
  for (const who of ['p1', 'p2']) {
    const track = bars[who]?.parentElement;
    if (!track) continue;

    let counter = el(`${who}-combo`);
    if (!counter) {
      counter = root.ownerDocument.createElement('div');
      counter.id = `${who}-combo`;
      counter.className = 'combo-counter';
      counter.title = 'Consecutive hits received';
      counter.hidden = true;
      Object.assign(counter.style, {
        color: '#ffd94d',
        fontSize: '12px',
        fontWeight: '700',
        lineHeight: '1.4',
        marginTop: '4px',
        textAlign: who === 'p2' ? 'right' : 'left',
        pointerEvents: 'none',
      });
      track.after(counter);
    }
    combos[who] = counter;
  }

  return {
    setHealth(who, fraction) {
      const bar = bars[who];
      if (!bar) return;
      const pct = Math.max(0, Math.min(1, fraction)) * 100;
      bar.style.width = `${pct}%`;
      bar.classList.toggle('low', pct <= 30);
    },

    /** Counts belong to the fighter receiving the hits, not the attacker. */
    setCombo(who, count) {
      const counter = combos[who];
      if (!counter) return;
      const visible = count >= 2;
      const text = visible ? `${count} HIT COMBO` : '';
      if (counter.textContent !== text) counter.textContent = text;
      counter.hidden = !visible;
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
