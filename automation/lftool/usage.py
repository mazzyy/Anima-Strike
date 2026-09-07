"""Running total of tokens and cost.

Deliberately minimal: one JSON file holding cumulative counters, plus a single
line printed after every model call. No per-call log, no database.

    automation/usage.json

Pricing lives in automation/pricing.json as USD per 1,000,000 tokens. If the
deployed model has no price entry, tokens are still counted exactly and the
cost is reported as unknown rather than guessed.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import AUTOMATION_DIR

USAGE_PATH = AUTOMATION_DIR / "usage.json"
PRICING_PATH = AUTOMATION_DIR / "pricing.json"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _blank_bucket() -> dict[str, Any]:
    return {
        "calls": 0,
        "input_tokens": 0,
        "cached_input_tokens": 0,
        "output_tokens": 0,
        "reasoning_tokens": 0,
        "total_tokens": 0,
        "cost_usd": 0.0,
        "unpriced_calls": 0,
    }


def _add(bucket: dict[str, Any], rec: dict[str, Any]) -> None:
    bucket["calls"] += 1
    bucket["input_tokens"] += rec["input_tokens"]
    bucket["cached_input_tokens"] += rec["cached_input_tokens"]
    bucket["output_tokens"] += rec["output_tokens"]
    bucket["reasoning_tokens"] += rec["reasoning_tokens"]
    bucket["total_tokens"] += rec["total_tokens"]
    if rec["cost_usd"] is None:
        bucket["unpriced_calls"] += 1
    else:
        bucket["cost_usd"] = round(bucket["cost_usd"] + rec["cost_usd"], 6)


def load_pricing() -> dict[str, Any]:
    if not PRICING_PATH.is_file():
        return {}
    try:
        return json.loads(PRICING_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def save_pricing(data: dict[str, Any]) -> None:
    PRICING_PATH.parent.mkdir(parents=True, exist_ok=True)
    PRICING_PATH.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def set_price(model: str, input_per_m: float, output_per_m: float,
              cached_input_per_m: float | None = None) -> None:
    data = load_pricing()
    models = data.setdefault("models", {})
    entry = {"input_per_1m": input_per_m, "output_per_1m": output_per_m}
    if cached_input_per_m is not None:
        entry["cached_input_per_1m"] = cached_input_per_m
    models[model] = entry
    save_pricing(data)


def price_for(model: str) -> dict[str, float] | None:
    models = load_pricing().get("models", {})
    entry = models.get(model)
    if entry is None:
        # tolerate deployment names like "gpt-6-astra-eu2" or "my-gpt-4o"
        for name, val in models.items():
            if name and (model.startswith(name) or name in model):
                entry = val
                break
    if not isinstance(entry, dict):
        return None
    if entry.get("input_per_1m") is None or entry.get("output_per_1m") is None:
        return None
    return entry


def compute_cost(model: str, input_tokens: int, cached_input_tokens: int,
                 output_tokens: int) -> float | None:
    p = price_for(model)
    if p is None:
        return None
    fresh_in = max(input_tokens - cached_input_tokens, 0)
    cached_rate = p.get("cached_input_per_1m", p["input_per_1m"])
    cost = (
        fresh_in * p["input_per_1m"]
        + cached_input_tokens * cached_rate
        + output_tokens * p["output_per_1m"]
    ) / 1_000_000.0
    return round(cost, 6)


def load_usage() -> dict[str, Any]:
    if not USAGE_PATH.is_file():
        return {
            "first_call": None,
            "last_call": None,
            "totals": _blank_bucket(),
            "by_command": {},
            "by_model": {},
        }
    try:
        data = json.loads(USAGE_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        # Corrupt ledger: keep the bad file aside rather than losing the run.
        try:
            USAGE_PATH.rename(USAGE_PATH.with_suffix(".json.corrupt"))
        except OSError:
            pass
        data = {}
    if not isinstance(data, dict):
        data = {}
    data.setdefault("first_call", None)
    data.setdefault("last_call", None)
    data.setdefault("totals", _blank_bucket())
    data.setdefault("by_command", {})
    data.setdefault("by_model", {})
    return data


def save_usage(data: dict[str, Any]) -> None:
    USAGE_PATH.parent.mkdir(parents=True, exist_ok=True)
    USAGE_PATH.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def reset_usage() -> None:
    """Zero the running total. Writes a blank ledger rather than deleting the
    file, so it works on read-restricted or synced folders too."""
    save_usage({
        "first_call": None,
        "last_call": None,
        "totals": _blank_bucket(),
        "by_command": {},
        "by_model": {},
    })


# Session totals live in memory only, so one CLI invocation can report itself.
SESSION = _blank_bucket()


def record(model: str, command: str, raw_usage: dict[str, Any],
           persist: bool = True) -> dict[str, Any]:
    """Fold one API call into the running totals. Returns the per-call record.

    persist=False (mock runs) still reports the call but keeps it out of the
    ledger, so a dry test never inflates what the project actually cost."""
    input_tokens = int(raw_usage.get("input_tokens", raw_usage.get("prompt_tokens", 0)) or 0)
    output_tokens = int(raw_usage.get("output_tokens", raw_usage.get("completion_tokens", 0)) or 0)
    total_tokens = int(raw_usage.get("total_tokens", input_tokens + output_tokens) or 0)
    cached = int((raw_usage.get("input_tokens_details") or {}).get("cached_tokens", 0) or 0)
    reasoning = int((raw_usage.get("output_tokens_details") or {}).get("reasoning_tokens", 0) or 0)

    rec = {
        "model": model,
        "command": command,
        "input_tokens": input_tokens,
        "cached_input_tokens": cached,
        "output_tokens": output_tokens,
        "reasoning_tokens": reasoning,
        "total_tokens": total_tokens,
        "cost_usd": compute_cost(model, input_tokens, cached, output_tokens),
        "at": _now(),
    }

    rec["persisted"] = persist
    if persist:
        data = load_usage()
        if data.get("first_call") is None:
            data["first_call"] = rec["at"]
        data["last_call"] = rec["at"]
        _add(data["totals"], rec)
        _add(data["by_command"].setdefault(command, _blank_bucket()), rec)
        _add(data["by_model"].setdefault(model, _blank_bucket()), rec)
        save_usage(data)

    _add(SESSION, rec)
    return rec


def _money(v: float | None) -> str:
    if v is None:
        return "n/a"
    return f"${v:,.4f}" if v < 1 else f"${v:,.2f}"


def call_line(rec: dict[str, Any]) -> str:
    """The one line printed after every model call."""
    cached = f" ({rec['cached_input_tokens']:,} cached)" if rec["cached_input_tokens"] else ""
    reason = f" +{rec['reasoning_tokens']:,} reasoning" if rec["reasoning_tokens"] else ""
    lifetime = load_usage()["totals"]
    cost = _money(rec["cost_usd"]) if rec["cost_usd"] is not None else "unpriced"
    if not rec.get("persisted", True):
        return (
            f"  [usage] {rec['input_tokens']:,} in{cached} / {rec['output_tokens']:,} out{reason}"
            f"  ·  MOCK — no network call, not added to the ledger"
        )
    return (
        f"  [usage] {rec['input_tokens']:,} in{cached} / {rec['output_tokens']:,} out{reason}"
        f"  ·  this call {cost}"
        f"  ·  run {_money(SESSION['cost_usd'])}"
        f"  ·  lifetime {_money(lifetime['cost_usd'])} over {lifetime['calls']:,} calls"
    )


def unpriced_notice(model: str) -> str | None:
    if price_for(model) is not None:
        return None
    return (
        f"  [usage] no price on file for '{model}' — tokens are counted exactly, cost is not.\n"
        f"          Set it once (USD per 1M tokens, from your Azure pricing page):\n"
        f"          python3 automation/lf.py price {model} --in 1.25 --out 10.00"
    )


def format_report() -> str:
    data = load_usage()
    t = data["totals"]
    if t["calls"] == 0:
        return "No API calls recorded yet."

    lines = []
    lines.append("Little Fighters — Azure GPT usage (running total)")
    lines.append("=" * 62)
    lines.append(f"  first call   {data.get('first_call') or '—'}")
    lines.append(f"  last call    {data.get('last_call') or '—'}")
    lines.append(f"  calls        {t['calls']:,}")
    lines.append(f"  input        {t['input_tokens']:,} tokens"
                 + (f" ({t['cached_input_tokens']:,} cached)" if t["cached_input_tokens"] else ""))
    lines.append(f"  output       {t['output_tokens']:,} tokens"
                 + (f" ({t['reasoning_tokens']:,} reasoning)" if t["reasoning_tokens"] else ""))
    lines.append(f"  total        {t['total_tokens']:,} tokens")
    lines.append(f"  cost         {_money(t['cost_usd'])}"
                 + (f"   ({t['unpriced_calls']:,} calls unpriced)" if t["unpriced_calls"] else ""))

    for title, key in (("By command", "by_command"), ("By model", "by_model")):
        buckets = data.get(key) or {}
        if not buckets:
            continue
        lines.append("")
        lines.append(f"  {title}")
        width = max(len(k) for k in buckets)
        for name, b in sorted(buckets.items(), key=lambda kv: -kv[1]["total_tokens"]):
            lines.append(
                f"    {name.ljust(width)}  {b['calls']:>4} calls  "
                f"{b['total_tokens']:>9,} tok  {_money(b['cost_usd']):>10}"
            )
    return "\n".join(lines)
