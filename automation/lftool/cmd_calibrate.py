"""`lf calibrate` — measure this deployment's real request limits, once.

Everything before this inferred the ceiling from failure logs, which produced
three wrong diagnoses in a row. This runs a proper experiment instead: for
several prompt sizes, find the largest output allowance the endpoint actually
accepts, then work out whether the constraint is on the output alone or on
input and output combined. The answer is written to endpoint_caps.json and
every later call is sized from it.

Rejected requests cost nothing — the endpoint drops them before billing — so
the price of this is only the handful of calls that succeed, typically well
under a dollar.
"""

from __future__ import annotations

import http.client
import json
import urllib.error

from .azure_client import (AzureClient, CANARY_THRESHOLD_BYTES, extract_text,
                           remember_limit)
from . import usage as usage_mod

# Prompt sizes to test, in approximate tokens.
INPUT_SIZES = [4000, 12000, 20000]

# Output allowances to try, largest first — the first that works is the ceiling
# for that prompt size.
OUTPUT_STEPS = [64000, 48000, 32000, 24000, 16000, 12000, 8000, 4000, 2000]

FILLER = ("// calibration padding; ordinary-looking source text\n"
          "function sample(a, b) { return a + b; }\n")


def _prompt(approx_tokens: int) -> str:
    reps = max(1, (approx_tokens * 4) // len(FILLER))
    return ("Ignore the following code entirely.\n\n" + FILLER * reps
            + "\n\nReply with exactly: OK")


def _try(client: AzureClient, prompt: str, max_out: int) -> tuple[bool, str]:
    body = {
        "model": client.cfg.model,
        "input": [{"role": "user", "content": prompt}],
        "max_output_tokens": max_out,
    }
    try:
        data = client._post(body)
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}"
    except (http.client.HTTPException, ConnectionError, TimeoutError,
            urllib.error.URLError, OSError) as e:
        return False, type(e).__name__
    rec = usage_mod.record(data.get("model") or client.cfg.model, "calibrate",
                           data.get("usage") or {})
    return True, f"{rec['input_tokens']:,} in / {rec['output_tokens']:,} out"


def run(args) -> int:
    client = AzureClient(quiet=True)
    client.cfg.require_key()

    # Already measured? Don't spend the tokens again.
    from .azure_client import load_caps
    existing = (load_caps().get(client.cfg.model) or {}).get("limits") or {}
    if existing and not args.force:
        print(f"Already calibrated for {client.cfg.model}:")
        for k, v in existing.items():
            print(f"  {k}: {v:,}")
        print("\n  Every call is sized from this. Re-measure with --force")
        print("  (worth doing if Azure changes the deployment).")
        return 0

    print("Calibrating this deployment's request limits")
    print(f"  {client.cfg.model} @ {client.cfg.endpoint}")
    print("  Refused requests are free; only the accepted ones cost tokens.")
    print("=" * 72)

    results: list[tuple[int, int | None]] = []

    for size in INPUT_SIZES:
        prompt = _prompt(size)
        est_in = len(prompt) // 4
        print(f"\n  prompt ≈ {est_in:,} tokens")
        found = None
        for max_out in OUTPUT_STEPS:
            if est_in + max_out > 200_000:
                continue
            ok, detail = _try(client, prompt, max_out)
            mark = "✓" if ok else "✗"
            print(f"    {mark} max_output {max_out:>6,}  ->  "
                  f"{detail if ok else 'refused (' + detail + ')'}")
            if ok:
                found = max_out
                break
        results.append((est_in, found))
        if found is None:
            print(f"    ! nothing worked at this prompt size")

    print("\n" + "=" * 72)
    usable = [(i, o) for i, o in results if o]
    if not usable:
        print("  Every combination was refused. This is not about sizing —")
        print("  check the key and the deployment with `lf doctor`.")
        return 1

    # A fresh measurement supersedes anything inferred earlier. Leaving a stale
    # limit in place lets a disproved guess keep throttling every request.
    from .azure_client import load_caps, CAPS_PATH
    caps = load_caps()
    prior = (caps.get(client.cfg.model) or {}).get("limits") or {}
    if prior:
        caps[client.cfg.model]["limits"] = {}
        CAPS_PATH.write_text(json.dumps(caps, indent=2) + "\n", encoding="utf-8")
        print(f"  (cleared previously recorded limits: {prior})")

    outs = [o for _, o in usable]
    totals = [i + o for i, o in usable]
    out_spread = max(outs) - min(outs)
    total_spread = max(totals) - min(totals)

    print("  measurements:")
    for i, o in usable:
        print(f"    {i:>7,} input  +  {o:>6,} output  =  {i + o:>7,} combined")

    if out_spread <= min(outs) * 0.25 and total_spread > out_spread:
        # Output allowance barely moved with prompt size -> it's an output cap.
        ceiling = min(outs)
        remember_limit(client.cfg.model, "max_output_tokens", ceiling,
                       "measured by lf calibrate: output allowance is capped "
                       "independently of prompt size")
        print(f"\n  Conclusion: an OUTPUT ceiling of about {ceiling:,} tokens,")
        print("  independent of how big the prompt is. Recorded.")
    else:
        budget = min(totals)
        remember_limit(client.cfg.model, "total_tokens", budget,
                       "measured by lf calibrate: input + max_output_tokens the "
                       "endpoint accepts")
        print(f"\n  Conclusion: a COMBINED limit of about {budget:,} tokens")
        print("  (input + max_output_tokens). Recorded — every later call will")
        print("  size its output allowance to fit under it.")

    spend = usage_mod.load_usage()["by_command"].get("calibrate", {})
    if spend.get("calls"):
        print(f"\n  This calibration: {spend['calls']} accepted calls, "
              f"{spend['total_tokens']:,} tokens, ${spend['cost_usd']:.4f}")
    return 0
