"""Azure AI Foundry client for the v1 Responses API.

    POST https://<resource>.services.ai.azure.com/openai/v1/responses

Stdlib only (urllib). Every call folds its token usage into the running total
in usage.py and prints one line.

The client is built to diagnose and fix its own request problems rather than
handing them to a human:

  * It remembers which parameters a deployment rejects, in
    automation/endpoint_caps.json, and never sends them again — on this run or
    any future one.
  * A rejected parameter usually arrives as a clean HTTP 400 naming the
    parameter. But when the request body is large, the server rejects it while
    the client is still uploading and closes the socket, so the *same* error
    surfaces as a dropped connection with no response to read. When that
    happens the client re-sends a tiny canary with the same parameters to make
    the server state its objection cheaply, learns from it, and retries the
    real request. That is the difference between "it failed, go and debug it"
    and "it failed, worked out why, and carried on".

Set LF_MOCK=1 to exercise every code path with canned replies and no network.
"""

from __future__ import annotations

import http.client
import json
import os
import random
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any

from .config import AUTOMATION_DIR, Config
from . import usage as usage_mod

CAPS_PATH = AUTOMATION_DIR / "endpoint_caps.json"

# Parameters worth stripping automatically when a deployment refuses them.
OPTIONAL_PARAMS = ("temperature", "top_p", "frequency_penalty", "presence_penalty")

# Above this, a rejection is likely to arrive as a dropped socket rather than
# a readable 400, because the server answers before we finish uploading.
CANARY_THRESHOLD_BYTES = 8 * 1024

# Never shrink the output reservation below this — under it, codegen replies get
# truncated mid-file and the real problem becomes the prompt, not the ceiling.
# gpt-6-astra style deployments spend a large slice of the output budget on
# hidden reasoning before emitting anything. Squeezing this number produces
# replies that are all thought and no content, so it stays generous.
# The deployment appears to bound input + max_output_tokens together, while a
# reasoning model needs a real output allowance to produce anything at all.
# This floor is the compromise: enough to emit a couple of files after the
# hidden reasoning, small enough to sit under the combined ceiling.
MIN_OUTPUT_TOKENS = 8000

# Starting assumption for input + max_output_tokens, refined at runtime and
# remembered per deployment once a working combination is found.
DEFAULT_TOTAL_BUDGET = 24000

TRANSIENT_CODES = (408, 409, 429, 500, 502, 503, 504)

# Patience beats cleverness against an intermittent fault. Roughly four minutes
# of trying in the worst case; most calls get through in the first two or three.
RETRY_WAITS = (2, 3, 5, 8, 12, 18, 25, 30, 30, 30, 30)


class AzureError(RuntimeError):
    pass


_UNPRICED_WARNED: set[str] = set()


# -- learned endpoint capabilities ------------------------------------------


