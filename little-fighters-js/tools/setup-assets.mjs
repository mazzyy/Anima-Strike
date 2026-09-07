/**
 * Copies the game's runtime dependencies into renderer/ so the app is
 * self-contained and needs no bundler:
 *
 *   - three.js build + the jsm addons we use  -> renderer/vendor/three/
 *   - the character and animation .glb files  -> renderer/assets/
 *
 * The .glb files live in the original Godot project one level up. They are
 * plain glTF, so they load in three.js unchanged — that is the whole reason
 * the port was worth doing rather than starting from scratch.
 *
 * Run automatically on `npm install`, or by hand with `npm run assets`.
 */

import { cp, mkdir, readdir, stat, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
const GODOT = path.resolve(APP, '..');          // the original project root
const VENDOR = path.join(APP, 'renderer', 'vendor', 'three');
const ASSETS = path.join(APP, 'renderer', 'assets');

// clip name -> source file, relative to the Godot project root.
// This mirrors external_animations in the old Fighter.gd.
const CLIPS = {
  idle: 'animations/breathing.glb',
  walk: 'animations/walking.glb',
  run: 'animations/Run.glb',
  jump: 'animations/jump.glb',
  punch: 'animations/punch.glb',
  kick: 'animations/mmakick.glb',
  dropkick: 'animations/dropkick.glb',
  hit: 'animations/hit.glb',
  block: 'animations/block.glb',
  dash: 'animations/dash.glb',
  knockdown: 'animations/knockdown.glb',
  getup: 'animations/getup.glb',
  death: 'animations/Death.glb',
};

const CHARACTER = 'charactos /Untitled.glb';

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function copyThree() {
  const root = path.join(APP, 'node_modules', 'three');
  if (!existsSync(root)) {
    console.error('  ! three is not installed yet — run `npm install` first.');
    return false;
  }
  await mkdir(VENDOR, { recursive: true });
  await cp(path.join(root, 'build'), path.join(VENDOR, 'build'), { recursive: true });
  await cp(path.join(root, 'examples', 'jsm'), path.join(VENDOR, 'examples', 'jsm'), {
    recursive: true,
  });
  console.log('  three.js  -> renderer/vendor/three/');
  return true;
}

async function copyAssets() {
  await mkdir(ASSETS, { recursive: true });

  const charSrc = path.join(GODOT, CHARACTER);
  if (await exists(charSrc)) {
    await cp(charSrc, path.join(ASSETS, 'character.glb'));
    const kb = (await stat(charSrc)).size / 1024;
    console.log(`  character -> renderer/assets/character.glb  (${kb.toFixed(0)} KB)`);
  } else {
    console.error(`  ! character not found at ${charSrc}`);
  }

  let ok = 0;
  const missing = [];
  for (const [clip, rel] of Object.entries(CLIPS)) {
    const src = path.join(GODOT, rel);
    if (await exists(src)) {
      await cp(src, path.join(ASSETS, `${clip}.glb`));
      ok++;
    } else {
      missing.push(`${clip} (${rel})`);
    }
  }
  console.log(`  clips     -> renderer/assets/  (${ok}/${Object.keys(CLIPS).length})`);
  if (missing.length) {
    console.log('  ! missing, those states will simply not animate:');
    for (const m of missing) console.log(`      ${m}`);
  }
}

console.log('Setting up Little Fighters assets');
await copyThree();
await copyAssets();
console.log('Done. `npm start` to play.');
