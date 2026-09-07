# Little Fighters — Azure GPT automation

One CLI (`automation/lf.py`) that puts your Azure deployment to work on this
Godot project, plus an in-game opponent whose tactics come from the same model.
Every call prints its tokens and cost and folds them into a running total.

Python 3.9+, **standard library only** — nothing to `pip install`.

---

## 1. Setup (once)

```bash
cd /Users/soomro/Desktop/Projects/little-fighters-

cp automation/.env.example .env      # then paste your key into .env
python3 automation/lf.py doctor      # sends one tiny request to prove it works
```

`.env` sits at the project root and is git-ignored. The key is never written
into any file that git tracks, and never needs to be pasted into a chat.

Cost accounting needs the rate for your deployment, which only you can see on
the Azure pricing page. Until you set it, tokens are counted exactly and cost
is reported as unknown rather than guessed:

```bash
python3 automation/lf.py price gpt-6-astra --in 1.25 --out 10.00
```

Anywhere the Azure endpoint is unreachable, `LF_MOCK=1` runs every code path
against canned replies so you can check the plumbing:

```bash
LF_MOCK=1 python3 automation/lf.py codegen "add a round timer"
```

---

## 2. Usage and cost

```bash
python3 automation/lf.py usage           # the running total
python3 automation/lf.py usage --game    # plus the in-game opponent's counters
python3 automation/lf.py usage --reset   # start over
```

The ledger is `automation/usage.json` — cumulative counts broken down by
command and by model. After each call you also get a single line:

```
  [usage] 12,430 in (8,192 cached) / 1,876 out  ·  this call $0.0243  ·  run $0.0243  ·  lifetime $1.8841 over 37 calls
```

The game keeps its own counters in Godot's `user://azure_usage.json`, which
`usage --game` reads and reports alongside the CLI total.

---

## 3. Dev agent — `codegen`

Reads the project and proposes **complete file rewrites**. Nothing touches your
working tree until you say so.

The game is now the three.js + Electron app in `little-fighters-js/`, and that
is what codegen targets by default. Pass `--godot` to point it at the original
GDScript instead — it is still on disk as reference.

```bash
python3 automation/lf.py codegen "add a combo counter that resets after 1.2s"
python3 automation/lf.py codegen "add a round timer and best-of-3 rounds" --files scripts/HUD.gd scripts/Fighter.gd
python3 automation/lf.py apply add-a-combo-counter-0907-1432
```

Proposals land in `automation/out/<slug>/` with the plan, the proposed files,
and any editor wiring the change needs. `--apply` on `codegen` skips the review
step; either way originals are backed up under `_backup/`, and `git checkout`
undoes everything.

Narrow the context with `--files` when you know which scripts matter — the
whole project is roughly 15–20k tokens per call, a couple of files is 3–4k.

---

## 3b. Letting the model build the game — `roadmap` + `build`

`codegen` proposes; `build` ships. It walks a backlog, and every change it makes
has to survive the headless test suite or it gets undone.

```bash
python3 automation/lf.py roadmap              # what's left
python3 automation/lf.py build                # build the next item, then stop
python3 automation/lf.py build --auto --max 3 # keep going while things pass
python3 automation/lf.py build --item 4       # build one specific item
```

Per item, the loop is:

```
generate -> apply -> npm test
                       pass -> keep it, mark the item done
                       fail -> send the failure back for one repair pass, re-test
                               still failing -> revert everything, mark it blocked
```

The test gate is the reason this is safe to leave running. Without it an
autonomous loop quietly rots the codebase; with it, a change that breaks the
fighter is undone within seconds and the reason is written onto the roadmap
item so you can read what went wrong. `build` refuses to start if the tests
cannot run at all (`--no-gate` overrides that, and you should not).

Reverting is manifest-based, not git-based: each apply records exactly which
files it modified and which it created, so the undo is precise even in a dirty
tree. `lf revert <slug>` undoes any applied proposal by hand.

Managing the backlog:

```bash
python3 automation/lf.py roadmap add "add a training dummy mode" \
    --detail "a mode where the CPU never attacks and health does not drop" \
    --files little-fighters-js/renderer/src/ai.js
python3 automation/lf.py roadmap done 3
python3 automation/lf.py roadmap reset 5      # put a blocked item back
```

`--files` narrows the context sent to the model — the difference between a
16k-token call and a 4k one. Leave it off when a change could touch anything.

Budget roughly 16k input and 4-6k output tokens per item, plus the same again
for each repair pass.

## 4. Asset pipeline — `assets`

```bash
python3 automation/lf.py assets scan             # no API call, just the truth
python3 automation/lf.py assets convert --run    # FBX -> single-clip GLB, headless
python3 automation/lf.py assets wire --apply     # rewrite external_animations
```

