/**
 * Proves every renderer module still parses and links against the vendored
 * three.js — one test per module, deliberately.
 *
 *   node --test tools/module-graph.test.mjs
 *
 * Why this exists: a bad named import, or a syntax error, is a LINK-time
 * failure. The module graph never instantiates, so not one line of main.js
 * runs, boot() never exists, and boot().catch() can never report it. The app
 * sits on "loading…" while every combat test passes, because those import
 * fighter.js directly and never touch the renderer's entry point.
 *
 * Why ONE TEST PER MODULE, and not a loop inside a single test: the build gate
 * compares which test NAMES fail before and after an item, and reverts an item
 * that breaks something which was passing. A single "every module links" test
 * that is already failing for one reason absorbs every later reason — the name
 * is already in the failing set, the counts do not move, and the gate sees
 * nothing. That is exactly how a `-x ** 2` syntax error in sky.js reached
 * disk: SyntaxError, unary operator before an exponentiation, and the suite
 * reported the identical 189/164/25 either way.
 *
 * Granular tests are not a style preference here. They are what makes the
 * difference between "something is broken" and "THIS became broken".
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

register('./vendor-resolve.mjs', import.meta.url);

const SRC = new URL('../renderer/src/', import.meta.url);
const INDEX = new URL('../renderer/index.html', import.meta.url);
const MODULES = readdirSync(fileURLToPath(SRC)).filter((f) => f.endsWith('.js')).sort();

/**
 * main.js reads the DOM at module scope, so linking alone is not enough to
 * import it — evaluation needs something for `document` to be. These stubs are
 * deliberately dumb: this file asserts the graph loads, not that the game
 * behaves. Behaviour is covered by the other suites.
 */
function installDomStubs() {
  if (globalThis.document) return;
  const node = () => ({
    textContent: '', style: {}, dataset: {}, width: 0, height: 0, hidden: false,
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    append() {}, appendChild() {}, remove() {}, setAttribute() {},
    addEventListener() {}, removeEventListener() {}, focus() {}, blur() {},
    querySelector: () => node(), querySelectorAll: () => [],
    getContext: () => null, set innerHTML(_v) {}, get innerHTML() { return ''; },
  });
  globalThis.document = {
    getElementById: () => node(), createElement: () => node(),
    createTextNode: () => node(), body: node(), head: node(),
    documentElement: node(), addEventListener() {},
    querySelector: () => node(), querySelectorAll: () => [],
  };
  globalThis.window = {
    addEventListener() {}, removeEventListener() {},
    innerWidth: 1280, innerHeight: 760, devicePixelRatio: 1,
  };
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.performance ??= { now: () => 0 };
}

test('the importmap still points at the vendored three.js', () => {
  const html = readFileSync(fileURLToPath(INDEX), 'utf8');
  const block = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  assert.ok(block, 'index.html must carry an importmap');

  const { imports } = JSON.parse(block[1]);
  assert.equal(imports.three, './vendor/three/build/three.module.js',
    'vendor-resolve.mjs mirrors this path — change both together');
  assert.equal(imports['three/addons/'], './vendor/three/examples/jsm/',
    'vendor-resolve.mjs mirrors this path — change both together');
});

test('the renderer source tree is where it should be', () => {
  assert.ok(MODULES.length >= 10,
    `found ${MODULES.length} modules under renderer/src — expected the whole tree`);
  assert.ok(MODULES.includes('main.js'), 'main.js is missing');
});

// One test per module. A newly broken module produces a NEW failing name,
// which is what the build gate needs in order to notice it.
for (const file of MODULES) {
  test(`${file} parses and links`, async () => {
    installDomStubs();
    await assert.doesNotReject(
      import(new URL(file, SRC).href),
      `${file} failed to link — it would take the whole app down with it`,
    );
  });
}

test('the whole graph links from main.js', async () => {
  installDomStubs();
  await assert.doesNotReject(
    import(new URL('main.js', SRC).href),
    'a module in the graph failed to link — the app would hang on "loading…"',
  );
});
