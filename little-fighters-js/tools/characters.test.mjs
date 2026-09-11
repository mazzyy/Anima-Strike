import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import {
  CHARACTERS, characterById, applyCharacter,
} from '../renderer/src/characters.js';
import {
  BODY, COMBAT, FIGHTER_STATS, SCALE, CHARACTER_DEFAULTS,
} from '../renderer/src/config.js';
import { Fighter, State } from '../renderer/src/fighter.js';

test('roster has unique ids, complete entries, and sane six-field stats', () => {
  assert.ok(CHARACTERS.length >= 6);
  assert.equal(new Set(CHARACTERS.map((character) => character.id)).size, CHARACTERS.length);

  const bounds = {
    maxHealth: [50, 200],
    walkSpeed: [2, 7],
    runSpeed: [3, 11],
    jumpSpeed: [4, 10],
    damageScale: [0.5, 2],
    defenceScale: [0.5, 2],
  };

  for (const character of CHARACTERS) {
    assert.deepEqual(
      Object.keys(character).sort(),
      ['id', 'name', 'tagline', 'tint', 'scale', 'stats', 'special'].sort(),
    );
    assert.match(character.id, /^[a-z][a-z0-9-]*$/);
    for (const key of ['name', 'tagline', 'special']) {
      assert.equal(typeof character[key], 'string');
      assert.ok(character[key].trim().length > 0);
    }
    assert.ok(Number.isInteger(character.tint));
    assert.ok(character.tint >= 0 && character.tint <= 0xffffff);
    assert.ok(Number.isFinite(character.scale));
    assert.ok(character.scale >= 0.8 && character.scale <= 2);
    assert.deepEqual(Object.keys(character.stats).sort(), Object.keys(FIGHTER_STATS).sort());

    for (const [key, [min, max]] of Object.entries(bounds)) {
      const value = character.stats[key];
      assert.ok(Number.isFinite(value), `${character.id}.${key} is finite`);
      assert.ok(value >= min && value <= max, `${character.id}.${key} is in bounds`);
    }
    assert.ok(character.stats.runSpeed >= character.stats.walkSpeed);
  }

  for (const id of Object.values(CHARACTER_DEFAULTS)) {
    assert.ok(CHARACTERS.some((character) => character.id === id));
  }
});

test('lookup returns roster entries and falls back to the first fighter', () => {
  for (const character of CHARACTERS) {
    assert.equal(characterById(character.id), character);
  }
  for (const id of [undefined, null, '', 'missing-fighter', '__proto__']) {
    assert.equal(characterById(id), CHARACTERS[0]);
  }
});

test('archetypes have substantive tradeoffs, not just different names', () => {
  const balanced = characterById('axel');
  const heavy = characterById('rook');
  const fast = characterById('zip');
  const reach = characterById('pike');
  const wall = characterById('bastion');
  const cannon = characterById('ember');

  assert.deepEqual(balanced.stats, FIGHTER_STATS);
  assert.equal(
    new Set(CHARACTERS.map((character) => JSON.stringify(character.stats))).size,
    CHARACTERS.length,
  );

  assert.ok(heavy.stats.walkSpeed < balanced.stats.walkSpeed);
  assert.ok(heavy.stats.runSpeed < balanced.stats.runSpeed);
  assert.ok(heavy.stats.maxHealth > balanced.stats.maxHealth);
  assert.ok(heavy.stats.damageScale > balanced.stats.damageScale);

  assert.ok(fast.stats.walkSpeed > balanced.stats.walkSpeed);
  assert.ok(fast.stats.runSpeed > balanced.stats.runSpeed);
  assert.ok(fast.stats.jumpSpeed > balanced.stats.jumpSpeed);
  assert.ok(fast.stats.maxHealth < balanced.stats.maxHealth);
  assert.ok(fast.stats.defenceScale < balanced.stats.defenceScale);

  assert.ok(reach.scale > Math.max(...CHARACTERS.filter((c) => c !== reach).map((c) => c.scale)));
  assert.ok(reach.stats.damageScale < balanced.stats.damageScale);
  assert.ok(reach.stats.maxHealth < balanced.stats.maxHealth);

  assert.ok(wall.stats.maxHealth > heavy.stats.maxHealth);
  assert.ok(wall.stats.defenceScale > heavy.stats.defenceScale);
  assert.ok(wall.stats.damageScale < balanced.stats.damageScale);

  assert.ok(cannon.stats.damageScale > heavy.stats.damageScale);
  assert.ok(cannon.stats.maxHealth < fast.stats.maxHealth);
  assert.ok(cannon.stats.defenceScale < fast.stats.defenceScale);
});

function appearanceFixture() {
  const root = new THREE.Group();
  const nested = new THREE.Group();
  const geometry = new THREE.BoxGeometry();
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({
    color: 0xc0b0a0,
    map: texture,
    roughness: 0.65,
    metalness: 0.25,
  });
  const noColor = new THREE.ShaderMaterial();
  const single = new THREE.Mesh(geometry, material);
  single.name = 'single';
  const multi = new THREE.Mesh(geometry, [material, noColor]);
  multi.name = 'multi';
  nested.add(single, multi);
  root.add(nested);
  root.scale.set(2, 3, 4);
  return { root, geometry, texture, material, noColor };
}