`scan` compares the `external_animations` dictionary in `Fighter.gd` against
what is actually in `animations/`, so you can see at a glance which states are
silently doing nothing. It costs nothing to run.

`convert` writes `automation/out/convert_animations.py` — the headless version
of your existing Blender script, pointed at this project's `animations/` folder
— and runs it with `blender --background`. Each FBX is imported into a freshly
emptied scene so every `.glb` carries exactly one clip.

`wire` asks the model to map the files on disk onto the thirteen clip names the
fighter expects, then rewrites the dictionary. Ambiguity is what the model is
for; it is not allowed to invent filenames that aren't there.

---

## 5. Asset generation — `blender`

The model writes a `bpy` script, we run it headless, and if it throws we send
the traceback back for a repair pass.

```bash
python3 automation/lf.py blender "a cracked concrete barrier with rebar" \
    --out backgrounds/barrier.glb --run

python3 automation/lf.py blender "neon vending machine, flickering sign" \
    --out backgrounds/vending.glb --run --repair 3 --notes "waist height, magenta glow"
```

The output path is always chosen by the CLI and injected as `OUTPUT_PATH`, so
a generated script can only write where you told it to. Scripts are kept in
`automation/out/blender/` — open one in Blender's Scripting tab to tweak it by
hand instead of regenerating.

---

### Where Blender comes from

Resolution order, for both `assets convert` and `blender`:

1. `--blender /path/to/Blender.app` (the bundle or the binary inside it)
2. `LF_BLENDER` in `.env`
3. `blender` on your `PATH`
4. `/Applications`, `~/Applications`, and `Applications` folders on any mounted
   volume under `/Volumes` — which covers keeping apps on an external drive
5. Docker, if the daemon is running

### Docker fallback

```bash
python3 automation/lf.py blender "a neon crate" --out backgrounds/crate.glb --run --docker
python3 automation/lf.py assets convert --run --docker
```

The project bind-mounts at `/project` and the generated script reads its
`PROJECT_ROOT` from the runner, so the same script works either way. Default
image is `blenderkit/headless-blender:multi-version`; override with `--image`
or `LF_BLENDER_DOCKER`.

Before you rely on it: the maintained headless Blender images are x86-64. On
Apple Silicon they run emulated — fine for procedural mesh scripts, slower than
native, occasionally unstable. Prefer a native Blender when you have one. Set
`LF_BLENDER_DOCKER_PLATFORM=linux/amd64` if Docker refuses the image.

## 6. In-game LLM opponent — `opponent`

```bash
python3 automation/lf.py opponent install   # patch Fighter.gd's AI hooks
python3 automation/lf.py opponent key       # give the running game its key
python3 automation/lf.py opponent policy    # regenerate the tactics prompt
```

Two layers, deliberately:

- **`AIController.gd`** runs every physics frame and actually presses the
  buttons — approach, spacing, guard reflexes, attack mixups.
- **`AzureBrain.gd`** asks the model every few seconds for a *plan*: stance,
  preferred attack, aggression, and a line of trash talk. That plan re-weights
  the local layer.

The model is never in the critical path of a frame. If the network is slow, the
key is missing, or the reply is nonsense, the local layer keeps fighting on its
own and the match plays normally. `min_interval` on AzureBrain (default 2.5s)
is the spend dial — a three-minute fight is roughly 70 small calls.

`opponent key` writes the credentials to Godot's `user://azure.cfg`, which lives
in your Godot app data folder, **outside this repo**. The game reads
`AZURE_OPENAI_API_KEY` from the environment first if it is set.

### Editor wiring

1. Open `scenes/Arena.tscn`, select **Player2**.
2. Add a child `Node` named **AzureBrain** → attach `scripts/AzureBrain.gd`.
3. Add a child `Node` named **AIController** → attach `scripts/AIController.gd`.
4. On AIController: **Fighter Path** `..`, **Opponent Path** `../../Player1`,
   **Brain Path** `../AzureBrain`. Turn **Debug Log** on while testing.

`ai_controlled` is set by the controller at runtime — you don't need to tick it.

---

## Cost discipline

- `assets scan` and `codegen --dry-run` cost nothing.
- `--files` on `codegen` is the difference between a 20k-token call and a 4k one.
- The in-game brain is the only thing that spends money continuously. Raise
  `min_interval`, or untick `use_llm` on AIController, to stop it.
- `usage` after a session tells you exactly what the day cost.

## Files

```
automation/
  lf.py                    the CLI
  lftool/                  implementation
  pricing.json             USD per 1M tokens, per model
  usage.json               the running total (created on first call)
  out/                     proposals, generated Blender scripts, backups
scripts/
  AzureBrain.gd            async Azure client for the running game
  AIController.gd          local tactics layer, re-weighted by the model
```
