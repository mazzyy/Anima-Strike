"""Where Blender is, and how to run it — natively or in a Docker container.

Native is preferred: it is faster, and it is the same Blender your existing
scripts were written against. Docker is a fallback for machines without a
Blender install, or when you want a pinned version.

The generated scripts never hard-code host paths. They read `PROJECT_ROOT`,
which the runner injects — the real path natively, `/project` in a container
where the project is bind-mounted. That is what lets the same script run
either way.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

from .config import PROJECT_ROOT, load_env

# Purpose-built headless images. Override with LF_BLENDER_DOCKER.
DEFAULT_IMAGE = "blenderkit/headless-blender:multi-version"
CONTAINER_ROOT = "/project"


def find_blender(explicit: str | None = None) -> str | None:
    """Locate a native Blender executable.

    Checked in order: --blender, LF_BLENDER from .env, $PATH, /Applications,
    ~/Applications, then Applications folders on any mounted volume under
    /Volumes — which is where Blender lives when you keep apps on an external
    drive. Either the .app bundle or the binary inside it is accepted.
    """
    load_env()

    def _resolve(raw: str) -> str | None:
        raw = raw.strip().rstrip("/")
        if not raw:
            return None
        path = Path(raw).expanduser()
        if path.suffix == ".app":
            inner = path / "Contents" / "MacOS" / "Blender"
            return str(inner) if inner.is_file() else None
        if path.is_file():
            return str(path)
        return shutil.which(raw)

    for candidate in (explicit, os.environ.get("LF_BLENDER")):
        if candidate:
            resolved = _resolve(candidate)
            if resolved:
                return resolved

    on_path = shutil.which("blender")
    if on_path:
        return on_path

    roots = [Path("/Applications"), Path.home() / "Applications"]
    volumes = Path("/Volumes")
    if volumes.is_dir():
        try:
            for vol in sorted(volumes.iterdir()):
                for name in ("Applications", "applications", "Apps"):
                    folder = vol / name
                    if folder.is_dir():
                        roots.append(folder)
        except OSError:
            pass

    for root in roots:
        try:
            if not root.is_dir():
                continue
            for app in sorted(root.glob("[Bb]lender*.app")):
                exe = app / "Contents" / "MacOS" / "Blender"
                if exe.is_file():
                    return str(exe)
        except OSError:
            continue

    for fallback in (
        "C:/Program Files/Blender Foundation/Blender/blender.exe",
        "/usr/local/bin/blender",
        "/snap/bin/blender",
    ):
        if Path(fallback).is_file():
            return fallback
    return None


def docker_available() -> bool:
    """True only if the docker CLI exists AND the daemon answers."""
    exe = shutil.which("docker")
    if not exe:
        return False
    try:
        proc = subprocess.run([exe, "info"], capture_output=True, text=True, timeout=25)
        return proc.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


class BlenderRunner:
    """Knows how to turn a script path into a command line."""

    def __init__(self, kind: str, exe: str | None = None, image: str | None = None,
                 platform_flag: str | None = None) -> None:
        self.kind = kind              # "native" | "docker"
        self.exe = exe
        self.image = image
        self.platform_flag = platform_flag

    @property
    def project_root(self) -> str:
        """The project root as the *script* will see it."""
        return CONTAINER_ROOT if self.kind == "docker" else str(PROJECT_ROOT)

    def command(self, script_path: Path) -> list[str]:
        script_path = Path(script_path).resolve()
        if self.kind == "native":
            return [str(self.exe), "--background", "--python", str(script_path)]

        try:
            rel = script_path.relative_to(PROJECT_ROOT)
        except ValueError as exc:
            raise RuntimeError(
                "Docker mode can only run scripts inside the project, because the "
                f"project is what gets bind-mounted. {script_path} is outside it."
            ) from exc

        cmd = [
            "docker", "run", "--rm",
            "-v", f"{PROJECT_ROOT}:{CONTAINER_ROOT}",
            "-w", CONTAINER_ROOT,
        ]
        if self.platform_flag:
            cmd += ["--platform", self.platform_flag]
        cmd += [
            str(self.image),
            "blender", "--background", "--python",
            f"{CONTAINER_ROOT}/{rel.as_posix()}",
        ]
        return cmd

    def describe(self) -> str:
        if self.kind == "native":
            return f"native · {self.exe}"
        plat = f" ({self.platform_flag})" if self.platform_flag else ""
        return f"docker · {self.image}{plat}"


def resolve(explicit: str | None = None, use_docker: bool = False,
            image: str | None = None) -> tuple[BlenderRunner | None, str]:
    """Pick a runner. Returns (runner, explanation-if-none)."""
    load_env()

    want_docker = use_docker or os.environ.get("LF_BLENDER_MODE", "").lower() == "docker"
    chosen_image = image or os.environ.get("LF_BLENDER_DOCKER") or DEFAULT_IMAGE
    platform_flag = os.environ.get("LF_BLENDER_DOCKER_PLATFORM") or None

    if want_docker:
        if not docker_available():
            return None, (
                "Docker was requested but the daemon is not answering.\n"
                "  Start Docker Desktop, or drop --docker to use a native Blender."
            )
        return BlenderRunner("docker", image=chosen_image, platform_flag=platform_flag), ""

    native = find_blender(explicit)
    if native:
        return BlenderRunner("native", exe=native), ""

    if docker_available():
        return BlenderRunner("docker", image=chosen_image, platform_flag=platform_flag), ""

    return None, (
        "No Blender found.\n"
        "  Native:  pass --blender /path/to/Blender.app, or set LF_BLENDER in .env\n"
        "  Docker:  start Docker Desktop and pass --docker"
    )
