"""`lf build` — the API builds the game, gated by the tests.

This is the loop that turns codegen from "propose a patch" into something that
actually ships features:

    pick the next roadmap item
      -> ask the model for the change
      -> apply it
      -> run the headless tests
      -> pass: keep it, mark the item done
         fail: send the failure back for one repair pass, re-test
               still failing: revert everything, mark the item blocked

The tests are the whole point. Without them an autonomous loop quietly rots the
codebase; with them, a change that breaks the fighter is undone within seconds
and the reason is recorded on the roadmap item.

    lf roadmap                 what's left
    lf build                   build the next item, stop for review
    lf build --auto --max 3    build up to three, keeping whatever passes
"""

from __future__ import annotations

import json
import subprocess
from datetime import datetime
from pathlib import Path

from . import cmd_codegen, context
from .azure_client import AzureClient
from .config import AUTOMATION_DIR, PROJECT_ROOT

ROADMAP = AUTOMATION_DIR / "roadmap.json"
JS_ROOT = PROJECT_ROOT / "little-fighters-js"

STATUS_MARK = {"pending": " ", "done": "✓", "blocked": "✗", "skipped": "–"}


# -- roadmap ----------------------------------------------------------------


def load_roadmap() -> dict:
    if not ROADMAP.is_file():
        return {"items": []}
    try:
        data = json.loads(ROADMAP.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"items": []}
    data.setdefault("items", [])
    return data


def save_roadmap(data: dict) -> None:
    ROADMAP.parent.mkdir(parents=True, exist_ok=True)
    ROADMAP.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def run_roadmap(args) -> int:
    data = load_roadmap()
    items = data["items"]

    action = getattr(args, "roadmap_action", None)

    if action == "add":
        title = " ".join(args.title).strip()
        if not title:
            print("Give the item a title.")
            return 2
        new_id = max((i["id"] for i in items), default=0) + 1
        items.append({
            "id": new_id, "title": title, "detail": args.detail or "",
            "files": args.files or [], "status": "pending", "note": "",
        })
        save_roadmap(data)
        print(f"  added #{new_id}: {title}")
        return 0

    if action in ("done", "reset", "skip"):
        target = {"done": "done", "reset": "pending", "skip": "skipped"}[action]
        for item in items:
            if item["id"] == args.id:
                item["status"] = target
                item["note"] = "" if target == "pending" else item.get("note", "")
                save_roadmap(data)
                print(f"  #{item['id']} -> {target}")
                return 0
        print(f"  no item #{args.id}")
        return 1

    # default: list
    if not items:
        print("Roadmap is empty. Add one with:")
        print('  python3 automation/lf.py roadmap add "add a round timer"')
        return 0

    counts = {}
    print("Roadmap")
    print("=" * 66)
    for item in items:
        counts[item["status"]] = counts.get(item["status"], 0) + 1
        mark = STATUS_MARK.get(item["status"], "?")
        print(f"  [{mark}] #{item['id']:<3} {item['title']}")
        if item.get("note"):
            print(f"          ↳ {item['note']}")
    done = counts.get("done", 0)
    print(f"\n  {done}/{len(items)} done" + "".join(
        f" · {n} {s}" for s, n in sorted(counts.items()) if s != "done"))
    return 0


# -- the test gate ----------------------------------------------------------


def tests_available() -> tuple[bool, str]:
    if not JS_ROOT.is_dir():
        return False, "little-fighters-js/ not found"
    if not (JS_ROOT / "node_modules" / "three").is_dir():
        return False, "dependencies not installed — run `npm install` in little-fighters-js/"
    if not (JS_ROOT / "tools" / "fighter.test.mjs").is_file():
        return False, "tools/fighter.test.mjs missing"
    return True, ""


def run_tests(timeout: int = 180) -> tuple[bool, str]:
    """Run the headless suite. Returns (passed, output)."""
    try:
        proc = subprocess.run(
            ["npm", "test", "--silent"],
            cwd=JS_ROOT, capture_output=True, text=True, timeout=timeout,
        )
    except FileNotFoundError:
        return False, "npm not found on PATH"
    except subprocess.TimeoutExpired:
        return False, f"tests timed out after {timeout}s"

    output = (proc.stdout + "\n" + proc.stderr).strip()
    return proc.returncode == 0, output


def _test_summary(output: str) -> str:
    for line in output.splitlines():
        if line.startswith("# pass ") or line.startswith("# fail "):
            continue
    passed = next((l for l in output.splitlines() if l.startswith("# pass ")), "")
    failed = next((l for l in output.splitlines() if l.startswith("# fail ")), "")
    return f"{passed.strip()} {failed.strip()}".strip() or "no summary"


def _failure_excerpt(output: str, limit: int = 2500) -> str:
    """The part of the test output worth sending back to the model."""
    lines = output.splitlines()
    keep = []
    for i, line in enumerate(lines):
        if line.startswith("not ok ") or "AssertionError" in line or "Error:" in line:
            keep.extend(lines[max(0, i - 2): i + 14])
    text = "\n".join(keep) if keep else output
    return text[-limit:]


