/**
 * Module resolver hook that mirrors renderer/index.html's importmap.
 *
 * The browser resolves `three` and `three/addons/*` through the importmap to
 * renderer/vendor/. Node resolves them through node_modules, which holds a
 * *different* copy. Testing against node_modules therefore proves nothing
 * about what actually ships — the vendored build is what the app loads.
 *
 * Keep these two mappings in step with the importmap in index.html.
 */

const VENDOR = new URL('../renderer/vendor/three/', import.meta.url);
const ADDONS = 'three/addons/';

export function resolve(specifier, context, next) {
  if (specifier === 'three') {
    return { url: new URL('build/three.module.js', VENDOR).href, shortCircuit: true };
  }
  if (specifier.startsWith(ADDONS)) {
    const rest = specifier.slice(ADDONS.length);
    return { url: new URL(`examples/jsm/${rest}`, VENDOR).href, shortCircuit: true };
  }
  return next(specifier, context);
}
