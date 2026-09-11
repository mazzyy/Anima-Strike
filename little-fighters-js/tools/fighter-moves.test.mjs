import test from 'node:test';
import assert from 'node:assert/strict';
import { Object3D, Vector3 } from 'three';
import { Fighter, State } from '../renderer/src/fighter.js';
import { MOVES } from '../renderer/src/moves.js';
import { MOVE_RULES, COMBAT, ARENA } from '../renderer/src/config.js';
import { applyCharacter, characterById } from '../renderer/src/characters.js';

function make(character = null, x = 0) {
  const input = { direction: { x: 0, y: 0 }, edges: new Set(), held: new Set() };
  const clips = [];
  const fighter = new Fighter({
    character,
    model: new Object3D(),
    animator: {
      has: () => false,
      length: () => { throw new Error('missing clip must not be queried'); },
      play: (clip, options) => { clips.push([clip, options]); return false; },
      update() {},
    },
    controller: {
      move: () => input.direction,
      pressed: (action) => input.edges.has(action),
      held: (action) => input.held.has(action),
    },
    spawn: { x, y: ARENA.floorY, z: 0 },
  });
  fighter.onFloor = true;
  return { fighter, input, clips };
}

function tick(actor, seconds, world = { fighters: [actor.fighter] }) {
  actor.fighter.update(seconds, world);
  actor.input.edges.clear();
}

function press(actor, action, world) {
  actor.input.edges.add(action);
  tick(actor, .001, world);
}

/** Isolates execution tests from recognition tests while using the public history API. */
function command(actor, input, world) {
  const tokens = input.split(',');
  const now = actor.fighter.inputClock;
  actor.fighter.inputHistory = tokens.map((token, index) => ({
    input: token, time: now - (tokens.length - 1 - index) * .03,
  }));
  tick(actor, .001, world);
}

function advance(actor, seconds, world) {
  while (seconds > 0) {
    const dt = Math.min(.01, seconds);
    tick(actor, dt, world);
    seconds -= dt;
  }
}

test('appearance tag activates the catalogue; untagged legacy punches stay legacy', () => {
  const actor = make();
  applyCharacter(actor.fighter.model, characterById('rook'));
  const tagged = new Fighter({
    model: actor.fighter.model,
    animator: actor.fighter.animator,
    controller: actor.fighter.controller,
    spawn: { x: 0, y: 0, z: 0 },
  });
  assert.equal(tagged.character, 'rook');
  press(actor, 'light');
  assert.equal(actor.fighter.state, State.LIGHT_ATTACK);
  assert.equal(actor.fighter.currentMove, null);
});

test('all characters execute their authored neutral attack without any clips', () => {
  for (const character of Object.keys(MOVES)) {
    const actor = make(character);
    press(actor, 'light');
    const move = MOVES[character][0];
    assert.equal(actor.fighter.currentMove, move);
    assert.equal(actor.fighter.attackDamage, move.damage);
    assert.equal(actor.fighter.swingLength, move.startup + move.active + move.recovery);
    assert.equal(actor.clips.at(-1)[0], move.clip);
    assert.equal(actor.clips.at(-1)[1].speed, move.clipSpeed);
    advance(actor, actor.fighter.swingLength + .02);
    assert.equal(actor.fighter.currentMove, null);
  }
});

test('three-hit jab string cancels only in recovery and consumes each button once', () => {
  const actor = make('axel');
  press(actor, 'light');
  press(actor, 'light');
  assert.equal(actor.fighter.currentMove.id, 'jab');
  advance(actor, .14);
  assert.equal(actor.fighter.currentMove.id, 'cross');
  advance(actor, .14);
  assert.equal(actor.fighter.currentMove.id, 'cross');
  press(actor, 'light');
  assert.equal(actor.fighter.currentMove.id, 'hook');
  advance(actor, .4);
  assert.equal(actor.fighter.currentMove, null);
});

test('expired early input cannot cancel a slow swing', () => {
  const actor = make('rook');
  press(actor, 'heavy');
  press(actor, 'heavy');
  advance(actor, .55);
  assert.equal(actor.fighter.currentMove.id, 'hammer');
});

