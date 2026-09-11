import { Color } from 'three';
import { CHARACTER_ROSTER } from './config.js';

/** Each entry has { id, name, tagline, tint, scale, stats, special }. */
export const CHARACTERS = CHARACTER_ROSTER;

export function characterById(id) {
  return CHARACTERS.find((character) => character.id === id) ?? CHARACTERS[0];
}

/**
 * Apply an appearance to an already-cloned model and return that model.
 *
 * Materials are owned by this model after the call. A local cache preserves
 * sharing within one fighter, never between fighters or with the asset.
 * Geometry and textures remain shared and untouched. Materials without a
 * colour channel are cloned too, but otherwise left alone.
 *
 * Scale is absolute, not multiplied into the model's previous scale.
 */
export function applyCharacter(model, character) {
  const tint = new Color(character.tint);
  const materials = new Map();

  function cloneMaterial(source) {
    if (!source) return source;
    if (!materials.has(source)) {
      const material = source.clone();
      if (material.color?.isColor) material.color.multiply(tint);
      materials.set(source, material);
    }
    return materials.get(source);
  }

  model.traverse((object) => {
    if (!object.material) return;
    object.material = Array.isArray(object.material)
      ? object.material.map(cloneMaterial)
      : cloneMaterial(object.material);
  });

  model.scale.setScalar(character.scale);
  return model;
}
