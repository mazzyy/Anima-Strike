/**
 * Proves every renderer module still links against the vendored three.js.
 *
 *   node --test tools/module-graph.test.mjs
 *
 * Why this exists: a bad named import — `import { SkeletonUtils }` from a
 * build that exports bare `clone`/`retarget` functions — is a LINK-time
 * error. The module graph never instantiates, so not one line of main.js
 * runs, boot() never exists, and boot().catch() can never report it. The app
 * sits on "loading…" forever while every other test passes, because the
 * combat tests import fighter.js and rounds.js directly and never touch
 * assets.js, which needs a browser.
 *
 * This test closes that hole without a browser: Node's own linker walks the
 * real graph from main.js down through the vendored three.js and fails on any
 * missing module or missing export. It is the cheapest possible check that
 * the app can still start.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

register('./vendor-resolve.mjs', import.meta.url);

const SRC = new URL('../renderer/src/', import.meta.url);
const INDEX = new URL('../renderer/index.html', import.meta.url);

/**
 * main.js reads the DOM at module scope, so linking alone is not enough to
 * import it — evaluation needs something for `document` to be. These stubs
 * are deliberately dumb: this test asserts the graph loads, not that the game
 * behaves. Behaviour is covered by the other suites.
 */
function installDomStubs() {
  if (globalThis.document) return;
  const node = () => ({
    textContent: '', style: {}, dataset: {}, width: 0, height: 0,
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

test('the whole module graph links from main.js', async () => {
  installDomStubs();
  await assert.doesNotReject(
    import(new URL('main.js', SRC).href),
    'a module in the graph failed to link — the app would hang on "loading…"',
  );
});

test('every module under renderer/src links on its own', async () => {
  installDomStubs();
  const files = readdirSync(fileURLToPath(SRC)).filter((f) => f.endsWith('.js'));
  assert.ok(files.length >= 10, 'expected the renderer source tree, found nothing');

  for (const file of files) {
    await assert.doesNotReject(
      import(new URL(file, SRC).href),
      `${file} failed to link — it would take the whole app down with it`,
    );
  }
});
