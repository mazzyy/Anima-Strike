"""Gathers the project into a compact context block for the model.

The game is now the three.js / Electron app in little-fighters-js/. The old
Godot tree is still on disk as reference, but codegen targets the JS by
default; pass --godot to point it at the GDScript instead.

Keeping this in one place means every command sends the model the same,
predictable picture — and lets us cap token spend by trimming here rather
than in each command.
"""

from __future__ import annotations

from pathlib import Path

from .config import PROJECT_ROOT

JS_ROOT = PROJECT_ROOT / "little-fighters-js"

# The JS game, cheapest-useful first.
JS_SOURCES = [
    "little-fighters-js/renderer/src/config.js",
    "little-fighters-js/renderer/src/fighter.js",
    "little-fighters-js/renderer/src/ai.js",
    "little-fighters-js/renderer/src/arena.js",
    "little-fighters-js/renderer/src/assets.js",
    "little-fighters-js/renderer/src/hud.js",
    "little-fighters-js/renderer/src/input.js",
    "little-fighters-js/renderer/src/main.js",
    "little-fighters-js/electron/main.js",
    "little-fighters-js/electron/preload.js",
    "little-fighters-js/electron/azure-brain.js",
    "little-fighters-js/renderer/index.html",
    "little-fighters-js/renderer/styles.css",
]

# The original Godot project, kept for --godot.
GODOT_SCRIPTS = [
    "scripts/Fighter.gd",
    "scripts/HealthComponent.gd",
    "scripts/Hitbox.gd",
    "scripts/Hurtbox.gd",
    "scripts/HUD.gd",
    "scripts/Stage.gd",
    "scripts/AIController.gd",
    "scripts/AzureBrain.gd",
]
GODOT_SCENES = ["scenes/Player.tscn", "scenes/Arena.tscn", "scenes/HUD.tscn"]

LANG_FOR_SUFFIX = {
    ".js": "javascript", ".mjs": "javascript", ".json": "json",
    ".html": "html", ".css": "css", ".gd": "gdscript",
    ".tscn": "", ".godot": "ini", ".md": "markdown",
}


def read(rel: str, limit: int = 40_000) -> str | None:
    path = PROJECT_ROOT / rel
    if not path.is_file():
        return None
    text = path.read_text(encoding="utf-8", errors="replace")
    if len(text) > limit:
        text = text[:limit] + f"\n… [truncated, {len(text) - limit} more chars]"
    return text


def js_available() -> bool:
    return (JS_ROOT / "renderer" / "src" / "fighter.js").is_file()


def file_tree(root: Path, skip: set[str] | None = None) -> str:
    """A short inventory: directories with counts, plus loose files."""
    skip = skip or {".git", ".godot", "node_modules", "__pycache__", "vendor", "assets", "dist"}
    lines: list[str] = []
    if not root.is_dir():
        return "  (missing)"
    for entry in sorted(root.iterdir(), key=lambda p: (p.is_file(), p.name.lower())):
        if entry.name.startswith(".") or entry.name in skip:
            continue
        if entry.is_dir():
            names = sorted(
                p.name for p in entry.rglob("*")
                if p.is_file() and not p.name.startswith(".")
                and not any(part in skip for part in p.parts)
            )
            shown = ", ".join(names[:20])
            more = f" … +{len(names) - 20} more" if len(names) > 20 else ""
            lines.append(f"  {entry.name}/  ({len(names)} files)  {shown}{more}")
        else:
            lines.append(f"  {entry.name}")
    return "\n".join(lines)


def animation_clips() -> list[str]:
    d = PROJECT_ROOT / "animations"
    if not d.is_dir():
        return []
    return sorted(p.name for p in d.glob("*.glb") if not p.name.startswith("._"))


def build(include_files: list[str] | None = None, godot: bool = False,
          file_limit: int = 40_000) -> str:
    """Assemble the shared project-context block."""
    parts: list[str] = []

    if godot or not js_available():
        parts.append("## Project layout (Godot)\n" + file_tree(PROJECT_ROOT))
        sources = include_files if include_files is not None else GODOT_SCRIPTS
        extras = GODOT_SCENES
        godot_cfg = read("project.godot", 8_000)
        if godot_cfg:
            parts.append("## project.godot\n```ini\n" + godot_cfg + "\n```")
    else:
        parts.append("## Project layout (three.js + Electron game)\n" + file_tree(JS_ROOT))
        sources = include_files if include_files is not None else JS_SOURCES
        extras = []
        pkg = read("little-fighters-js/package.json", 4_000)
        if pkg:
            parts.append("## package.json\n```json\n" + pkg + "\n```")

    clips = animation_clips()
    if clips:
        parts.append(
            "## Animation clips available in animations/ (already copied into "
            "little-fighters-js/renderer/assets/ by tools/setup-assets.mjs)\n  "
            + ", ".join(clips)
        )

    for rel in list(sources) + list(extras):
        body = read(rel, file_limit)
        if body:
            lang = LANG_FOR_SUFFIX.get(Path(rel).suffix, "")
            parts.append(f"## {rel}\n```{lang}\n{body}\n```")

    return "\n\n".join(parts)


def approx_tokens(text: str) -> int:
    return len(text) // 4


# Back-compat for anything still importing the old names.
CORE_SCRIPTS = GODOT_SCRIPTS
CORE_SCENES = GODOT_SCENES