test('direction edges work through the unchanged controller, including double back', () => {
  const actor = make('zip');
  actor.input.direction = { x: -1, y: 0 };
  tick(actor, .02);
  actor.input.direction = { x: 0, y: 0 };
  tick(actor, .02);
  actor.input.direction = { x: -1, y: 0 };
  tick(actor, .02);
  press(actor, 'dash');
  assert.equal(actor.fighter.currentMove.id, 'teleport');
  const before = actor.fighter.position.x;
  actor.input.direction = { x: 0, y: 0 };
  advance(actor, .06);
  assert.ok(actor.fighter.position.x - before > 3);
  assert.equal(actor.fighter.attackDamage, 0);
});

test('run-cancel exits a Zip string into locomotion', () => {
  const actor = make('zip');
  press(actor, 'light');
  advance(actor, .08);
  command(actor, 'forward,dash');
  assert.equal(actor.fighter.currentMove.id, 'run-cancel');
  advance(actor, .16);
  assert.equal(actor.fighter.currentMove, null);
});

test('armour absorbs exactly one startup reaction, not damage or a second hit', () => {
  const actor = make('rook');
  press(actor, 'heavy');
  const from = new Vector3(1, 0, 0);
  assert.equal(actor.fighter.takeHit(5, from), 'armor');
  assert.equal(actor.fighter.health.current, 95);
  assert.equal(actor.fighter.currentMove.id, 'hammer');
  assert.equal(actor.fighter.takeHit(5, from), 'hit');
  assert.equal(actor.fighter.state, State.HIT);
  assert.equal(actor.fighter.currentMove, null);
  assert.equal(actor.fighter.moveArmor, 0);
});

test('ground pound hits both sides once, not merely the forward hitbox', () => {
  const actor = make('rook');
  const left = make(null, -2.5);
  const right = make(null, 2.5);
  const world = { fighters: [actor.fighter, left.fighter, right.fighter] };
  command(actor, 'down,up,heavy', world);
  advance(actor, .65, world);
  assert.equal(left.fighter.health.current, 75);
  assert.equal(right.fighter.health.current, 75);
  assert.equal(left.fighter.state, State.KNOCKDOWN);
  assert.equal(right.fighter.state, State.KNOCKDOWN);
  assert.equal(actor.fighter.meter, 6);
});

test('launcher enters the existing juggle system; long poke controls distant space', () => {
  const actor = make('axel');
  const victim = make(null, 1.4);
  const world = { fighters: [actor.fighter, victim.fighter] };
  command(actor, 'down,heavy', world);
  advance(actor, .15, world);
  assert.equal(victim.fighter.state, State.JUGGLE);
  assert.equal(victim.fighter.juggleCount, 1);
  assert.ok(victim.fighter.velocity.y > 0);

  const pike = make('pike');
  const distant = make(null, 3.7);
  const farWorld = { fighters: [pike.fighter, distant.fighter] };
  press(pike, 'heavy', farWorld);
  advance(pike, .5, farWorld);
  assert.equal(distant.fighter.health.current, 83);
});

test('parry converts to a punish; reversal and push require block', () => {
  const actor = make('bastion');
  command(actor, 'back,down,light');
  advance(actor, .04);
  assert.equal(actor.fighter.takeHit(20, new Vector3(1, 0, 0)), 'parry');
  assert.equal(actor.fighter.health.current, 100);
  assert.equal(actor.fighter.currentMove.id, 'punish');

  const guard = make('bastion');
  guard.input.held.add('block');
  tick(guard, .01);
  press(guard, 'heavy');
  assert.equal(guard.fighter.currentMove.id, 'push');

  const reversal = make('bastion');
  reversal.input.held.add('block');
  tick(reversal, .01);
  command(reversal, 'down,up,heavy');
  assert.equal(reversal.fighter.currentMove.id, 'reversal');

  const neutral = make('bastion');
  command(neutral, 'down,up,heavy');
  assert.notEqual(neutral.fighter.currentMove?.id, 'reversal');
});

