"""`lf opponent` — the in-game LLM opponent.

  install   patch Fighter.gd with the AI intent hooks (idempotent) and print
            the editor wiring for AIController + AzureBrain
  key       write the API key, endpoint, model and pricing into Godot's
            user:// config so the running game can authenticate
  policy    regenerate AzureBrain's tactics system prompt with the model
"""

from __future__ import annotations

import os
import platform
import re
import shutil
from pathlib import Path

from .azure_client import AzureClient
from .config import Config, PROJECT_ROOT

FIGHTER = PROJECT_ROOT / "scripts" / "Fighter.gd"
BRAIN = PROJECT_ROOT / "scripts" / "AzureBrain.gd"

MARKER = "# --- AI intent (written by AIController"

INTENT_BLOCK = '''# --- AI intent (written by AIController when ai_controlled is true) ---------
## Desired movement, same axes and scale as a human's _move_input().
var ai_move: Vector2 = Vector2.ZERO
## Action name -> currently held (e.g. "block", "run").
var ai_hold: Dictionary = {}
## Action name -> pressed this frame. Cleared automatically each physics tick,
## which is what gives AI presses the same one-shot behaviour as "just pressed".
var _ai_presses: Dictionary = {}


## Queue a one-frame press for an AI-driven fighter.
func ai_press(action: String) -> void:
	_ai_presses[action] = true


## Set or clear a held button for an AI-driven fighter.
func ai_hold_set(action: String, down: bool) -> void:
	ai_hold[action] = down


'''

PATCHES: list[tuple[str, str, str]] = [
    (
        "move input",
        "func _move_input() -> Vector2:\n\tif ai_controlled:\n\t\treturn Vector2.ZERO\n",
        "func _move_input() -> Vector2:\n"
        "\tif ai_controlled:\n"
        "\t\tvar v := ai_move\n"
        "\t\tif v.length() > 1.0:\n"
        "\t\t\tv = v.normalized()\n"
        "\t\treturn v\n",
    ),
    (
        "button reads",
        "func _pressed(name: String) -> bool:\n"
        "\treturn not ai_controlled and Input.is_action_just_pressed(_act(name))\n"
        "\n"
        "func _held(name: String) -> bool:\n"
        "\treturn not ai_controlled and Input.is_action_pressed(_act(name))\n",
        "func _pressed(name: String) -> bool:\n"
        "\tif ai_controlled:\n"
        "\t\treturn bool(_ai_presses.get(name, false))\n"
        "\treturn Input.is_action_just_pressed(_act(name))\n"
        "\n"
        "func _held(name: String) -> bool:\n"
        "\tif ai_controlled:\n"
        "\t\treturn bool(ai_hold.get(name, false))\n"
        "\treturn Input.is_action_pressed(_act(name))\n",
    ),
    (
        "press consumption",
        "\tmove_and_slide()\n",
        "\tmove_and_slide()\n"
        "\n"
        "\t# One-frame AI presses are consumed here, mirroring \"just pressed\".\n"
        "\tif ai_controlled and not _ai_presses.is_empty():\n"
        "\t\t_ai_presses.clear()\n",
    ),
]


def _godot_user_dir() -> Path | None:
    """Where Godot keeps user:// for this project."""
    godot = PROJECT_ROOT / "project.godot"
    name = "little-fighters-"
    if godot.is_file():
        m = re.search(r'^config/name\s*=\s*"([^"]+)"', godot.read_text(encoding="utf-8",
                                                                       errors="replace"),
                      re.MULTILINE)
        if m:
            name = m.group(1)

    system = platform.system()
    if system == "Darwin":
        base = Path.home() / "Library" / "Application Support" / "Godot" / "app_userdata"
    elif system == "Windows":
        appdata = os.environ.get("APPDATA")
        if not appdata:
            return None
        base = Path(appdata) / "Godot" / "app_userdata"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) \
            / "godot" / "app_userdata"
    return base / name


# -- install ----------------------------------------------------------------


def run_install(args) -> int:
    if not FIGHTER.is_file():
        print("  ! scripts/Fighter.gd not found.")
        return 1

    text = FIGHTER.read_text(encoding="utf-8")
    original = text
    applied, already = [], []

    if MARKER in text:
        already.append("AI intent fields")
    else:
        anchor = "signal state_changed(new_state)"
        if anchor not in text:
            print("  ! Could not find the insertion point in Fighter.gd.")
            return 1
        text = text.replace(anchor, INTENT_BLOCK + anchor, 1)
        applied.append("AI intent fields")

    for label, old, new in PATCHES:
        if new in text:
            already.append(label)
        elif old in text:
            text = text.replace(old, new, 1)
            applied.append(label)
        else:
            print(f"  ! Could not find the '{label}' block in Fighter.gd — patch it by hand.")

    if text == original:
        print("  Fighter.gd already has the AI hooks. Nothing to do.")
    else:
        backup = FIGHTER.with_suffix(".gd.bak")
        shutil.copy2(FIGHTER, backup)
        FIGHTER.write_text(text, encoding="utf-8")
        print(f"  Patched scripts/Fighter.gd  ({', '.join(applied)})")
        print(f"  Backup: scripts/{backup.name}")
    if already:
        print(f"  Already present: {', '.join(already)}")

    missing = [n for n in ("AzureBrain.gd", "AIController.gd")
               if not (PROJECT_ROOT / "scripts" / n).is_file()]
    if missing:
        print(f"\n  ! Missing from scripts/: {', '.join(missing)}")
        return 1

    print("""
  Wiring in the Godot editor
  --------------------------
  1. Open scenes/Arena.tscn and select Player2.
  2. Add a child Node named  AzureBrain   → attach scripts/AzureBrain.gd
  3. Add a child Node named  AIController → attach scripts/AIController.gd
  4. On AIController set:
       Fighter Path   → .. (the Player2 root)
       Opponent Path  → ../../Player1
       Brain Path     → ../AzureBrain
       Debug Log      → on, while you are testing
  5. Player2's `ai_controlled` is set automatically by AIController at runtime.

  Then give the running game the key:
       python3 automation/lf.py opponent key
""")
    return 0


