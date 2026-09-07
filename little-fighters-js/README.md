# Little Fighters — desktop app (three.js + Electron)

The Godot fighter, ported to JavaScript and wrapped in a double-clickable
desktop app. Same feel: the thirteen-state fighter, attack windows timed to the
animation clips, the drop kick that stops on impact, directional blocking,
knockdown and getup.

The character and all thirteen animation clips are reused unchanged — they were
already glTF, and every clip's channels bind to the same 66 `mixamorig:` bones,
so no retargeting was needed.

## Run it

```bash
cd little-fighters-js
npm install        # also copies three.js + the .glb assets into renderer/
npm start
```

`npm install` runs `tools/setup-assets.mjs`, which copies the character and
clips out of the Godot project one level up into `renderer/assets/`. If you add
or rename a clip there, re-run `npm run assets`.

## Package it as a real app

```bash
npm run dist    # unpacked .app in dist/ — fastest for testing
npm run pack    # a .dmg you can move to /Applications
```

The result is a normal macOS app: double-click, it opens, you play. It is
unsigned, so the first launch needs right-click → Open.

## Controls

**WASD** move · **Shift** run · **Space** jump · **J** punch · **K** kick ·
**L** block (hold) · **U** dash. Run + **K** is the drop kick.

Player 2 is the CPU. A second local player is a two-line change in
`renderer/src/main.js` — swap the `AIController` for `keyboardController('p2')`,
whose bindings are already in `input.js`.

## The opponent

Two layers, deliberately:

- `renderer/src/ai.js` runs every frame and actually presses the buttons —
  approach, spacing, guard reflexes, attack mixups.
- `electron/azure-brain.js` asks your Azure deployment every few seconds for a
  *plan*: stance, preferred attack, aggression, and a line of trash talk. That
  plan re-weights the local layer.

The model is never in the critical path of a frame. No key, a slow network, or a
garbled reply all degrade to the local layer and the match plays normally.

**The key never reaches the renderer.** `azure-brain.js` runs in Electron's main
process and reads `.env` from the project root; the game asks for a tactic over
an IPC bridge that exposes exactly three methods and no filesystem access. Even
if something got injected into the page, it could not read the credentials.

Set `useLLM: false` where the `AIController` is constructed in `main.js` to play
with zero API calls.

## Cost

The HUD shows calls, tokens and spend live, because the opponent calls the model
on a timer and you should see that while playing rather than discover it later.

Everything lands in the same ledger the Python CLI writes,
`../automation/usage.json`, under the command name `game`:

```bash
python3 ../automation/lf.py usage
```

Cost is reported as `unpriced` until you set your deployment's rates:

```bash
python3 ../automation/lf.py price gpt-6-astra --in <rate> --out <rate>
```

Roughly 70 calls in a three-minute fight, about 30k tokens.

## Layout

```
electron/
  main.js          window + the app:// protocol + IPC
  preload.js       the three-method bridge, nothing else
  azure-brain.js   Azure client, cost accounting, key custody
renderer/
  index.html       importmap for the vendored three.js
  src/
    config.js      every tunable, carried over from the Godot exports
    fighter.js     the state machine, combat, physics
    ai.js          local tactics + the model's plan
    arena.js       scene, lights, camera, hit sparks
    assets.js      .glb loading and clip binding
    hud.js         health bars, plan and spend readout
    input.js       two-player keyboard mapping
    main.js        boot + game loop
  assets/          generated — copied .glb files
  vendor/          generated — three.js
tools/
  setup-assets.mjs
  fighter.test.mjs
```

## Tests

```bash
npm test
```

Fourteen headless tests over the combat logic — timing windows, hitbox
geometry, directional blocking, the knockdown chain, drop-kick impact, bounds.
No renderer needed. Run them after any change to `fighter.js`.

## If the knight runs backwards

Set `MODEL_YAW_OFFSET` in `renderer/src/config.js` to `Math.PI`. It depends on
which way the mesh faces inside its own `.glb`, and that varies with the export.
Nothing else needs changing.
