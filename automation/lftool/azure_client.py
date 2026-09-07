"""Azure AI Foundry client for the v1 Responses API.

    POST https://<resource>.services.ai.azure.com/openai/v1/responses

Stdlib only (urllib). Every call folds its token usage into the running total
in usage.py and prints one line.

Set LF_MOCK=1 to exercise every code path with a canned response and no
network — useful for testing the pipeline where the endpoint is unreachable.
"""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
from typing import Any

from .config import Config
from . import usage as usage_mod


class AzureError(RuntimeError):
    pass


_UNPRICED_WARNED: set[str] = set()


class AzureClient:
    def __init__(self, cfg: Config | None = None, quiet: bool = False) -> None:
        self.cfg = cfg or Config()
        self.quiet = quiet
        # Azure accepts either header; we start with api-key and fall back once.
        self._auth_style = "api-key"

    # -- request plumbing ---------------------------------------------------

    def _headers(self) -> dict[str, str]:
        h = {"Content-Type": "application/json", "User-Agent": "little-fighters-automation/1.0"}
        if self._auth_style == "api-key":
            h["api-key"] = self.cfg.api_key
        else:
            h["Authorization"] = f"Bearer {self.cfg.api_key}"
        return h

    def _post(self, body: dict[str, Any]) -> dict[str, Any]:
        payload = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            self.cfg.endpoint, data=payload, headers=self._headers(), method="POST"
        )
        with urllib.request.urlopen(req, timeout=self.cfg.timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def _post_with_retries(self, body: dict[str, Any], attempts: int = 4) -> dict[str, Any]:
        delay = 2.0
        last: Exception | None = None
        for attempt in range(1, attempts + 1):
            try:
                return self._post(body)
            except urllib.error.HTTPError as e:
                detail = e.read().decode("utf-8", "replace")[:1200]
                last = AzureError(f"HTTP {e.code}: {detail}")

                # Wrong auth header shape — flip once and retry immediately.
                if e.code in (401, 403) and self._auth_style == "api-key":
                    self._auth_style = "bearer"
                    continue

                # Some deployments (reasoning models) reject sampling params.
                dropped = False
                for param in ("temperature", "top_p"):
                    if e.code == 400 and param in detail and param in body:
                        body.pop(param, None)
                        dropped = True
                if dropped:
                    continue

                # max_output_tokens too low for a reasoning model.
                if e.code == 400 and "max_output_tokens" in detail and body.get("max_output_tokens"):
                    body["max_output_tokens"] = max(int(body["max_output_tokens"]) * 2, 4096)
                    continue

                if e.code in (408, 409, 429, 500, 502, 503, 504) and attempt < attempts:
                    retry_after = e.headers.get("Retry-After") if e.headers else None
                    wait = float(retry_after) if (retry_after or "").isdigit() else delay
                    if not self.quiet:
                        print(f"  [retry {attempt}/{attempts - 1}] HTTP {e.code}, waiting {wait:.0f}s")
                    time.sleep(wait)
                    delay = min(delay * 2, 30)
                    continue
                raise last
            except urllib.error.URLError as e:
                last = AzureError(
                    f"Could not reach {self.cfg.endpoint}\n  {e.reason}\n"
                    "  If you are behind a proxy or restricted network, run this on a "
                    "machine that can reach the Azure endpoint directly."
                )
                if attempt < attempts:
                    time.sleep(delay)
                    delay = min(delay * 2, 30)
                    continue
                raise last
        raise last or AzureError("request failed")

    # -- public API ---------------------------------------------------------

    def respond(
        self,
        prompt: str,
        system: str | None = None,
        command: str = "misc",
        max_output_tokens: int = 8000,
        temperature: float | None = 0.2,
    ) -> str:
        """Send one request and return the model's text. Records usage."""
        self.cfg.require_key()

        messages: list[dict[str, Any]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        body: dict[str, Any] = {
            "model": self.cfg.model,
            "input": messages,
            "max_output_tokens": max_output_tokens,
        }
        if temperature is not None:
            body["temperature"] = temperature

        if self.cfg.mock:
            data = _mock_response(self.cfg.model, prompt, system or "")
        else:
            data = self._post_with_retries(body)

        text = extract_text(data)
        raw_usage = data.get("usage") or {}
        model_name = data.get("model") or self.cfg.model
        rec = usage_mod.record(model_name, command, raw_usage,
                               persist=not self.cfg.mock)

        if not self.quiet:
            note = None if self.cfg.mock else usage_mod.unpriced_notice(model_name)
            if note and model_name not in _UNPRICED_WARNED:
                _UNPRICED_WARNED.add(model_name)
                print(note)
            print(usage_mod.call_line(rec))

        status = data.get("status")
        if status == "incomplete" and not text.strip():
            reason = (data.get("incomplete_details") or {}).get("reason", "unknown")
            raise AzureError(
                f"Model returned no text (status=incomplete, reason={reason}). "
                "Try a larger --max-tokens."
            )
        return text


# -- response parsing -------------------------------------------------------


def extract_text(data: dict[str, Any]) -> str:
    """Pull assistant text out of a Responses API payload."""
    if isinstance(data.get("output_text"), str) and data["output_text"].strip():
        return data["output_text"]

    parts: list[str] = []
    for item in data.get("output") or []:
        if not isinstance(item, dict):
            continue
        if item.get("type") not in (None, "message"):
            continue
        content = item.get("content")
        if isinstance(content, str):
            parts.append(content)
            continue
        for chunk in content or []:
            if isinstance(chunk, dict) and chunk.get("type") in ("output_text", "text"):
                parts.append(chunk.get("text") or "")
    if parts:
        return "\n".join(p for p in parts if p)

    # Chat-Completions shape, just in case the endpoint is pointed there.
    for choice in data.get("choices") or []:
        msg = (choice or {}).get("message") or {}
        if isinstance(msg.get("content"), str):
            parts.append(msg["content"])
    return "\n".join(parts)


_FENCE = re.compile(r"```([A-Za-z0-9_+-]*)\n(.*?)```", re.DOTALL)


def extract_blocks(text: str, lang: str | None = None) -> list[tuple[str, str]]:
    """Return [(language, code)] for every fenced block, optionally filtered."""
    blocks = [(m.group(1).lower(), m.group(2)) for m in _FENCE.finditer(text)]
    if lang:
        want = lang.lower()
        blocks = [b for b in blocks if b[0] == want or (want == "gdscript" and b[0] in ("gd", "gdscript"))]
    return blocks


def extract_json(text: str) -> Any:
    """Best-effort JSON out of a model reply (fenced or bare)."""
    for _, code in extract_blocks(text, "json"):
        try:
            return json.loads(code)
        except json.JSONDecodeError:
            pass
    stripped = text.strip()
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        pass
    start = min((i for i in (stripped.find("{"), stripped.find("[")) if i != -1), default=-1)
    if start == -1:
        raise AzureError("model reply contained no JSON")
    for end in range(len(stripped), start, -1):
        try:
            return json.loads(stripped[start:end])
        except json.JSONDecodeError:
            continue
    raise AzureError("model reply contained no parsable JSON")


# -- offline mock -----------------------------------------------------------


def _mock_response(model: str, prompt: str, system: str = "") -> dict[str, Any]:
    """Canned payload shaped exactly like a real Responses API reply.

    The reply is shaped to match whichever command asked, so LF_MOCK=1
    exercises the real parsing and file-writing paths, not just the HTTP layer.
    """
    sys_l = system.lower()

    if "### file:" in sys_l:
        text = (
            "### PLAN\n"
            "Mock plan: LF_MOCK=1 is on, so this is a canned reply that exercises "
            "the parser and the review/apply flow without calling Azure.\n\n"
            "### FILE: scripts/MockGenerated.gd\n"
            "```gdscript\n"
            "extends Node\n"
            "## Generated by LF_MOCK=1 — safe to delete.\n"
            "\n"
            "func _ready() -> void:\n"
            "\tprint(\"[mock] codegen pipeline works\")\n"
            "```\n\n"
            "### WIRING\n"
            "None.\n"
        )
    elif "clip name" in sys_l:
        found = re.findall(r"([\w .'-]+\.glb)", prompt)
        seen: list[str] = []
        for f in found:
            f = f.strip()
            if f not in seen:
                seen.append(f)
        clips = ["idle", "walk", "run", "jump", "punch", "kick", "dropkick",
                 "hit", "block", "dash", "knockdown", "getup", "death"]
        mapping: dict[str, Any] = {}
        for i, clip in enumerate(clips):
            mapping[clip] = seen[i] if i < len(seen) else None
        text = "```json\n" + json.dumps(mapping, indent=2) + "\n```"
    elif "bpy" in sys_l or "blender" in sys_l:
        text = (
            "Mock asset: a single grounded cube.\n\n```python\n"
            "import bpy\n"
            "bpy.ops.wm.read_homefile(use_empty=True)\n"
            "bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, 1))\n"
            "bpy.context.active_object.name = 'MockProp'\n"
            "print('[asset] mock prop built')\n"
            "bpy.ops.export_scene.gltf(filepath=OUTPUT_PATH, export_format='GLB',\n"
            "                          export_yup=True, export_apply=True)\n"
            "```\n"
        )
    elif "system prompts for the tactical brain" in sys_l:
        text = (
            "You are the tactical brain of a CPU fighter. This is a MOCK policy "
            "produced with LF_MOCK=1, long enough to pass the length check but not "
            "worth keeping. Choose rush when you are ahead on health and the enemy "
            "is recovering; choose spacing when you are even and they out-range you; "
            "choose defensive or retreat below a third health so a single exchange "
            "cannot finish you. If the enemy blocks the same attack repeatedly, "
            "switch your preferred attack and close the distance instead of trading. "
            "Reply with the fixed JSON schema and nothing else."
        )
    else:
        text = "Mock reply — LF_MOCK=1, no network call was made."

    approx_in = max((len(prompt) + len(system)) // 4, 1)
    approx_out = max(len(text) // 4, 1)
    return {
        "id": "resp_mock",
        "model": model,
        "status": "completed",
        "output": [{"type": "message", "content": [{"type": "output_text", "text": text}]}],
        "usage": {
            "input_tokens": approx_in,
            "output_tokens": approx_out,
            "total_tokens": approx_in + approx_out,
            "input_tokens_details": {"cached_tokens": 0},
            "output_tokens_details": {"reasoning_tokens": 0},
        },
    }
