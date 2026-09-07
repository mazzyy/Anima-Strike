"""Configuration + .env loading for the Little Fighters automation CLI.

Stdlib only — no pip install needed anywhere.

Secrets live in a `.env` file at the project root (git-ignored). Nothing in
this repo ever contains the API key itself.
"""

from __future__ import annotations

import os
from pathlib import Path

# automation/lf/config.py -> automation/lf -> automation -> <project root>
PROJECT_ROOT = Path(__file__).resolve().parents[2]
AUTOMATION_DIR = PROJECT_ROOT / "automation"
OUT_DIR = AUTOMATION_DIR / "out"

DEFAULT_ENDPOINT = "https://tasting-resource.services.ai.azure.com/openai/v1/responses"
DEFAULT_MODEL = "gpt-6-astra"


def _parse_env_file(path: Path) -> dict[str, str]:
    """Minimal .env parser: KEY=VALUE, # comments, optional quotes."""
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.lower().startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        if key:
            values[key] = val
    return values


def load_env() -> None:
    """Load .env files into os.environ. Real environment variables win."""
    for candidate in (PROJECT_ROOT / ".env", AUTOMATION_DIR / ".env"):
        for key, val in _parse_env_file(candidate).items():
            os.environ.setdefault(key, val)


class Config:
    def __init__(self) -> None:
        load_env()
        self.endpoint = os.environ.get("AZURE_OPENAI_ENDPOINT", DEFAULT_ENDPOINT).strip()
        self.api_key = os.environ.get("AZURE_OPENAI_API_KEY", "").strip()
        self.model = os.environ.get("AZURE_OPENAI_MODEL", DEFAULT_MODEL).strip()
        self.timeout = float(os.environ.get("LF_TIMEOUT", "180"))
        self.mock = os.environ.get("LF_MOCK", "").strip() not in ("", "0", "false", "False")

    @property
    def key_present(self) -> bool:
        return bool(self.api_key)

    def masked_key(self) -> str:
        if not self.api_key:
            return "(not set)"
        k = self.api_key
        if len(k) <= 10:
            return "*" * len(k)
        return f"{k[:4]}{'*' * (len(k) - 8)}{k[-4:]}  ({len(k)} chars)"

    def require_key(self) -> None:
        if self.mock:
            return
        if not self.api_key:
            raise SystemExit(
                "AZURE_OPENAI_API_KEY is not set.\n"
                f"  Create {PROJECT_ROOT / '.env'} with:\n"
                "      AZURE_OPENAI_API_KEY=your-key-here\n"
                f"  (copy {AUTOMATION_DIR / '.env.example'} as a starting point)\n"
                "  Or run with LF_MOCK=1 to exercise the pipeline offline."
            )
