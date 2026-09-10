"""`lf bisect` — find the exact piece of a request the endpoint refuses.

Everything measurable has now been ruled out. A 3,965-token codegen request is
refused on a deployment with 500,000 TPM, while an 8,770-token request with the
same shape and parameters was accepted, and a one-line request always works. So
the deciding factor is what is IN the request, not how big it is.

This builds the real codegen prompt one component at a time and sends each
version. The first addition that gets the connection dropped is the culprit.
Refused requests are not billed, so only the accepted prefixes cost anything —
typically a few cents for the whole run.

    python3 automation/lf.py bisect --item 3
"""

from __future__ import annotations

import http.client
import json
import urllib.error
from pathlib import Path

from .azure_client import AzureClient
from .config import PROJECT_ROOT
from . import context
from . import usage as usage_mod

TAIL = "\n\nReply with exactly: OK"


def _describe(exc: Exception) -> str:
    if isinstance(exc, urllib.error.HTTPError):
        try:
            body = exc.read().decode("utf-8", "replace")[:300]
        except Exception:
            body = ""
        return f"HTTP {exc.code} {body}"
    return type(exc).__name__


def _send(client: AzureClient, system: str | None, user: str, max_out: int):
    msgs = []
    if system:
        msgs.append({"role": "system", "content": system})
    msgs.append({"role": "user", "content": user})
    body = {"model": client.cfg.model, "input": msgs, "max_output_tokens": max_out}
    client._strip_known_bad(body)
    try:
        data = client._post(body)
    except (urllib.error.HTTPError, urllib.error.URLError,
            http.client.HTTPException, ConnectionError, TimeoutError, OSError) as exc:
        return False, _describe(exc)
    usage_mod.record(data.get("model") or client.cfg.model, "bisect",
                     data.get("usage") or {})
    return True, "accepted"


def run(args) -> int:
    from .cmd_build import load_roadmap
    from .cmd_codegen import SYSTEM_JS

    item = next((i for i in load_roadmap()["items"] if i["id"] == args.item), None)
    if item is None:
        print(f"No roadmap item #{args.item}")
        return 1

    files = item.get("files") or context.JS_SOURCES[:3]
    task = item["title"] + ("\n\n" + item.get("detail", "") if item.get("detail") else "")

    client = AzureClient(quiet=True)
    client.cfg.require_key()

    print(f"Bisecting the request for #{item['id']}  {item['title']}")
    print(f"  {client.cfg.model} · {len(files)} files · one attempt per step")
    print("=" * 74)

    # Each step ADDS one component to the previous user text.
    steps: list[tuple[str, str]] = []
    running = f"# Task\n{task}\n"
    steps.append(("task text only", running + TAIL))

    tree = "## Project layout\n" + context.file_tree(context.JS_ROOT)
    running += "\n" + tree
    steps.append(("+ project layout", running + TAIL))

    mapping = context.project_map()
    if mapping:
        running += "\n\n" + mapping
        steps.append(("+ project map (every filename)", running + TAIL))

    for rel in files:
        body = context.read(rel)
        if body is None:
            continue
        running += f"\n\n## {rel}\n```javascript\n{body}\n```"
        steps.append((f"+ {rel}", running + TAIL))

    culprit = None
    for label, user in steps:
        est = (len(SYSTEM_JS) + len(user)) // 4
        ok, detail = _send(client, SYSTEM_JS, user, args.max_out)
        mark = "OK  " if ok else "FAIL"
        print(f"  [{mark}] {label:<52} ~{est:>6,} tok")
        if not ok:
            print(f"         {detail}")
            culprit = label
            break

    print("\n" + "=" * 74)
    if culprit is None:
        print("  The whole request was accepted this time.")
        print("  That makes the failure intermittent rather than content-driven —")
        print("  retries are then the right answer, not a smaller prompt.")
        return 0

    print(f"  First refusal on: {culprit}")
    if culprit.startswith("+ "):
        target = culprit[2:]
        p = PROJECT_ROOT / target
        if p.is_file():
            print(f"\n  So the endpoint refuses a request once {target} is in it.")
            print("  That is a content judgement, not a size one. Most likely the")
            print("  content filter (Guardrails) on the deployment. Options:")
            print("    · Azure AI Foundry -> your deployment -> Guardrails -> a more")
            print("      permissive filter, or a custom one with lower thresholds")
            print(f"    · or exclude {target} from that item's \"files\" in roadmap.json")
        else:
            print("\n  The failure appears once the project structure is described,")
            print("  before any source is included — look at the filenames themselves.")
    else:
        print("\n  It fails before any project content is added, so the task text or")
        print("  the system prompt is what the endpoint objects to.")
    return 1
