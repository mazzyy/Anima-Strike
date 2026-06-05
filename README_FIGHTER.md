# Little Fighters 3D — Fighter scaffold

This is a working Godot 4 fighter controller you can drop your Knight model into. It gives you grounded movement on the ground plane (beat-'em-up style), jumping, a state machine, and a hitbox/hurtbox damage system. It's built so the game runs even before you have all your animations — missing clips are skipped, not crashed on.

## What was added

```
scripts/
  Fighter.gd           # main CharacterBody3D controller + state machine
  HealthComponent.gd   # health pool, emits health_changed / died
  Hitbox.gd            # the damaging volume of an attack (Area3D)
  Hurtbox.gd           # the vulnerable volume (Area3D)
scenes/
  Player.tscn          # Knight instanced + all nodes wired up
project.godot          # added [input] section: p1_* and p2_* actions
```

## First run

1. Open the project in Godot 4.6.
2. Open `scenes/Player.tscn`. You should see the Knight with a capsule collider, a Hurtbox, a Hitbox (in front), and a HealthComponent.
3. Select the root **Player** node and look at the Inspector — the script's tunables are grouped under Movement / Combat / Input / Animation names.
4. Make a test arena (see below) and press Play.

Right now your `.glb` ships a single clip named `mixamo.com`, so set **Animation names → Anim Idle** to `mixamo.com` for now just to confirm the model animates. The other states stay silent until you import their clips.

## The important part: getting multiple Mixamo animations into one model

Every Mixamo download names its single clip `mixamo.com`, which is why you only see one. Here's the clean Godot 4 workflow:

1. On Mixamo, download each animation **Without Skin** as FBX, plus your character once as a T-pose with skin.
2. Convert each to `.glb` (Blender, or import the FBX directly — Godot 4.6 can handle FBX if you have the FBX2glTF setup, but `.glb` is smoother).
3. For each animation `.glb`, select it in the Godot FileSystem dock → **Import** tab → set it to import as an **Animation Library**, rename the clip (e.g. `idle`, `walk`, `punch`, `kick`, `hit`, `ko`), and reimport.
4. Open `Player.tscn`, select the **AnimationPlayer** inside the Knight model. In the animation toolbar, open the library dropdown → **Manage Animations / Load Library** and add each animation library. Now all clips live in one AnimationPlayer.
5. Back on the **Player** root, fill in the Animation names fields (`anim_idle`, `anim_walk`, `anim_attack`, …) with those clip names. Done — the states animate automatically.

Tip: if clip names end up prefixed by the library (e.g. `walk/walk`), just use the full name Godot shows in the AnimationPlayer dropdown.

## Controls

Player 1: **WASD** move · **Space** jump · **Shift** run · **J** punch · **K** kick · **L** block (hold) · **U** dash.
Player 2: **Arrows** move · **/** jump · **,** run · **.** punch · **M** kick · **N** block (hold) · **B** dash.

(Movement uses physical keycodes so it works regardless of keyboard layout.)

## Animation download checklist (Mixamo)

Every clip is downloaded the same way: **FBX Binary · Without Skin · 30 FPS**, then
converted to `.glb` and dropped in `res://animations/` with the filename below.
The fighter loads each one automatically and maps it to the clip name on the left.
Any file not present yet is simply skipped — add them in whatever order you like.

| Clip name | File to save as            | Mixamo search             | Tip                          |
|-----------|----------------------------|---------------------------|------------------------------|
| idle      | `animations/breathing.glb` | "Breathing Idle"          | ✓ done                       |
| walk      | `animations/walking.glb`   | "Walking"                 | ✓ done — use **In Place**    |
| run       | `animations/run.glb`       | "Running"                 | use **In Place**             |
| jump      | `animations/jump.glb`      | "Jump" / "Jumping Up"     |                              |
| punch     | `animations/punch.glb`     | "Punching" / "Cross Punch"| short & snappy is best       |
| kick      | `animations/kick.glb`      | "Kicking" / "Roundhouse"  | this one causes a knockdown  |
| hit       | `animations/hit.glb`       | "Hit Reaction"            | light flinch                 |
| block     | `animations/block.glb`     | "Blocking" / "Guard Idle" | should be a held pose        |
| dash      | `animations/dash.glb`      | "Quick Roll" / "Dodge"    | fast, ~0.2s                  |
| knockdown | `animations/knockdown.glb` | "Falling Back Death" / "Knocked Out" | non-lethal knockdown |
| getup     | `animations/getup.glb`     | "Stand Up" / "Getting Up" | follows a knockdown          |
| death     | `animations/death.glb`     | "Dying" / "Death"         | plays at 0 HP, stays down    |

To remap a file or add a brand-new move, edit the `external_animations` dictionary
on the **Player** node (Inspector) or the defaults in `scripts/Fighter.gd`.

## Movement clips: use "In Place"

For `walk` and `run`, tick **In Place** on Mixamo before downloading. Otherwise the
clip has built-in forward motion that fights the code-driven movement and makes the
feet slide. Idle/punch/kick don't need it.

## Make a quick test arena

1. New scene → root **Node3D**, name it `Arena`.
2. Add a **StaticBody3D** with a **CollisionShape3D** (BoxShape3D, e.g. 20 × 1 × 20) and a **MeshInstance3D** (BoxMesh same size) as the floor.
3. Add a **DirectionalLight3D** and a **Camera3D**. For a Little Fighters feel, place the camera back and slightly up, looking at the stage (e.g. position `(0, 6, 12)`, rotation `-25°` on X).
4. Instance `Player.tscn` once or twice. For the second one, set **Input → Action Prefix** to `p2` and move it a few units along X.
5. Set `Arena` as the main scene and press Play.

## How the combat loop works

- An attack input puts the fighter in the **ATTACK** state. Between `attack_active_start` and `attack_active_end` (seconds) the **Hitbox** turns on.
- When the Hitbox overlaps an enemy **Hurtbox**, it calls `take_hit()` on that fighter once per swing, applying damage (via HealthComponent) and knockback.
- At 0 health the HealthComponent emits `died`, and the fighter enters the **KO** state.

Collision layers used: Hurtbox is on layer 2; Hitbox masks layer 2. The body capsule is on layer 1 for the floor. If you add more object types, keep these separate.

## Tuning

Everything lives in the Inspector on the Player root: speeds, jump height, gravity, attack timing windows, damage, knockback, and the hit-stun duration. Adjust the attack timing windows to line up with the actual frames of your punch/kick animations.

## Sensible next steps

- Add a UI health bar bound to `HealthComponent.health_changed`.
- Add more attacks (light/heavy, jump attack) — duplicate the ATTACK branch with different timing/damage and a different animation.
- Add input buffering and a combo counter for that Little Fighters combo feel.
- For an AI opponent, set `ai_controlled = true` and drive its intent from a script (you already have a clean state machine to hook into).
