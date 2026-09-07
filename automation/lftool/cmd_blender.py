"""`lf blender` — generate game assets with Blender, driven by the model.

The model writes a bpy script; we run it headless; if it throws, the traceback
goes back to the model for a repair pass. The script always exports to a path
we choose, never one the model invents.

    python3 automation/lf.py blender "a broken neon vending machine prop" \\
        --out backgrounds/vending_machine.glb --run
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

from .azure_client import AzureClient, extract_blocks
from .blender_runner import resolve
from .config import OUT_DIR, PROJECT_ROOT

SYSTEM = """You write Blender Python (bpy) scripts that procedurally build 3D game assets
and export them as .glb for a Godot 4 beat-'em-up called "Little Fighters 3D".
The game's look is stylised, low-poly, neon-lit, readable from a fixed
three-quarter camera.

Hard requirements:
- Blender 4.x bpy API.
- Start with `bpy.ops.wm.read_homefile(use_empty=True)` so the scene is clean.
- Build geometry ONLY from bpy primitives and modifiers. No external files,
  no image textures, no downloads, no add-ons beyond what ships with Blender.
- Use `bpy.data.materials.new(...)` with `use_nodes = True` and set the
  Principled BSDF inputs. Emission for neon. Guard optional socket names with
  `if "Emission Strength" in bsdf.inputs:` — socket names moved between versions.
- Keep it under ~4000 triangles unless asked otherwise. Apply modifiers before export.
- The variable `OUTPUT_PATH` is already defined in the script's globals by the
  runner. Do NOT define it. End with:
      bpy.ops.export_scene.gltf(filepath=OUTPUT_PATH, export_format='GLB',
                                export_yup=True, export_apply=True)
- Ground the asset so its base sits at z = 0 (Godot's floor is y = 0).
- Print a one-line summary with `print("[asset] ...")` at the end.

Reply with a short sentence of what you built, then ONE python code block. Nothing else.
"""

REPAIR = """The script above failed in Blender. Here is the error output:

{error}

Return the COMPLETE corrected script in one python code block. Fix only what
broke; keep the design the same. Remember OUTPUT_PATH is provided by the runner.
"""

RUNNER = '''# Auto-generated runner wrapper — do not edit by hand.
import os
import sys
import traceback

PROJECT_ROOT = r"{project_root}"
OUTPUT_PATH = os.path.join(PROJECT_ROOT, "{out_rel}")
os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)


def _main():
{body}


try:
    _main()
except Exception:
    traceback.print_exc()
    sys.exit(3)
'''


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:48] or "asset"


def _safe_out(raw: str) -> Path | None:
    rel = Path(raw.strip().lstrip("./"))
    if rel.is_absolute() or ".." in rel.parts:
        return None
    if rel.suffix.lower() != ".glb":
        rel = rel.with_suffix(".glb")
    return rel


def _wrap(script_body: str, out_rel: Path, project_root: str) -> str:
    indented = "\n".join(("    " + line) if line.strip() else "" for line in script_body.splitlines())
    return RUNNER.format(project_root=project_root, out_rel=out_rel.as_posix(),
                         body=indented or "    pass")


def _extract_script(reply: str) -> str | None:
    blocks = extract_blocks(reply, "python") or extract_blocks(reply)
    if not blocks:
        return None
    body = blocks[0][1]
    # The model was told not to, but strip a stray OUTPUT_PATH assignment anyway.
    return "\n".join(
        l for l in body.splitlines() if not re.match(r"^\s*OUTPUT_PATH\s*=", l)
    )


def run(args) -> int:
    description = " ".join(args.description).strip()
    if not description:
        print('Describe the asset, e.g.  lf blender "a cracked concrete barrier" --out backgrounds/barrier.glb')
        return 2

    rel_out = _safe_out(args.out) if args.out else Path("backgrounds") / f"{_slug(description)}.glb"
    if rel_out is None:
        print(f"  ! Refusing to write outside the project: {args.out}")
        return 2
    abs_out = PROJECT_ROOT / rel_out

    runner, why = resolve(getattr(args, "blender", None),
                          getattr(args, "docker", False),
                          getattr(args, "image", None))
    if runner is None and args.run:
        print("  ! " + why)
        return 1
    root = runner.project_root if runner else str(PROJECT_ROOT)

    work = OUT_DIR / "blender"
    work.mkdir(parents=True, exist_ok=True)
    script_path = work / f"{_slug(description)}.py"

    print(f"→ blender asset: {description}")
    print(f"  output: {rel_out}")
    if runner:
        print(f"  blender: {runner.describe()}")

    if args.dry_run:
        print("  --dry-run: not calling the API.")
        return 0

    client = AzureClient()
    prompt = (
        f"Build this asset: {description}\n\n"
        f"It will be exported to `{rel_out}` and instanced in the Arena scene, "
        "which is roughly 12x12 world units with the fighters about 1.8 units tall."
    )
    if args.notes:
        prompt += f"\n\nExtra direction: {args.notes}"

    reply = client.respond(prompt, system=SYSTEM, command="blender",
                           max_output_tokens=args.max_tokens)
    body = _extract_script(reply)
    if body is None:
        print("  ! No python block in the reply. Saved to " + str(work / "last_reply.md"))
        (work / "last_reply.md").write_text(reply, encoding="utf-8")
        return 1

    script_path.write_text(_wrap(body, rel_out, root), encoding="utf-8")
    print(f"  script → automation/out/blender/{script_path.name}")

    if not args.run:
        print("\n  Run it with --run, or open it in Blender's Scripting tab.")
        return 0

    abs_out.parent.mkdir(parents=True, exist_ok=True)

    for attempt in range(args.repair + 1):
        print(f"\n  Running Blender headless (attempt {attempt + 1}/{args.repair + 1})…")
        proc = subprocess.run(runner.command(script_path), capture_output=True, text=True)
        for line in proc.stdout.splitlines():
            if "[asset]" in line:
                print("    " + line)

        if proc.returncode == 0 and abs_out.is_file():
            size_kb = abs_out.stat().st_size / 1024
            print(f"\n  ✓ Wrote {rel_out}  ({size_kb:,.0f} KB)")
            print("  Godot will import it the next time you focus the editor window.")
            print(f"  Instance it in scenes/Arena.tscn, or:  lf codegen \"add {rel_out.stem} to the arena\"")
            return 0

        error = (proc.stdout[-1500:] + "\n" + proc.stderr[-2500:]).strip()
        print(f"  ! Blender failed (exit {proc.returncode}).")
        if attempt >= args.repair:
            (work / f"{script_path.stem}.error.txt").write_text(error, encoding="utf-8")
            print("    Error saved next to the script. Raise --repair to let it try again.")
            return 1

        print("    Sending the traceback back for a repair pass…")
        reply = client.respond(
            f"Here is the script you wrote:\n\n```python\n{body}\n```\n\n"
            + REPAIR.format(error=error),
            system=SYSTEM, command="blender-repair", max_output_tokens=args.max_tokens,
        )
        fixed = _extract_script(reply)
        if fixed is None:
            print("    ! Repair reply had no code block. Stopping.")
            return 1
        body = fixed
        script_path.write_text(_wrap(body, rel_out, root), encoding="utf-8")

    return 1
