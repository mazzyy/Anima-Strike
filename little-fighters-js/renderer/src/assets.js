/**
 * Loads the character and its animation clips.
 *
 * The clips were exported from Mixamo "Without Skin", so each .glb carries a
 * skeleton and one animation but no mesh. Every clip's channels target the
 * same `mixamorig:` bone names the character rig uses, which is why they can
 * be played directly on the character with no retargeting step.
 *
 * A missing clip is skipped, never fatal — exactly like the Godot loader did.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// The vendored SkeletonUtils exports bare functions (clone/retarget/
// retargetClip), not a SkeletonUtils namespace object. Importing the old
// namespace name is a link-time error that kills the whole module graph.
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { CLIPS } from './config.js';

const loader = new GLTFLoader();

function load(url) {
  return new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
}

export async function loadGameAssets(onProgress = () => {}) {
  onProgress('character');
  const characterGltf = await load('./assets/character.glb');

  const clips = new Map();
  const missing = [];

  for (const name of CLIPS) {
    onProgress(name);
    try {
      const gltf = await load(`./assets/${name}.glb`);
      const clip = gltf.animations?.[0];
      if (!clip) { missing.push(name); continue; }
      clip.name = name;
      clips.set(name, clip);
    } catch {
      missing.push(name);
    }
  }

  if (missing.length) {
    console.warn('[assets] clips not found, those states will not animate:', missing.join(', '));
  }
  console.info(`[assets] ${clips.size}/${CLIPS.length} clips loaded`);

  return {
    /** A fresh, independently-posable copy of the knight. */
    createCharacter() {
      const root = cloneSkinned(characterGltf.scene);
      root.traverse((obj) => {
        if (obj.isMesh) {
          obj.castShadow = true;
          obj.receiveShadow = true;
          obj.frustumCulled = false;   // skinned bounds go stale mid-animation
        }
      });
      return root;
    },
    clips,
    missing,
  };
}

/**
 * Wires an AnimationMixer up with every clip, returning a small player that
 * cross-fades between them and reports clip lengths (the fighter uses those
 * to time its attack windows).
 */
export function createAnimator(root, clips) {
  const mixer = new THREE.AnimationMixer(root);
  const actions = new Map();

  for (const [name, clip] of clips) {
    const action = mixer.clipAction(clip);
    actions.set(name, action);
  }

  let current = null;

  return {
    mixer,
    has: (name) => actions.has(name),
    length: (name) => clips.get(name)?.duration ?? 0,

    play(name, {
      loop = false, fade = 0.12, speed = 1, restart = true, startAt = 0,
    } = {}) {
      const action = actions.get(name);
      if (!action) return false;                 // clip missing — stay silent
      if (action === current && !restart) return true;

      action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      action.clampWhenFinished = !loop;
      action.timeScale = speed;
      action.reset();

      // The drop kick skips its wind-up, because its hit window is timed from
      // after it. This was being passed in and silently dropped, so the clip
      // played from the start while the swing length assumed it had not — the
      // animation and the hitbox disagreed for the whole move.
      if (startAt > 0) {
        const clip = clips.get(name);
        action.time = Math.min(startAt, Math.max(0, (clip?.duration ?? 0) - 1e-3));
      }

      if (current && current !== action) {
        current.crossFadeTo(action, fade, false);
        action.play();
      } else {
        action.fadeIn(fade).play();
      }
      current = action;
      return true;
    },

    currentName() {
      for (const [name, action] of actions) if (action === current) return name;
      return null;
    },

    update(dt) { mixer.update(dt); },
  };
}