def load_caps() -> dict[str, Any]:
    if not CAPS_PATH.is_file():
        return {}
    try:
        return json.loads(CAPS_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def unsupported_params(model: str) -> set[str]:
    entry = load_caps().get(model) or {}
    return set(entry.get("unsupported_params") or [])


def remember_unsupported(model: str, param: str, note: str = "") -> None:
    """Persist that this deployment refuses a parameter, so we stop sending it."""
    caps = load_caps()
    entry = caps.setdefault(model, {})
    params = entry.setdefault("unsupported_params", [])
    if param not in params:
        params.append(param)
    entry["learned_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    if note:
        entry.setdefault("notes", {})[param] = note[:300]
    try:
        CAPS_PATH.parent.mkdir(parents=True, exist_ok=True)
        CAPS_PATH.write_text(json.dumps(caps, indent=2) + "\n", encoding="utf-8")
    except OSError:
        pass   # learning is best-effort; the in-flight fix still applies


def learned_limit(model: str, key: str) -> int | None:
    entry = load_caps().get(model) or {}
    val = (entry.get("limits") or {}).get(key)
    return int(val) if isinstance(val, (int, float)) and val > 0 else None


def remember_limit(model: str, key: str, value: int, note: str = "") -> None:
    """Persist a value this deployment was actually willing to accept."""
    caps = load_caps()
    entry = caps.setdefault(model, {})
    limits = entry.setdefault("limits", {})
    prev = limits.get(key)
    if isinstance(prev, (int, float)) and prev <= value:
        return                      # never raise a ceiling we already found
    if key == "max_output_tokens" and int(value) < MIN_OUTPUT_TOKENS:
        return                      # never record a starving output ceiling
    limits[key] = int(value)
    entry["learned_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    if note:
        entry.setdefault("notes", {})[key] = note[:300]
    try:
        CAPS_PATH.parent.mkdir(parents=True, exist_ok=True)
        CAPS_PATH.write_text(json.dumps(caps, indent=2) + "\n", encoding="utf-8")
    except OSError:
        pass


def _param_from_error(detail: str) -> str | None:
    """Pull the offending parameter out of an Azure error body."""
    try:
        err = json.loads(detail).get("error") or {}
        param = err.get("param")
        if isinstance(param, str) and param:
            return param
    except (json.JSONDecodeError, AttributeError):
        pass
    # Fall back to naming any optional parameter mentioned in the message.
    for name in OPTIONAL_PARAMS:
        if re.search(rf"\b{name}\b", detail):
            return name
    return None


# -- client ------------------------------------------------------------------


class AzureClient:
    def __init__(self, cfg: Config | None = None, quiet: bool = False) -> None:
        self.cfg = cfg or Config()
        self.quiet = quiet
        self._auth_style = "api-key"
        # Streaming by default: see _post_stream for why. LF_STREAM=0 disables it.
        self.stream = os.environ.get("LF_STREAM", "1").strip() not in ("0", "false", "False")
        self._canaried = False
        self._adapted_max = False
        self._waited_for_quota = False

    def _log(self, msg: str) -> None:
        if not self.quiet:
            print(msg)

    # -- request plumbing ---------------------------------------------------

    def _headers(self) -> dict[str, str]:
        h = {"Content-Type": "application/json",
             "User-Agent": "little-fighters-automation/1.1"}
        if self._auth_style == "api-key":
            h["api-key"] = self.cfg.api_key
        else:
            h["Authorization"] = f"Bearer {self.cfg.api_key}"
        return h

    def _post(self, body: dict[str, Any]) -> dict[str, Any]:
        payload = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            self.cfg.endpoint, data=payload, headers=self._headers(), method="POST")
        with urllib.request.urlopen(req, timeout=self.cfg.timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def _post_stream(self, body: dict[str, Any]) -> dict[str, Any]:
        """POST with stream=true and reassemble the reply from the SSE events.

        This is the fix for the 60-second silent close. A reasoning model spends
        a long time thinking before emitting anything, so a non-streaming
        request leaves the socket silent for over a minute and something in the
        path treats it as dead. Streaming keeps tokens arriving continuously, so
        the connection is never idle.

        The reconstructed dict is shaped like a normal Responses API payload, so
        nothing downstream needs to know the difference.
        """
        payload = json.dumps({**body, "stream": True}).encode("utf-8")
        headers = {**self._headers(), "Accept": "text/event-stream"}
        req = urllib.request.Request(
            self.cfg.endpoint, data=payload, headers=headers, method="POST")

        chunks: list[str] = []
        final: dict[str, Any] | None = None

        with urllib.request.urlopen(req, timeout=self.cfg.timeout) as resp:
            for raw in resp:
                line = raw.decode("utf-8", "replace").strip()
                if not line or not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    event = json.loads(data)
                except json.JSONDecodeError:
                    continue

                kind = event.get("type", "")
                if kind.endswith("output_text.delta"):
                    chunks.append(event.get("delta") or "")
                elif kind in ("response.completed", "response.incomplete",
                              "response.failed"):
                    final = event.get("response") or final
                elif kind == "error":
                    raise AzureError(f"stream error: {json.dumps(event)[:300]}")

        text = "".join(chunks)
        if final is None:
            final = {"model": self.cfg.model, "status": "completed", "usage": {}}
        # Prefer what we accumulated; the final event sometimes omits the text.
        if text:
            final["output_text"] = text
        return final

    def _canary(self, body: dict[str, Any]) -> str | None:
        """Ask the same question with a tiny body, to make a silent rejection speak.

        Returns the name of an offending parameter if the server names one.
        """
        probe = {k: v for k, v in body.items() if k != "input"}
        probe["input"] = [{"role": "user", "content": "ping"}]
        probe["max_output_tokens"] = min(int(probe.get("max_output_tokens", 512) or 512), 512)
        try:
            self._post(probe)
            return None                      # small request fine -> body size or transient
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:1200]
            if e.code == 400:
                return _param_from_error(detail)
            return None
        except Exception:
            return None

    def _strip_known_bad(self, body: dict[str, Any]) -> None:
        for param in unsupported_params(self.cfg.model):
            body.pop(param, None)
        ceiling = learned_limit(self.cfg.model, "max_output_tokens")
        if ceiling and int(body.get("max_output_tokens", 0) or 0) > ceiling:
            body["max_output_tokens"] = ceiling

        # No combined-budget clamp: calibrate measured 20,010 input alongside a
        # 64,000 output reservation being accepted, which disproved it. Squeezing
        # the output allowance only starved a reasoning model of room to answer.

    def _post_with_retries(self, body: dict[str, Any], attempts: int = 12) -> dict[str, Any]:
        self._strip_known_bad(body)
        delay = 2.0
        last: Exception | None = None

        for attempt in range(1, attempts + 1):
            try:
                data = self._post_stream(body) if self.stream else self._post(body)
                if self._adapted_max and body.get("max_output_tokens"):
                    est_in = len(json.dumps(body.get("input", "")).encode()) // 4
                    total = est_in + int(body["max_output_tokens"])
                    remember_limit(self.cfg.model, "total_tokens", total,
                                   "input + max_output_tokens this deployment accepted")
                    self._log(f"  [adapt] this deployment took ~{est_in:,} input + "
                              f"{body['max_output_tokens']:,} output = ~{total:,} combined; "
                              f"remembered")
                    self._adapted_max = False
                return data

            except urllib.error.HTTPError as e:
                detail = e.read().decode("utf-8", "replace")[:1200]
                last = AzureError(f"HTTP {e.code}: {detail}")

                # Wrong auth header shape — flip once and retry immediately.
                if e.code in (401, 403) and self._auth_style == "api-key":
                    self._auth_style = "bearer"
                    continue

                if e.code == 400:
                    param = _param_from_error(detail)
                    if param and param in body:
                        remember_unsupported(self.cfg.model, param, detail)
                        body.pop(param, None)
                        self._log(f"  [adapt] {self.cfg.model} rejects '{param}' — "
                                  f"dropped it and remembered for next time")
                        continue
                    if "max_output_tokens" in detail and body.get("max_output_tokens"):
                        body["max_output_tokens"] = max(
                            int(body["max_output_tokens"]) // 2, 1024)
                        self._log("  [adapt] lowering max_output_tokens to "
                                  f"{body['max_output_tokens']}")
                        continue

                if e.code in TRANSIENT_CODES and attempt < attempts:
                    retry_after = e.headers.get("Retry-After") if e.headers else None
                    wait = float(retry_after) if (retry_after or "").isdigit() else delay
                    self._log(f"  [retry {attempt}/{attempts - 1}] HTTP {e.code}, "
                              f"waiting {wait:.0f}s")
                    time.sleep(wait)
                    delay = min(delay * 2, 30)
                    continue
                raise last

            except urllib.error.URLError as e:
                last = AzureError(
                    f"Could not reach {self.cfg.endpoint}\n  {e.reason}\n"
                    "  If you are behind a proxy or restricted network, run this on a "
                    "machine that can reach the Azure endpoint directly.")
                if attempt < attempts:
                    time.sleep(delay)
                    delay = min(delay * 2, 30)
                    continue
                raise last

            except (http.client.HTTPException, ConnectionError,
                    TimeoutError, OSError) as e:
                # Measured, not guessed: the identical request that failed six
                # times in a row was later accepted in full, unchanged. The
                # connection dies below HTTP — no status, no body — so there is
                # nothing wrong with the request and nothing to adapt. Shrinking
                # the prompt or the output allowance only degraded the result.
                # The correct response to an intermittent transport fault is to
                # try again, patiently.
                last = AzureError(
                    f"Connection dropped mid-request ({type(e).__name__}: {e}).")

                # One canary, the first time only: a rejected PARAMETER also
                # arrives this way on a large body, and that is worth catching.
                size = len(json.dumps(body).encode())
                if size > CANARY_THRESHOLD_BYTES and not self._canaried:
                    self._canaried = True
                    param = self._canary(body)
                    if param and param in body:
                        remember_unsupported(self.cfg.model, param,
                                             "surfaced via canary after a dropped connection")
                        body.pop(param, None)
                        self._log(f"  [adapt] {self.cfg.model} rejects '{param}' — "
                                  f"dropped it and remembered for next time")
                        continue

                if attempt < attempts:
                    wait = RETRY_WAITS[min(attempt - 1, len(RETRY_WAITS) - 1)]
                    wait += random.uniform(0, wait * 0.3)   # jitter, avoid lockstep
                    self._log(f"  [retry {attempt}/{attempts - 1}] connection dropped "
                              f"(intermittent), waiting {wait:.0f}s")
                    time.sleep(wait)
                    continue

                raise AzureError(
                    f"{last}\n"
                    f"  Gave up after {attempts} attempts. This endpoint drops large\n"
                    "  requests intermittently — the same request usually succeeds on a\n"
                    "  later try. Re-running the build normally gets past it.\n"
                    "  For a permanent fix, the drop happens below HTTP (no status is\n"
                    "  ever returned), which points at the network path rather than\n"
                    "  Azure. Try a different network, or lower the interface MTU:\n"
                    "    networksetup -setMTU Wi-Fi 1400")

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
        self._strip_known_bad(body)

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

        reason = (data.get("incomplete_details") or {}).get("reason", "")
        truncated = data.get("status") == "incomplete" or reason == "max_output_tokens"
        starved = truncated and len(text.strip()) < 400
        if starved and not self.cfg.mock and max_output_tokens < 64000:
            bigger = min(max_output_tokens * 2, 64000)
            self._log(f"  [adapt] reply was cut off before any content "
                      f"(reason={reason or 'truncated'}) — retrying with "
                      f"max_output_tokens={bigger}")
            return self.respond(prompt, system=system, command=command,
                                max_output_tokens=bigger, temperature=temperature)
        if truncated and not text.strip():
            raise AzureError(
                f"Model returned no text (status=incomplete, reason={reason or 'unknown'}).")
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

    for choice in data.get("choices") or []:
        msg = (choice or {}).get("message") or {}
        if isinstance(msg.get("content"), str):
            parts.append(msg["content"])
    return "\n".join(parts)


_FENCE = re.compile(r"```([A-Za-z0-9_+-]*)\n(.*?)```", re.DOTALL)


def extract_blocks(text: str, lang: str | None = None) -> list[tuple[str, str]]:
    blocks = [(m.group(1).lower(), m.group(2)) for m in _FENCE.finditer(text)]
    if lang:
        want = lang.lower()
        blocks = [b for b in blocks
                  if b[0] == want or (want == "gdscript" and b[0] in ("gd", "gdscript"))]
    return blocks


def extract_json(text: str) -> Any:
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
    """Canned payload shaped exactly like a real Responses API reply."""
    sys_l = system.lower()

    if "### file:" in sys_l:
        text = (
            "### PLAN\n"
            "Mock plan: LF_MOCK=1 is on, so this is a canned reply that exercises "
            "the parser and the review/apply flow without calling Azure.\n\n"
            "### FILE: little-fighters-js/renderer/src/mock-generated.js\n"
            "```javascript\n"
            "// Generated by LF_MOCK=1 — safe to delete.\n"
            "export const mock = true;\n"
            "```\n\n"
            "### WIRING\nNone.\n"
        )
    elif "clip name" in sys_l:
        found, seen = re.findall(r"([\w .'-]+\.glb)", prompt), []
        for f in found:
            f = f.strip()
            if f not in seen:
                seen.append(f)
        clips = ["idle", "walk", "run", "jump", "punch", "kick", "dropkick",
                 "hit", "block", "dash", "knockdown", "getup", "death"]
        mapping = {c: (seen[i] if i < len(seen) else None) for i, c in enumerate(clips)}
        text = "```json\n" + json.dumps(mapping, indent=2) + "\n```"
    elif "bpy" in sys_l or "blender" in sys_l:
        text = (
            "Mock asset: a single grounded cube.\n\n```python\n"
            "import bpy\n"
            "bpy.ops.wm.read_homefile(use_empty=True)\n"
            "bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, 1))\n"
            "print('[asset] mock prop built')\n"
            "bpy.ops.export_scene.gltf(filepath=OUTPUT_PATH, export_format='GLB',\n"
            "                          export_yup=True, export_apply=True)\n"
            "```\n"
        )
    elif "system prompts for the tactical brain" in sys_l:
        text = (
            "You are the tactical brain of a CPU fighter. This is a MOCK policy "
            "produced with LF_MOCK=1, long enough to pass the length check but not "
            "worth keeping. Choose rush when ahead and the enemy is recovering; "
            "spacing when even and out-ranged; defensive or retreat below a third "
            "health. If the enemy blocks the same attack repeatedly, switch attacks "
            "and close the distance. Reply with the fixed JSON schema and nothing else."
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