test('counter-poke converts only against an approaching source', () => {
  const actor = make('pike');
  const source = make(null, 2);
  command(actor, 'back,down,light');
  advance(actor, .06);
  source.fighter.velocity.x = -4;
  assert.equal(actor.fighter.takeHit(10, source.fighter.position, false, 2, {
    source: source.fighter,
  }), 'parry');
  assert.equal(actor.fighter.currentMove.id, 'thrust');
});

test('projectile travels independently, uses swept collision, and hits once', () => {
  const actor = make('ember');
  const victim = make(null, 5);
  const world = { fighters: [actor.fighter, victim.fighter] };
  command(actor, 'down,forward,light', world);
  advance(actor, .22, world);
  assert.equal(actor.fighter.projectiles.length, 1);
  actor.fighter.takeHit(1, new Vector3(-1, 0, 0));
  assert.equal(actor.fighter.currentMove, null);
  tick(actor, .5, world);
  assert.equal(victim.fighter.health.current, 82);
  assert.equal(actor.fighter.projectiles.length, 0);
  tick(actor, .2, world);
  assert.equal(victim.fighter.health.current, 82);
});

test('overdrive pays health on startup, even on whiff; lethal cost cannot attack', () => {
  const actor = make('ember');
  command(actor, 'back,down,forward,heavy');
  assert.equal(actor.fighter.currentMove.id, 'overdrive');
  assert.equal(actor.fighter.health.current, 86);
  advance(actor, 1);
  assert.equal(actor.fighter.health.current, 86);
  const dying = make('ember');
  dying.fighter.health.current = 10;
  command(dying, 'back,down,forward,heavy');
  assert.equal(dying.fighter.state, State.KO);
  assert.equal(dying.fighter.currentMove, null);
  assert.equal(dying.fighter.hitboxLive, false);
});

test('command grab bypasses block but respects grab immunity', () => {
  const actor = make('axel');
  const victim = make(null, 1.1);
  victim.input.held.add('block');
  tick(victim, .01);
  const world = { fighters: [actor.fighter, victim.fighter] };
  command(actor, 'back,forward,grab', world);
  advance(actor, .26, world);
  assert.equal(victim.fighter.health.current, 80);
  assert.equal(victim.fighter.state, State.KNOCKDOWN);
  assert.equal(victim.fighter.grabImmunityLeft, COMBAT.grab.immunitySeconds);

  const immuneActor = make('axel');
  const immune = make(null, 1.1);
  immune.fighter.grabImmunityLeft = 1;
  const immuneWorld = { fighters: [immuneActor.fighter, immune.fighter] };
  command(immuneActor, 'back,forward,grab', immuneWorld);
  advance(immuneActor, .4, immuneWorld);
  assert.equal(immune.fighter.health.current, 100);
});

test('low attacks beat standing guard; crouching guard blocks them', () => {
  for (const crouch of [false, true]) {
    const actor = make('axel');
    const victim = make(null, 1.5);
    victim.input.held.add('block');
    if (crouch) victim.input.direction = { x: 0, y: 1 };
    tick(victim, .001);
    const world = { fighters: [actor.fighter, victim.fighter] };
    press(actor, 'kick', world);
    advance(actor, .17, world);
    assert.equal(victim.fighter.health.current, crouch ? 98 : 89);
  }
});

test('air dive uses descent and landing cleanup; reset clears all move tracking', () => {
  const actor = make('ember');
  actor.fighter.position.y = 2;
  actor.fighter.onFloor = false;
  actor.fighter.state = State.JUMP;
  press(actor, 'kick');
  assert.equal(actor.fighter.currentMove.id, 'dive');
  assert.ok(actor.fighter.velocity.y <= -11);
  advance(actor, .3);
  assert.equal(actor.fighter.currentMove, null);
  assert.equal(actor.fighter.hitboxLive, false);

  command(actor, 'down,forward,light');
  advance(actor, .22);
  assert.equal(actor.fighter.projectiles.length, 1);
  actor.fighter.meter = MOVE_RULES.meterMax;
  actor.fighter.resetCombatTracking();
  assert.equal(actor.fighter.currentMove, null);
  assert.equal(actor.fighter.projectiles.length, 0);
  assert.equal(actor.fighter.inputHistory.length, 0);
  assert.equal(actor.fighter.meter, 0);
});
