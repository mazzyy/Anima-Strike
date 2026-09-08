"""`lf probe` — find out exactly which part of a request the endpoint rejects.

`doctor` succeeds and `codegen` gets its connection closed. The requests differ
in three ways: body size, max_output_tokens, and whether temperature is sent.
This walks those dimensions one at a time and reports the first thing that
breaks, so the fix is based on a measurement rather than a guess.

Each case asks for a two-word answer, so the output cost is trivial. The large
cases do send real input tokens — a full run is roughly 40k input tokens.
"""

from __future__ import annotations

import http.client
import json
import urllib.error

from .azure_client import AzureClient, extract_text
from . import usage as usage_mod

INSTRUCTION = "Reply with exactly: OK"

# Filler that reads like source code, so the request looks like a real codegen
# call rather than something a content filter might treat as junk.
FILLER_UNIT = (
    "// context padding line for the probe; resembles ordinary source text\n"
    "function sample(a, b) { return a + b; }\n"
)


def _pad(approx_tokens: int) -> str:
    """Roughly `approx_tokens` tokens of innocuous filler (~4 chars/token)."""
    target_chars = approx_tokens * 4
    reps = max(1, target_chars // len(FILLER_UNIT))
    return FILLER_UNIT * reps


CASES = [
    # label,                      pad tokens, max_output, temperature
    ("baseline (what doctor sends)",        0,      2000, None),
    ("temperature=0.2",                     0,      2000, 0.2),
    ("max_output_tokens=8000",              0,      8000, None),
    ("max_output_tokens=16000",             0,     16000, None),
    ("~2k tokens of context",            2000,      2000, None),
    ("~8k tokens of context",            8000,      2000, None),
    ("~16k tokens of context",          16000,      2000, None),
    ("~16k context + 16k max_output",   16000,     16000, 0.2),
]


def _describe(exc: Exception) -> str:
    if isinstance(exc, urllib.error.HTTPError):
        try:
            detail = exc.read().decode("utf-8", "replace")[:300]
        except Exception:
            detail = ""
        return f"HTTP {exc.code}  {detail}"
    if isinstance(exc, urllib.error.URLError):
        return f"URLError: {exc.reason}"
    return f"{type(exc).__name__}: {exc}"


SHAPES = [
    ("user only, no system text",        "none"),
    ("system role + user  (what codegen sends today)", "system"),
    ("developer role + user", "developer"),
    ("system text folded into the user message", "merged"),
]


def _shape_body(model, shape, system_text, user_text, max_out):
    if shape == "none":
        msgs = [{"role": "user", "content": user_text}]
    elif shape == "system":
        msgs = [{"role": "system", "content": system_text},
                {"role": "user", "content": user_text}]
    elif shape == "developer":
        msgs = [{"role": "developer", "content": system_text},
                {"role": "user", "content": user_text}]
    else:
        msgs = [{"role": "user", "content": system_text + "\n\n" + user_text}]
    return {"model": model, "input": msgs, "max_output_tokens": max_out}


def run_shape(args) -> int:
    """Which request SHAPE does this endpoint accept?

    calibrate proved large prompts are fine when sent as a single user message.
    codegen sends a system message alongside and gets dropped. Same size, same
    parameters — so the shape is the remaining variable. This tests it directly
    instead of reasoning about it.
    """
    from .cmd_codegen import SYSTEM_JS
    from . import context

    client = AzureClient(quiet=True)
    client.cfg.require_key()

    user_text = ("Here is the project:\n\n"
                 + context.build(include_files=context.JS_SOURCES[:3])
                 + "\n\nReply with exactly: OK")
    est = (len(SYSTEM_JS) + len(user_text)) // 4

    print("Testing request SHAPES at a realistic codegen size")
    print(f"  ~{est:,} tokens, max_output {args.max_out:,}, one attempt each")
    print("=" * 72)

    results = []
    for label, shape in SHAPES:
        body = _shape_body(client.cfg.model, shape, SYSTEM_JS, user_text, args.max_out)
        client._strip_known_bad(body)
        print(f"\n  {label}")
        try:
            data = client._post(body)
        except (urllib.error.HTTPError, urllib.error.URLError,
                http.client.HTTPException, ConnectionError, TimeoutError, OSError) as exc:
            print(f"    ✗ {_describe(exc)}")
            results.append((label, shape, False))
            continue
        rec = usage_mod.record(data.get("model") or client.cfg.model, "probe", data.get("usage") or {})
        print(f"    ✓ accepted  ({rec['input_tokens']:,} in / {rec['output_tokens']:,} out)")
        results.append((label, shape, True))

    print("\n" + "=" * 72)
    working = [r for r in results if r[2]]
    if not working:
        print("  Every shape was refused — the shape is not the variable.")
        return 1
    if all(r[2] for r in results):
        print("  Every shape was accepted. The earlier failures were not about shape;")
        print("  with the stale size limit removed, codegen may simply work now.")
        return 0

    print("  Accepted:")
    for label, shape, _ in working:
        print(f"    ✓ {label}")
    print("\n  Refused:")
    for label, shape, ok in results:
        if not ok:
            print(f"    ✗ {label}")
    print(f"\n  Switch codegen to the '{working[0][1]}' shape.")
    return 0


def run(args) -> int:
    client = AzureClient(quiet=True)
    client.cfg.require_key()

    print("Probing the endpoint one dimension at a time")
    print(f"  {client.cfg.endpoint}")
    print(f"  model: {client.cfg.model}")
    print("=" * 72)

    first_failure = None
    results = []

    for label, pad_tokens, max_out, temperature in CASES:
        user = INSTRUCTION if not pad_tokens else (
            "Here is some code to ignore completely:\n\n"
            + _pad(pad_tokens)
            + "\n\n" + INSTRUCTION
        )
        body = {
            "model": client.cfg.model,
            "input": [{"role": "user", "content": user}],
            "max_output_tokens": max_out,
        }
        if temperature is not None:
            body["temperature"] = temperature

        size_kb = len(json.dumps(body).encode()) / 1024
        print(f"\n  {label}")
        print(f"    body {size_kb:>7.1f} KB · max_output {max_out} · "
              f"temperature {temperature if temperature is not None else 'omitted'}")

        try:
            data = client._post(body)          # one attempt, no retry/backoff
        except (urllib.error.HTTPError, urllib.error.URLError,
                http.client.HTTPException, ConnectionError, TimeoutError, OSError) as exc:
            reason = _describe(exc)
            print(f"    ✗ FAILED   {reason}")
            results.append((label, False, reason))
            if first_failure is None:
                first_failure = (label, reason, size_kb, max_out, temperature)
            if args.stop_on_first:
                break
            continue

        usage = data.get("usage") or {}
        rec = usage_mod.record(data.get("model") or client.cfg.model, "probe", usage)
        text = extract_text(data).strip().replace("\n", " ")[:40]
        print(f"    ✓ ok       {rec['input_tokens']:,} in / {rec['output_tokens']:,} out"
              f"   reply: {text!r}")
        results.append((label, True, ""))

    print("\n" + "=" * 72)
    passed = [r for r in results if r[1]]
    print(f"  {len(passed)}/{len(results)} cases succeeded")

    if first_failure is None:
        print("\n  Everything passed. The earlier failure was transient after all —")
        print("  the retry logic added to azure_client should now ride it out.")
        return 0

    label, reason, size_kb, max_out, temperature = first_failure
    print(f"\n  First failure: {label}")
    print(f"    {reason}")
    print("\n  What that points at:")
    if "context" in label and max_out <= 2000:
        print(f"    Request size. The endpoint accepts small bodies but drops this one")
        print(f"    ({size_kb:.0f} KB). Narrow every roadmap item with a \"files\" list, and")
        print(f"    keep codegen calls to a handful of files with --files.")
    elif "max_output_tokens" in label:
        print(f"    max_output_tokens={max_out} is above what this deployment accepts.")
        print(f"    Lower the default: pass --max-tokens 4000 to codegen/build.")
    elif "temperature" in label:
        print("    This deployment rejects the temperature parameter — common on")
        print("    reasoning models. It should be dropped from every request.")
    else:
        print("    The smallest possible request already fails, so this is not about")
        print("    size or parameters — check the key, the deployment name, and whether")
        print("    anything on this network intercepts TLS.")
    return 1
