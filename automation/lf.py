#!/usr/bin/env python3
"""Little Fighters — Azure GPT automation CLI.

    python3 automation/lf.py <command> [options]

Every command that talks to the model prints its token usage and cost on one
line, and folds it into the running total in automation/usage.json.

    doctor                     check endpoint, key and model with one tiny call
    usage [--reset] [--game]   show the running total
    price MODEL --in X --out Y set USD per 1M tokens for cost accounting

    codegen "task"             propose GDScript changes for review
    apply SLUG                 apply a reviewed proposal

    assets scan                what clips the game wants vs. what's on disk
    assets convert [--run]     headless Blender FBX -> single-clip GLB
    assets wire [--apply]      rebuild Fighter.gd's external_animations

    blender "description"      generate a 3D asset with Blender + GPT
    opponent install|key|policy  the in-game LLM opponent
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lftool import (cmd_assets, cmd_blender, cmd_build, cmd_codegen,  # noqa: E402
                    cmd_bisect, cmd_calibrate, cmd_models, cmd_opponent,
                    cmd_probe)
from lftool import usage as usage_mod  # noqa: E402
from lftool.azure_client import AzureClient, AzureError  # noqa: E402
from lftool.config import PROJECT_ROOT, Config  # noqa: E402


# -- doctor -----------------------------------------------------------------


def cmd_doctor(args) -> int:
    cfg = Config()
    print("Little Fighters automation — doctor")
    print("=" * 62)
    print(f"  project    {PROJECT_ROOT}")
    print(f"  endpoint   {cfg.endpoint}")
    print(f"  model      {cfg.model}")
    print(f"  api key    {cfg.masked_key()}")
    print(f"  mock mode  {'ON (no network calls)' if cfg.mock else 'off'}")

    from lftool.blender_runner import docker_available, find_blender
    native = find_blender(getattr(args, "blender", None))
    print(f"  blender    {native or 'no native install found'}")
    print(f"  docker     {'available' if docker_available() else 'not running'}")

    price = usage_mod.price_for(cfg.model)
    if price:
        print(f"  pricing    ${price['input_per_1m']}/1M in · ${price['output_per_1m']}/1M out")
    else:
        print(f"  pricing    not set for '{cfg.model}' — tokens counted, cost not")

    if not cfg.key_present and not cfg.mock:
        print("\n  ! No API key. Create a .env at the project root:")
        print("        AZURE_OPENAI_API_KEY=your-key-here")
        return 1

    print("\n  Sending a 1-sentence test request…")
    try:
        reply = AzureClient().respond(
            "Reply with exactly: Little Fighters automation is online.",
            command="doctor", max_output_tokens=2000, temperature=None,
        )
    except AzureError as exc:
        print(f"\n  ✗ {exc}")
        return 1
    print(f"\n  ✓ Model replied: {reply.strip()[:200]}")
    return 0


# -- usage ------------------------------------------------------------------


def cmd_usage(args) -> int:
    if args.reset:
        usage_mod.reset_usage()
        print("Running total cleared.")
        return 0

    print(usage_mod.format_report())

    if args.game:
        user_dir = cmd_opponent._godot_user_dir()
        game_file = (user_dir / "azure_usage.json") if user_dir else None
        print("\nIn-game opponent")
        print("-" * 62)
        shared = usage_mod.load_usage().get("by_command", {}).get("game")
        if shared:
            cost = f"${shared['cost_usd']:,.4f}" if not shared["unpriced_calls"] else "unpriced"
            print(f"  The three.js game writes into this same ledger, under \"game\":")
            print(f"    {shared['calls']:,} calls · {shared['total_tokens']:,} tokens · {cost}")
        else:
            print("  The three.js game has not called the model yet.")
        print("\n  Legacy Godot build (separate file, only if you still run it):")
        if game_file and game_file.is_file():
            try:
                g = json.loads(game_file.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError) as exc:
                print(f"  could not read {game_file}: {exc}")
                return 0
            cost = f"${float(g.get('cost_usd', 0.0)):,.4f}" if g.get("priced") else "unpriced"
            print(f"  calls        {int(g.get('calls', 0)):,}")
            print(f"  input        {int(g.get('input_tokens', 0)):,} tokens")
            print(f"  output       {int(g.get('output_tokens', 0)):,} tokens")
            print(f"  total        {int(g.get('total_tokens', 0)):,} tokens")
            print(f"  cost         {cost}")
            print(f"\n  source: {game_file}")
        else:
            print("  No in-game usage recorded yet.")
            print(f"  (looked in {game_file})")
    return 0


def cmd_price(args) -> int:
    usage_mod.set_price(args.model, args.input_per_m, args.output_per_m, args.cached_per_m)
    print(f"  {args.model}: ${args.input_per_m}/1M input · ${args.output_per_m}/1M output"
          + (f" · ${args.cached_per_m}/1M cached input" if args.cached_per_m is not None else ""))
    print(f"  Saved to automation/pricing.json")

    if args.no_recompute:
        print("  Existing calls left as they were (--no-recompute).")
        return 0

    calls, total = usage_mod.recompute_costs(args.model)
    if calls:
        print(f"\n  Repriced {calls} previously-unpriced call(s) from their stored")
        print(f"  token counts — the tokens were always exact, only the rate was missing.")
        print(f"  Everything spent so far: ${total:,.4f}")
    return 0


# -- parser -----------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="lf",
        description="Azure GPT automation for the Little Fighters Godot project.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    sub = p.add_subparsers(dest="command", required=True)

    d = sub.add_parser("doctor", help="check endpoint, key and model")
    d.add_argument("--blender", help="path to the Blender executable or .app")
    d.set_defaults(func=cmd_doctor)

    bi = sub.add_parser("bisect",
                        help="find which part of a request the endpoint refuses")
    bi.add_argument("--item", type=int, default=3, help="roadmap item to rebuild")
    bi.add_argument("--max-out", type=int, default=8000)
    bi.set_defaults(func=cmd_bisect.run)

    cal = sub.add_parser("calibrate",
                         help="measure the deployment's real request limits and record them")
    cal.add_argument("--force", action="store_true",
                     help="re-measure even though limits are already recorded")
    cal.set_defaults(func=cmd_calibrate.run)

    md = sub.add_parser("models", help="ask the endpoint which model is deployed")
    md.set_defaults(func=cmd_models.run)

    pb = sub.add_parser("probe", help="find which part of a request the endpoint rejects")
    pb.add_argument("--stop-on-first", action="store_true",
                    help="stop at the first failing case instead of trying them all")
    pb.set_defaults(func=cmd_probe.run)

    ps = sub.add_parser("probe-shape",
                        help="test which request shape (system/developer/merged) is accepted")
    ps.add_argument("--max-out", type=int, default=32000)
    ps.set_defaults(func=cmd_probe.run_shape)

    u = sub.add_parser("usage", help="show the running token/cost total")
    u.add_argument("--reset", action="store_true", help="clear the running total")
    u.add_argument("--game", action="store_true",
                   help="also show the in-game opponent's counters")
    u.set_defaults(func=cmd_usage)

    pr = sub.add_parser("price", help="set USD per 1M tokens for a model")
    pr.add_argument("model")
    pr.add_argument("--in", dest="input_per_m", type=float, required=True,
                    help="USD per 1M input tokens")
    pr.add_argument("--out", dest="output_per_m", type=float, required=True,
                    help="USD per 1M output tokens")
    pr.add_argument("--cached", dest="cached_per_m", type=float, default=None,
                    help="USD per 1M cached input tokens, if your deployment discounts them")
    pr.add_argument("--no-recompute", action="store_true",
                    help="leave already-recorded calls unpriced instead of costing them")
    pr.set_defaults(func=cmd_price)

    c = sub.add_parser("codegen", help="propose GDScript changes for review")
    c.add_argument("task", nargs="+", help="what to build, in plain English")
    c.add_argument("--files", nargs="*", default=None,
                   help="limit the context to these files (relative paths)")
    c.add_argument("--godot", action="store_true",
                   help="target the original GDScript instead of the JS game")
    c.add_argument("--apply", action="store_true", help="apply immediately after generating")
    c.add_argument("--no-scenes", action="store_true", help="omit .tscn files from the context")
    c.add_argument("--max-tokens", type=int, default=32000)
    c.add_argument("--context-lines", type=int, default=3,
                   help="diff context lines to print (0 = summary only)")
    c.add_argument("--dry-run", action="store_true", help="build the prompt but do not call the API")
    c.set_defaults(func=cmd_codegen.run)

    a = sub.add_parser("apply", help="apply a reviewed proposal from automation/out/")
    a.add_argument("slug")
    a.set_defaults(func=cmd_codegen.run_apply)

    rv = sub.add_parser("revert", help="undo an applied proposal")
    rv.add_argument("slug")
    rv.set_defaults(func=cmd_codegen.run_revert)

    # -- the autonomous build loop --------------------------------------
    rm = sub.add_parser("roadmap", help="the backlog `build` works through")
    rmsub = rm.add_subparsers(dest="roadmap_action")
    rm.set_defaults(func=cmd_build.run_roadmap, roadmap_action=None)

    rma = rmsub.add_parser("add", help="add an item")
    rma.add_argument("title", nargs="+")
    rma.add_argument("--detail", help="a fuller description for the model")
    rma.add_argument("--files", nargs="*", help="limit the context to these files")
    rma.set_defaults(func=cmd_build.run_roadmap, roadmap_action="add")

    for name, helptext in (("done", "mark an item done"),
                           ("reset", "put an item back to pending"),
                           ("skip", "skip an item")):
        sp = rmsub.add_parser(name, help=helptext)
        sp.add_argument("id", type=int)
        sp.set_defaults(func=cmd_build.run_roadmap, roadmap_action=name)

    bd = sub.add_parser("build", help="have the model build the next roadmap item")
    bd.add_argument("--item", type=int, default=None, help="build this item by id")
    bd.add_argument("--auto", action="store_true",
                    help="keep going through pending items instead of stopping after one")
    bd.add_argument("--max", type=int, default=3, help="with --auto, how many items at most")
    bd.add_argument("--repair", type=int, default=1,
                    help="how many times to send failing tests back for a fix (default 1)")
    bd.add_argument("--retry-blocked", action="store_true",
                    help="also re-attempt items that previously failed their tests")
    bd.add_argument("--stop-on-block", action="store_true",
                    help="halt if an item's tests will not pass (default: move on)")
    bd.add_argument("--no-gate", action="store_true",
                    help="build even though the tests cannot run (not recommended)")
    bd.add_argument("--max-tokens", type=int, default=32000)
    bd.set_defaults(func=cmd_build.run_build)

    assets = sub.add_parser("assets", help="the Mixamo -> GLB -> Godot pipeline")
    asub = assets.add_subparsers(dest="assets_command", required=True)

    s = asub.add_parser("scan", help="clips wanted vs. clips on disk (no API call)")
    s.add_argument("--blender", help="path to the Blender executable or .app")
    s.set_defaults(func=cmd_assets.run_scan)

    cv = asub.add_parser("convert", help="FBX -> single-clip GLB via headless Blender")
    cv.add_argument("--run", action="store_true", help="actually run Blender")
    cv.add_argument("--overwrite", action="store_true", help="re-convert files that already have a .glb")
    cv.add_argument("--blender", help="path to the Blender executable or .app")
    cv.add_argument("--docker", action="store_true",
                    help="run Blender in a container instead of natively")
    cv.add_argument("--image", help="docker image (default: blenderkit/headless-blender)")
    cv.set_defaults(func=cmd_assets.run_convert)

    w = asub.add_parser("wire", help="rebuild Fighter.gd's external_animations")
    w.add_argument("--apply", action="store_true", help="write straight to Fighter.gd")
    w.add_argument("--dry-run", action="store_true")
    w.set_defaults(func=cmd_assets.run_wire)

    b = sub.add_parser("blender", help="generate a 3D asset with Blender + GPT")
    b.add_argument("description", nargs="+")
    b.add_argument("--out", help="output path relative to the project, e.g. backgrounds/crate.glb")
    b.add_argument("--run", action="store_true", help="run Blender headless after generating")
    b.add_argument("--repair", type=int, default=2,
                   help="how many times to send a traceback back for a fix (default 2)")
    b.add_argument("--notes", help="extra art direction")
    b.add_argument("--blender", help="path to the Blender executable or .app")
    b.add_argument("--docker", action="store_true",
                   help="run Blender in a container instead of natively")
    b.add_argument("--image", help="docker image (default: blenderkit/headless-blender)")
    b.add_argument("--max-tokens", type=int, default=8000)
    b.add_argument("--dry-run", action="store_true")
    b.set_defaults(func=cmd_blender.run)

    o = sub.add_parser("opponent", help="the in-game LLM opponent")
    osub = o.add_subparsers(dest="opponent_command", required=True)

    oi = osub.add_parser("install", help="patch Fighter.gd with the AI intent hooks")
    oi.set_defaults(func=cmd_opponent.run_install)

    ok = osub.add_parser("key", help="give the running game its credentials")
    ok.add_argument("--price-in", type=float, default=None, help="USD per 1M input tokens")
    ok.add_argument("--price-out", type=float, default=None, help="USD per 1M output tokens")
    ok.set_defaults(func=cmd_opponent.run_key)

    op = osub.add_parser("policy", help="regenerate the opponent's tactics prompt")
    op.add_argument("--notes", help="extra direction for the rewrite")
    op.add_argument("--dry-run", action="store_true")
    op.set_defaults(func=cmd_opponent.run_policy)

    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args) or 0
    except AzureError as exc:
        print(f"\n! {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\ninterrupted", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
