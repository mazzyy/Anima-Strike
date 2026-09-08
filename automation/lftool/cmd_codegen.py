"""`lf codegen` — the dev agent.

Reads the project, asks the model for whole-file rewrites, and writes them to
automation/out/<slug>/ for review. Nothing touches your working tree until you
pass --apply, and every apply records a manifest so it can be reverted cleanly.

The generation step is exposed as generate() so `lf build` can drive it in a
loop without going through the CLI.
"""

from __future__ import annotations

import difflib
import json
import re
import shutil
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from . import context
from .azure_client import AzureClient
from .config import OUT_DIR, PROJECT_ROOT

SYSTEM_JS = """You are a senior gameplay engineer working on "Little Fighters", a 3D
beat-'em-up built with three.js inside an Electron desktop app. It was ported
from a Godot project; the character and animation .glb files came across
unchanged.

Rules you must follow:
- Modern JavaScript, ES modules, no TypeScript, no build step, no bundler.
  The renderer imports three via an importmap ("three" and "three/addons/").
- Do not add dependencies. If something needs a library, say so in ### WIRING
  instead of importing it.
- Respect the existing architecture: the Fighter state machine in fighter.js
  (string states, #enterState, per-swing damage/knockback fields), the
  controller interface { move(), pressed(action), held(action) } that both the
  keyboard and the AI implement, and config.js as the single home for tunables.
- The API key lives in the Electron main process. Renderer code reaches the
  model only through globalThis.lf (requestTactic/status/usage). Never read a
  key, a file, or node APIs from renderer code.
- A missing animation clip must never throw — skip it, the way animator.play()
  already returns false.
- The headless tests in tools/fighter.test.mjs MUST still pass. They are run
  automatically after your change is applied, and the change is reverted if they
  fail. If you change behaviour on purpose, update the tests in the same reply
  and say so in ### PLAN.
- Prefer editing as few files as possible. Do not restate files you did not change.

Output format — this is parsed by a script, so follow it exactly:

### PLAN
A short paragraph on what you are changing and why.

### FILE: relative/path/from/project/root.js
```javascript
<the COMPLETE file contents, not a fragment or a diff>
```

Repeat the ### FILE block for each changed file.

### WIRING
Anything the user must do by hand (install something, re-run npm run assets,
change a setting). Write "None." if there are none.
"""

SYSTEM_GODOT = """You are a senior Godot 4.6 gameplay engineer working on "Little Fighters 3D",
a beat-'em-up with a CharacterBody3D fighter driven by a state machine.

Rules you must follow:
- Godot 4.6 GDScript only. Tabs for indentation, static typing where natural.
- Respect the existing architecture: the Fighter state machine (enum State),
  HealthComponent / Hitbox / Hurtbox, the `action_prefix` input scheme, and the
  `external_animations` dictionary.
- Missing animation clips must never crash the game.
- Prefer editing as few files as possible.

Output format — this is parsed by a script, so follow it exactly:

### PLAN
A short paragraph on what you are changing and why.

### FILE: relative/path/from/project/root.gd
```gdscript
<the COMPLETE file contents>
```

### WIRING
Any manual steps needed in the Godot editor. Write "None." if there are none.
"""

APPLICABLE = {".js", ".mjs", ".html", ".css", ".json",
              ".gd", ".tscn", ".tres", ".godot", ".cfg"}

_FILE_BLOCK = re.compile(
    r"^###\s*FILE:\s*(?P<path>[^\n]+?)\s*\n+```[A-Za-z0-9_+-]*\n(?P<body>.*?)```",
    re.DOTALL | re.MULTILINE,
)
_SECTION = re.compile(r"^###\s*(PLAN|WIRING)\s*\n(.*?)(?=^###\s|\Z)", re.DOTALL | re.MULTILINE)

MANIFEST = "_manifest.json"


@dataclass
class Proposal:
    slug: str
    out: Path
    task: str
    files: list[Path] = field(default_factory=list)
    plan: str = ""
    wiring: str = ""
    reply: str = ""

    @property
    def ok(self) -> bool:
        return bool(self.files)


