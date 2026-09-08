"""`lf models` — ask the endpoint what is actually deployed.

Cost accounting needs a rate, and the rate depends on the *underlying* model,
not the deployment name you chose. The deployments endpoint usually names it,
which saves a trip through the portal.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request

from .azure_client import AzureClient


def _base(endpoint: str) -> str:
    """Turn .../openai/v1/responses into .../openai/v1"""
    return endpoint.rstrip("/").rsplit("/", 1)[0] if endpoint.rstrip("/").endswith(
        "/responses") else endpoint.rstrip("/")


def run(args) -> int:
    client = AzureClient(quiet=True)
    client.cfg.require_key()

    url = _base(client.cfg.endpoint) + "/models"
    print(f"Asking {url}\n")

    req = urllib.request.Request(url, headers={"api-key": client.cfg.api_key}, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:400]
        print(f"  HTTP {e.code}: {detail}")
        print("\n  This endpoint may not expose a model listing. Fall back to the portal:")
        print("    Azure AI Foundry -> Deployments -> your deployment -> Model name")
        return 1
    except Exception as exc:
        print(f"  {type(exc).__name__}: {exc}")
        return 1

    entries = data.get("data") if isinstance(data, dict) else None
    if not entries:
        print(json.dumps(data, indent=2)[:2000])
        return 0

    print(f"  {len(entries)} deployment(s):\n")
    for e in entries:
        name = e.get("id") or e.get("name") or "?"
        model = e.get("model") or (e.get("properties") or {}).get("model") or ""
        extra = f"   base model: {model}" if model and model != name else ""
        print(f"    {name}{extra}")
        for k in ("created", "owned_by", "object"):
            if e.get(k):
                print(f"        {k}: {e[k]}")

    print("\n  Once you know the base model, set the rate from the Azure pricing page:")
    print(f"    python3 automation/lf.py price {client.cfg.model} --in <rate> --out <rate>")
    print("  That also re-costs every call already recorded.")
    return 0