# -- key --------------------------------------------------------------------


def run_key(args) -> int:
    cfg = Config()
    user_dir = _godot_user_dir()
    if user_dir is None:
        print("  ! Could not work out Godot's user data directory on this OS.")
        return 1

    key = cfg.api_key
    if not key:
        print("  ! No AZURE_OPENAI_API_KEY found.")
        print(f"    Put it in {PROJECT_ROOT / '.env'} first.")
        return 1

    user_dir.mkdir(parents=True, exist_ok=True)
    dest = user_dir / "azure.cfg"

    lines = [
        "[azure]",
        "",
        f'api_key="{key}"',
        f'endpoint="{cfg.endpoint}"',
        f'model="{cfg.model}"',
    ]

    from . import usage as usage_mod
    price = usage_mod.price_for(cfg.model)
    in_rate = args.price_in if args.price_in is not None else (price or {}).get("input_per_1m")
    out_rate = args.price_out if args.price_out is not None else (price or {}).get("output_per_1m")
    if in_rate is not None and out_rate is not None:
        lines += [f"input_per_1m={float(in_rate)}", f"output_per_1m={float(out_rate)}"]

    dest.write_text("\n".join(lines) + "\n", encoding="utf-8")
    try:
        dest.chmod(0o600)
    except OSError:
        pass

    print(f"  Wrote {dest}")
    print(f"    key      {cfg.masked_key()}")
    print(f"    model    {cfg.model}")
    if in_rate is not None and out_rate is not None:
        print(f"    pricing  ${in_rate}/1M in · ${out_rate}/1M out")
    else:
        print("    pricing  not set — the game will count tokens but not cost.")
        print("             add it with --price-in 1.25 --price-out 10.00")
    print("\n  This file is outside the repo, so the key never lands in git.")
    return 0


# -- policy -----------------------------------------------------------------

POLICY_SYSTEM = """You write system prompts for the tactical brain of a CPU fighter in a
3D beat-'em-up. The brain is called every few seconds with a JSON snapshot of
the fight and must reply with a small JSON plan that a local controller executes.

The reply schema is fixed and must not change:
{"stance": one of rush|poke|spacing|defensive|retreat,
 "preferred": one of punch|kick|dropkick|dash|block,
 "aggression": 0.0-1.0,
 "taunt": at most 8 words or ""}

Write a better system prompt: concrete about when each stance wins, aware that
low health should change behaviour, aware that a human who turtles must be
punished by mixing up attacks. Keep it under 350 words. No markdown headings.

Output the prompt text only — no preamble, no code fence, no commentary.
"""

_CONST = re.compile(r'(const SYSTEM_PROMPT := """)(.*?)(""")', re.DOTALL)


def run_policy(args) -> int:
    if not BRAIN.is_file():
        print("  ! scripts/AzureBrain.gd not found.")
        return 1

    text = BRAIN.read_text(encoding="utf-8")
    m = _CONST.search(text)
    if not m:
        print("  ! Could not find the SYSTEM_PROMPT constant in AzureBrain.gd.")
        return 1

    prompt = (
        "Here is the current prompt:\n\n"
        + m.group(2).strip()
        + "\n\nRewrite it."
    )
    if args.notes:
        prompt += f"\n\nExtra direction: {args.notes}"

    if args.dry_run:
        print("  --dry-run: not calling the API.")
        return 0

    client = AzureClient()
    new_prompt = client.respond(prompt, system=POLICY_SYSTEM, command="opponent-policy",
                               max_output_tokens=1500).strip()

    new_prompt = new_prompt.strip("`").strip()
    if '"""' in new_prompt:
        print('  ! The new prompt contains \'"""\' and would break the GDScript literal.')
        return 1
    if len(new_prompt) < 120:
        print("  ! Reply was too short to be a prompt. Left AzureBrain.gd alone.")
        return 1

    shutil.copy2(BRAIN, BRAIN.with_suffix(".gd.bak"))
    BRAIN.write_text(_CONST.sub(lambda mm: mm.group(1) + new_prompt + "\n" + mm.group(3),
                                text, count=1), encoding="utf-8")
    print(f"\n  Updated SYSTEM_PROMPT in scripts/AzureBrain.gd ({len(new_prompt)} chars).")
    print("  Backup: scripts/AzureBrain.gd.bak")
    return 0