def _slug(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return (s[:48] or "task") + "-" + datetime.now().strftime("%m%d-%H%M%S")


# Where source actually lives. Used to re-root a path the model wrote relative
# to a subproject instead of the repo.
SOURCE_ROOTS = ("little-fighters-js", "scripts", "scenes")
SKIP_PARTS = {"node_modules", "vendor", "assets", ".git", "__pycache__", "out", "dist"}


def _project_files() -> list[Path]:
    out: list[Path] = []
    for root in SOURCE_ROOTS:
        base = PROJECT_ROOT / root
        if not base.is_dir():
            continue
        for f in base.rglob("*"):
            if f.is_file() and not set(f.parts) & SKIP_PARTS and f.suffix in APPLICABLE:
                out.append(f.relative_to(PROJECT_ROOT))
    return out


def _safe_rel(raw: str) -> Path | None:
    """Map a model-supplied path onto a real project path.

    Models write paths relative to whatever subtree they were shown — a reply
    saying `renderer/src/main.js` means `little-fighters-js/renderer/src/main.js`
    here. Taking that literally creates a stray file at the repo root and leaves
    the real one untouched, which then passes the tests because nothing changed.
    So: resolve against files that actually exist before treating a path as new.
    """
    rel = Path(raw.strip().strip("`").lstrip("./"))
    if rel.is_absolute() or ".." in rel.parts:
        return None
    if (PROJECT_ROOT / rel).is_file():
        return rel

    existing = _project_files()
    posix = rel.as_posix()

    # A real file whose path ends with what the model wrote.
    suffix_hits = [p for p in existing if p.as_posix().endswith("/" + posix)]
    if len(suffix_hits) == 1:
        return suffix_hits[0]

    # Failing that, a unique filename match.
    base_hits = [p for p in existing if p.name == rel.name]
    if len(base_hits) == 1:
        return base_hits[0]
    if len(base_hits) > 1:
        return None            # ambiguous — refuse rather than guess wrong

    # Genuinely new: put it under the subproject its top folder belongs to.
    for root in SOURCE_ROOTS:
        if (PROJECT_ROOT / root / rel).parent.is_dir():
            return Path(root) / rel
    return rel


def generate(task: str, focus: list[str] | None = None, godot: bool = False,
             max_tokens: int = 32000, client: AzureClient | None = None,
             quiet: bool = False) -> Proposal:
    """Ask the model for a change set and write it to automation/out/<slug>/."""
    use_godot = godot or not context.js_available()
    system = SYSTEM_GODOT if use_godot else SYSTEM_JS
    ctx = context.build(include_files=focus, godot=use_godot)

    prompt = (
        f"# Task\n{task}\n\n"
        f"# Current project\n\n{ctx}\n\n"
        "# Now\n"
        "Implement the task. Return complete files in the required format."
    )

    if not quiet:
        default_set = context.GODOT_SCRIPTS if use_godot else context.JS_SOURCES
        print(f"  target:  {'Godot / GDScript' if use_godot else 'three.js + Electron'}")
        print(f"  context ≈ {context.approx_tokens(prompt):,} tokens across "
              f"{len(focus or default_set)} files")

    reply = (client or AzureClient()).respond(
        prompt, system=system, command="codegen", max_output_tokens=max_tokens)

    slug = _slug(task)
    out = OUT_DIR / slug
    out.mkdir(parents=True, exist_ok=True)
    (out / "reply.md").write_text(reply, encoding="utf-8")

    sections = {m.group(1): m.group(2).strip() for m in _SECTION.finditer(reply)}
    proposal = Proposal(
        slug=slug, out=out, task=task, reply=reply,
        plan=sections.get("PLAN", ""), wiring=sections.get("WIRING", ""),
    )

    for raw_path, body in _FILE_BLOCK.findall(reply):
        rel = _safe_rel(raw_path)
        if rel is None:
            if not quiet:
                print(f"  ! skipped unsafe path from model: {raw_path!r}")
            continue
        if rel.suffix not in APPLICABLE:
            if not quiet:
                print(f"  ! skipped unexpected file type: {rel}")
            continue
        dest = out / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(body.rstrip() + "\n", encoding="utf-8")
        proposal.files.append(rel)

    summary = [f"# {task}", "", f"Generated {datetime.now():%Y-%m-%d %H:%M}", ""]
    if proposal.plan:
        summary += ["## Plan", proposal.plan, ""]
    summary += ["## Files proposed", *[f"- `{p}`" for p in proposal.files], ""]
    if proposal.wiring:
        summary += ["## Wiring", proposal.wiring, ""]
    (out / "SUMMARY.md").write_text("\n".join(summary), encoding="utf-8")

    return proposal


def apply_proposal(out: Path, files: list[Path], quiet: bool = False) -> dict:
    """Copy proposed files in, recording enough to undo it exactly."""
    backup = out / "_backup"
    manifest = {"modified": [], "created": []}

    changed = 0
    for rel in files:
        dest = PROJECT_ROOT / rel
        new_bytes = (out / rel).read_bytes()
        if dest.is_file():
            old_bytes = dest.read_bytes()
            bdest = backup / rel
            bdest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(dest, bdest)
            manifest["modified"].append(str(rel))
            if old_bytes != new_bytes:
                changed += 1
        else:
            manifest["created"].append(str(rel))
            changed += 1
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(out / rel, dest)
    manifest["files_changed"] = changed

    (out / MANIFEST).write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    if not quiet:
        print(f"  Applied {len(files)} file(s)  "
              f"({len(manifest['modified'])} modified, {len(manifest['created'])} new)")
    return manifest


def revert_proposal(out: Path, quiet: bool = False) -> bool:
    """Undo an applied proposal using its manifest. Returns True if anything changed."""
    mpath = out / MANIFEST
    if not mpath.is_file():
        if not quiet:
            print("  ! no manifest — cannot revert automatically.")
        return False

    manifest = json.loads(mpath.read_text(encoding="utf-8"))
    backup = out / "_backup"

    for rel in manifest.get("modified", []):
        src = backup / rel
        if src.is_file():
            shutil.copy2(src, PROJECT_ROOT / rel)

    for rel in manifest.get("created", []):
        target = PROJECT_ROOT / rel
        if target.is_file():
            try:
                target.unlink()
            except OSError as exc:
                if not quiet:
                    print(f"  ! could not remove {rel}: {exc}")

    if not quiet:
        print(f"  Reverted {len(manifest.get('modified', []))} modified, "
              f"{len(manifest.get('created', []))} new file(s).")
    return True


def print_diff(rel: Path, new_file: Path, context_lines: int = 3) -> None:
    current = PROJECT_ROOT / rel
    new_text = new_file.read_text(encoding="utf-8").splitlines(keepends=True)
    if current.is_file():
        old_text = current.read_text(encoding="utf-8", errors="replace").splitlines(keepends=True)
        label = "modified"
    else:
        old_text = []
        label = "NEW FILE"
    diff = list(difflib.unified_diff(old_text, new_text, f"a/{rel}", f"b/{rel}", n=context_lines))
    adds = sum(1 for l in diff if l.startswith("+") and not l.startswith("+++"))
    dels = sum(1 for l in diff if l.startswith("-") and not l.startswith("---"))
    print(f"\n  ── {rel}  ({label}, +{adds}/-{dels})")
    if context_lines <= 0:
        return
    for line in diff[:400]:
        print("     " + line.rstrip("\n"))
    if len(diff) > 400:
        print(f"     … {len(diff) - 400} more diff lines")


# -- CLI entry points -------------------------------------------------------


def run(args) -> int:
    task = " ".join(args.task).strip()
    if not task:
        print('Give me a task, e.g.  lf codegen "add a round timer"')
        return 2

    print(f"→ codegen: {task}")
    if args.dry_run:
        use_godot = bool(getattr(args, "godot", False)) or not context.js_available()
        ctx = context.build(include_files=list(args.files) if args.files else None,
                            godot=use_godot)
        print(f"  context ≈ {context.approx_tokens(ctx):,} tokens")
        print("  --dry-run: not calling the API.")
        return 0

    proposal = generate(
        task,
        focus=list(args.files) if args.files else None,
        godot=bool(getattr(args, "godot", False)),
        max_tokens=args.max_tokens,
    )

    if not proposal.ok:
        print(f"\n! The model returned no usable ### FILE blocks. Raw reply:\n    {proposal.out / 'reply.md'}")
        return 1

    print(f"\n  Proposed {len(proposal.files)} file(s) → automation/out/{proposal.slug}/")
    for rel in proposal.files:
        print_diff(rel, proposal.out / rel, args.context_lines)

    if proposal.wiring and proposal.wiring.strip().lower() not in ("none.", "none"):
        print("\n  Wiring needed:")
        for line in proposal.wiring.splitlines():
            print(f"    {line}")

    if args.apply:
        apply_proposal(proposal.out, proposal.files)
    else:
        print(f"\n  Review, then apply with:")
        print(f"    python3 automation/lf.py apply {proposal.slug}")
    return 0


def _proposal_files(out: Path) -> list[Path]:
    return [
        p.relative_to(out)
        for p in sorted(out.rglob("*"))
        if p.is_file() and p.suffix in APPLICABLE and "_backup" not in p.parts
    ]


def run_apply(args) -> int:
    out = OUT_DIR / args.slug
    if not out.is_dir():
        print(f"No proposal at automation/out/{args.slug}")
        if OUT_DIR.is_dir():
            existing = sorted(p.name for p in OUT_DIR.iterdir() if p.is_dir())
            if existing:
                print("  Available: " + ", ".join(existing[-10:]))
        return 1
    files = _proposal_files(out)
    if not files:
        print("Nothing applicable in that proposal.")
        return 1
    apply_proposal(out, files)
    print("  Undo with: python3 automation/lf.py revert " + args.slug)
    return 0


def run_revert(args) -> int:
    out = OUT_DIR / args.slug
    if not out.is_dir():
        print(f"No proposal at automation/out/{args.slug}")
        return 1
    return 0 if revert_proposal(out) else 1
