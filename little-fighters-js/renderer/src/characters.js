import { Color } from 'three';
import { CHARACTER_ROSTER } from './config.js';

export const CHARACTERS = CHARACTER_ROSTER;

export function characterById(id) {
  return CHARACTERS.find((character) => character.id === id) ?? CHARACTERS[0];
}

/**
 * Apply appearance to an already-cloned model. The tag also connects existing
 * match creation to Fighter's move list without depending on display names.
 * Materials are owned by this model; geometry and textures remain shared.
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

  model.userData ??= {};
  model.userData.lfCharacter = character.id;
  model.scale.setScalar(character.scale);
  return model;
}
