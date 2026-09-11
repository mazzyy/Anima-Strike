/**
 * Proves no module under renderer/src is dead weight.
 *
 *   node --test tools/wiring.test.mjs
 *
 * Why this exists: the automation once wrote a complete 10 KB menu module,
 * with its own styles, pause handling and focus trap — and never imported it
 * from main.js. Every test passed, the roadmap item was marked done, and the
 * feature simply was not in the game. A link test cannot catch that, because
 * an orphaned module is not a link error; it is a file nobody loads.
 *
 * So this walks the import graph from the entry point and fails on anything it
 * cannot reach. A new module is only finished when something imports it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = new URL('../renderer/src/', import.meta.url);
const ENTRY = 'main.js';

/** Relative specifiers only — bare ones resolve to the vendored three.js. */
const IMPORT = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"](\.[^'"]+)['"]/g;
const BARE_IMPORT = /(?:^|\n)\s*import\s*['"](\.[^'"]+)['"]/g;

function importsOf(file) {
  const source = readFileSync(fileURLToPath(new URL(file, SRC)), 'utf8');
  const found = new Set();
  for (const re of [IMPORT, BARE_IMPORT]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(source)) !== null) found.add(m[1].replace(/^\.\//, ''));
  }
  return [...found];
}

function reachableFrom(entry) {
  const seen = new Set([entry]);
  const queue = [entry];
  while (queue.length) {
    for (const next of importsOf(queue.pop())) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

test('every renderer module is reachable from main.js', () => {
  const onDisk = readdirSync(fileURLToPath(SRC)).filter((f) => f.endsWith('.js'));
  const reachable = reachableFrom(ENTRY);
  const orphans = onDisk.filter((f) => !reachable.has(f));

  assert.deepEqual(orphans, [],
    `these modules are written but never loaded, so their features are not in the game: ${orphans.join(', ')}`);
});

test('the entry point imports what the game is made of', () => {
  const direct = new Set(importsOf(ENTRY));
  // The spine of the game. If one of these stops being imported, a whole
  // feature has silently left the build.
  for (const required of ['assets.js', 'arena.js', 'hud.js', 'input.js',
                          'fighter.js', 'rounds.js', 'menu.js', 'config.js']) {
    assert.ok(direct.has(required), `main.js no longer imports ${required}`);
  }
});