test('appearance clones single, array, and colourless materials without touching the source', () => {
  const { root, geometry, texture, material, noColor } = appearanceFixture();
  const before = JSON.stringify(material.toJSON());
  const sourceArray = root.getObjectByName('multi').material;
  const model = cloneSkinned(root);
  const character = characterById('axel');

  assert.equal(model.getObjectByName('single').material, material);
  assert.equal(applyCharacter(model, character), model);

  const single = model.getObjectByName('single');
  const multi = model.getObjectByName('multi');
  assert.notEqual(single.material, material);
  assert.notEqual(single.material.color, material.color);
  assert.notEqual(multi.material, sourceArray);
  assert.equal(multi.material[0], single.material);
  assert.notEqual(multi.material[1], noColor);
  assert.equal(multi.material[1].isShaderMaterial, true);

  assert.ok(single.material.color.equals(
    material.color.clone().multiply(new THREE.Color(character.tint)),
  ));
  assert.equal(single.material.roughness, material.roughness);
  assert.equal(single.material.metalness, material.metalness);
  assert.equal(single.material.map, texture);
  assert.equal(single.geometry, geometry);

  assert.equal(root.getObjectByName('single').material, material);
  assert.equal(root.getObjectByName('multi').material, sourceArray);
  assert.equal(JSON.stringify(material.toJSON()), before);
  assert.deepEqual(root.scale.toArray(), [2, 3, 4]);
  assert.deepEqual(model.scale.toArray(), Array(3).fill(character.scale));
});

test('two characters cloned from one asset have independent, different colours', () => {
  const { root, material } = appearanceFixture();
  const sourceColor = material.color.clone();
  const first = applyCharacter(cloneSkinned(root), characterById('axel'));
  const second = applyCharacter(cloneSkinned(root), characterById('ember'));
  const firstMaterial = first.getObjectByName('single').material;
  const secondMaterial = second.getObjectByName('single').material;

  assert.notEqual(firstMaterial, secondMaterial);
  assert.ok(!firstMaterial.color.equals(secondMaterial.color));
  assert.ok(material.color.equals(sourceColor));

  const secondColor = secondMaterial.color.clone();
  firstMaterial.color.set(0);
  assert.ok(secondMaterial.color.equals(secondColor));
  assert.ok(material.color.equals(sourceColor));

  // Selecting the same character on both sides must also isolate materials.
  const third = applyCharacter(cloneSkinned(root), characterById('ember'));
  assert.notEqual(third.getObjectByName('single').material, secondMaterial);
});

test('appearance handles an empty model and sets absolute scale', () => {
  const model = new THREE.Group();
  model.scale.setScalar(10);
  applyCharacter(model, characterById('pike'));
  assert.deepEqual(model.scale.toArray(), Array(3).fill(characterById('pike').scale));
  applyCharacter(model, characterById('zip'));
  assert.deepEqual(model.scale.toArray(), Array(3).fill(characterById('zip').scale));
});

function missingAnimator() {
  return {
    has: () => false,
    length: () => 0,
    play: () => false,
    update() {},
  };
}

function damageAtDistance(character, distance, reachScale) {
  let attackPending = true;
  const attacker = new Fighter({
    model: applyCharacter(new THREE.Group(), character),
    animator: missingAnimator(),
    controller: {
      move: () => ({ x: 0, y: 0 }),
      held: () => false,
      pressed(action) {
        if (action !== 'light' || !attackPending) return false;
        attackPending = false;
        return true;
      },
    },
    spawn: { x: -distance / 2, y: 0, z: 0 },
    stats: character.stats,
    reachScale,
  });
  const defender = new Fighter({
    model: new THREE.Group(),
    animator: missingAnimator(),
    spawn: { x: distance / 2, y: 0, z: 0 },
  });
  attacker.onFloor = true;
  defender.onFloor = true;
  const world = { fighters: [attacker, defender] };

  attacker.update(0.001, world);
  assert.equal(attacker.state, State.LIGHT_ATTACK);
  const activeMidpoint = attacker.swingLength
    * (COMBAT.hitWindowStart + COMBAT.hitWindowEnd) / 2;
  attacker.update(activeMidpoint, world);
  const damage = defender.health.max - defender.health.current;

  // A second sample in the same active window must not deal damage again.
  attacker.update(0.001, world);
  assert.equal(defender.health.max - defender.health.current, damage);
  return damage;
}

test('Pike reaches beyond a normal fighter, including with missing clips', () => {
  const balanced = characterById('axel');
  const pike = characterById('pike');
  const baseForward = BODY.hitbox.offsetZ + BODY.hitbox.halfDepth;
  const baseRange = baseForward + BODY.hurtRadius;
  const pikeRange = baseForward * (pike.scale / SCALE) + BODY.hurtRadius;
  const gap = (baseRange + pikeRange) / 2;

  assert.equal(damageAtDistance(balanced, gap, balanced.scale / SCALE), 0);
  assert.ok(damageAtDistance(pike, gap, pike.scale / SCALE) > 0);

  // Legacy callers retain normal reach regardless of model scale.
  assert.equal(damageAtDistance(pike, gap), 0);
  assert.ok(damageAtDistance(balanced, baseRange - 0.05) > 0);
  assert.equal(damageAtDistance(pike, pikeRange + 0.05, pike.scale / SCALE), 0);
});

test('Fighter copies roster stats and initializes roster health', () => {
  for (const character of CHARACTERS) {
    const fighter = new Fighter({
      model: new THREE.Group(),
      animator: missingAnimator(),
      spawn: { x: 0, y: 0, z: 0 },
      stats: character.stats,
    });
    assert.deepEqual(fighter.stats, character.stats);
    assert.notEqual(fighter.stats, character.stats);
    assert.equal(fighter.health.max, character.stats.maxHealth);
    assert.equal(fighter.health.current, character.stats.maxHealth);
    const damageScale = character.stats.damageScale;
    fighter.stats.damageScale = 0;
    assert.equal(character.stats.damageScale, damageScale);
  }
});