# -- the build loop ---------------------------------------------------------

REPAIR_PROMPT = """Your change was applied and the project's headless tests now FAIL.

Test output:
```
{errors}
```

Return the COMPLETE corrected files in the same ### FILE format. Fix the cause,
do not weaken or delete a test to make it pass. If the test itself is genuinely
wrong because the behaviour changed on purpose, update the test and explain why
in ### PLAN.
"""


def _next_item(items, wanted_id=None):
    if wanted_id is not None:
        return next((i for i in items if i["id"] == wanted_id), None)
    return next((i for i in items if i["status"] == "pending"), None)


def _build_one(item, args, client) -> str:
    """Returns the item's new status."""
    task = item["title"]
    if item.get("detail"):
        task += "\n\n" + item["detail"]

    print(f"\n{'=' * 66}")
    print(f"#{item['id']}  {item['title']}")
    print("=" * 66)

    proposal = cmd_codegen.generate(
        task,
        focus=item.get("files") or None,
        max_tokens=args.max_tokens,
        client=client,
    )
    if not proposal.ok:
        item["note"] = "model returned no usable file blocks"
        print(f"  ! {item['note']}")
        return "blocked"

    if proposal.plan:
        first = proposal.plan.strip().splitlines()[0]
        print(f"  plan: {first[:150]}")
    print(f"  files: {', '.join(str(f) for f in proposal.files)}")

    cmd_codegen.apply_proposal(proposal.out, proposal.files, quiet=True)
    print(f"  applied {len(proposal.files)} file(s)")

    for attempt in range(args.repair + 1):
        print("  running tests…", end=" ", flush=True)
        passed, output = run_tests()
        if passed:
            print(f"PASS  ({_test_summary(output)})")
            item["note"] = (proposal.plan.strip().splitlines() or [""])[0][:200]
            if proposal.wiring and proposal.wiring.strip().lower() not in ("none.", "none"):
                print("  wiring needed:")
                for line in proposal.wiring.splitlines():
                    print(f"    {line}")
            return "done"

        print(f"FAIL  ({_test_summary(output)})")
        if attempt >= args.repair:
            break

        print(f"  sending the failure back for a repair pass ({attempt + 1}/{args.repair})…")
        repair_task = task + "\n\n" + REPAIR_PROMPT.format(errors=_failure_excerpt(output))
        fix = cmd_codegen.generate(
            repair_task,
            focus=[str(f) for f in proposal.files] or None,
            max_tokens=args.max_tokens,
            client=client,
            quiet=True,
        )
        if not fix.ok:
            print("  ! repair returned nothing usable")
            break
        cmd_codegen.apply_proposal(fix.out, fix.files, quiet=True)
        proposal = fix

    print("  reverting — the tests must stay green.")
    cmd_codegen.revert_proposal(proposal.out, quiet=True)
    item["note"] = f"tests failed: {_test_summary(output)}"
    return "blocked"


def run_build(args) -> int:
    if not context.js_available():
        print("  ! little-fighters-js/ not found — nothing to build against.")
        return 1

    ok, why = tests_available()
    if not ok:
        print(f"  ! Cannot run the test gate: {why}")
        print("    Building without it would let a bad change sit in your tree unnoticed.")
        print("    Fix that first, or pass --no-gate to build anyway (not recommended).")
        if not args.no_gate:
            return 1

    data = load_roadmap()
    items = data["items"]
    if not items:
        print("Roadmap is empty — nothing to build.")
        return 1

    # A dirty tree is survivable (revert is manifest-based, not git-based),
    # but a commit first makes any surprise trivial to undo.
    dirty = subprocess.run(["git", "status", "--porcelain"], cwd=PROJECT_ROOT,
                           capture_output=True, text=True)
    if dirty.returncode == 0 and dirty.stdout.strip():
        print("  note: you have uncommitted changes. A commit first makes this")
        print("        easy to unwind if you dislike what gets built.\n")

    client = AzureClient()
    built = 0
    limit = args.max if args.auto else 1

    while built < limit:
        item = _next_item(items, args.item if built == 0 else None)
        if item is None:
            print("\nNothing pending on the roadmap." if built else "\nNo pending items.")
            break
        if item["status"] != "pending" and args.item is None:
            break

        item["status"] = _build_one(item, args, client)
        save_roadmap(data)
        built += 1

        if item["status"] == "blocked" and not args.keep_going:
            print("\n  Stopping on a blocked item. Pass --keep-going to continue past it.")
            break
        if args.item is not None:
            break

    done = sum(1 for i in items if i["status"] == "done")
    print(f"\n{'=' * 66}")
    print(f"  {built} item(s) attempted · {done}/{len(items)} roadmap items done")
    print(f"  Review: git diff   ·   Undo everything: git checkout -- .")
    return 0
