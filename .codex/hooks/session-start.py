#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Codex Session Start Hook - Inject Trellis context into Codex sessions.

Output format follows Codex hook protocol:
  stdout JSON → { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "..." } }
"""

from __future__ import annotations

import json
import os
import re
import sys
import warnings
from pathlib import Path

# Force UTF-8 on stdin/stdout/stderr on Windows. Default codepage there is
# cp936 / cp1252 / etc. — non-ASCII content (Chinese task names, prd snippets)
# both in stdin (hook payload from host CLI) and stdout (our emitted blocks)
# raises UnicodeDecodeError / UnicodeEncodeError. Equivalent to `python -X utf8`
# but applied per-stream so we don't depend on host CLI's command wiring.
if sys.platform.startswith("win"):
    import io as _io
    for _stream_name in ("stdin", "stdout", "stderr"):
        _stream = getattr(sys, _stream_name, None)
        if _stream is None:
            continue
        if hasattr(_stream, "reconfigure"):
            try:
                _stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
            except Exception:
                pass  # Optional Windows stream setup; keep hook startup non-fatal.
        elif hasattr(_stream, "detach"):
            try:
                setattr(sys, _stream_name, _io.TextIOWrapper(_stream.detach(), encoding="utf-8", errors="replace"))
            except Exception:
                pass  # Optional Windows stream setup; keep hook startup non-fatal.


def _normalize_windows_shell_path(path_str: str) -> str:
    """Normalize Unix-style shell paths to real Windows paths.

    On Windows, shells like Git Bash / MSYS2 / Cygwin may report paths like
    `/d/Users/...` or `/cygdrive/d/Users/...`. `Path.resolve()` will misinterpret
    these as `D:/d/Users...` on drive D: (or similar), breaking repo root
    detection.

    This function is intentionally conservative: it only rewrites patterns that
    unambiguously represent a drive letter mount.
    """
    if not isinstance(path_str, str) or not path_str:
        return path_str

    # Only relevant on Windows; keep other platforms untouched.
    if not sys.platform.startswith("win"):
        return path_str

    p = path_str.strip()

    # Already a Windows drive path (C:\... or C:/...)
    if re.match(r"^[A-Za-z]:[\/]", p):
        return p

    # MSYS/Git-Bash style: /c/Users/... or /d/Work/...
    m = re.match(r"^/([A-Za-z])/(.*)", p)
    if m:
        drive, rest = m.group(1).upper(), m.group(2)
        rest = rest.replace('/', '\\')
        return f"{drive}:\\{rest}"

    # Cygwin style: /cygdrive/c/Users/...
    m = re.match(r"^/cygdrive/([A-Za-z])/(.*)", p)
    if m:
        drive, rest = m.group(1).upper(), m.group(2)
        rest = rest.replace('/', '\\')
        return f"{drive}:\\{rest}"

    # WSL mounted drive (sometimes leaked into env): /mnt/c/Users/...
    m = re.match(r"^/mnt/([A-Za-z])/(.*)", p)
    if m:
        drive, rest = m.group(1).upper(), m.group(2)
        rest = rest.replace('/', '\\')
        return f"{drive}:\\{rest}"

    return path_str


warnings.filterwarnings("ignore")

MAX_ADDITIONAL_CONTEXT_BYTES = 900
MAX_TASK_REFERENCE_BYTES = 384
MAX_TASK_STATUS_BYTES = 96


def should_skip_injection() -> bool:
    if os.environ.get("TRELLIS_HOOKS") == "0":
        return True
    if os.environ.get("TRELLIS_DISABLE_HOOKS") == "1":
        return True
    return os.environ.get("CODEX_NON_INTERACTIVE") == "1"


def configure_project_encoding(project_dir: Path) -> None:
    """Reuse Trellis' shared Windows stdio encoding helper before JSON output."""
    scripts_dir = project_dir / ".trellis" / "scripts"
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))

    try:
        from common import configure_encoding  # type: ignore[import-not-found]

        configure_encoding()
    except Exception:
        pass  # Optional encoding helper; host defaults are still usable.


def _has_curated_jsonl_entry(jsonl_path: Path) -> bool:
    """Return True iff jsonl has at least one row with a ``file`` field.

    A freshly seeded jsonl only contains a ``{"_example": ...}`` row (no
    ``file`` key) — that is NOT "ready". Readiness requires at least one
    curated entry. Matches the contract used by ``inject-subagent-context.py``.
    """
    try:
        for line in jsonl_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(row, dict) and row.get("file"):
                return True
    except (OSError, UnicodeDecodeError):
        return False
    return False


def _resolve_active_task(trellis_dir: Path, hook_input: dict):
    scripts_dir = trellis_dir / "scripts"
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    from common.active_task import resolve_active_task  # type: ignore[import-not-found]

    return resolve_active_task(trellis_dir.parent, hook_input, platform="codex")


def _normalize_task_ref(task_ref: str) -> str:
    normalized = task_ref.strip()
    if not normalized:
        return ""

    path_obj = Path(normalized)
    if path_obj.is_absolute():
        return str(path_obj)

    normalized = normalized.replace("\\", "/")
    while normalized.startswith("./"):
        normalized = normalized[2:]

    if normalized.startswith("tasks/"):
        return f".trellis/{normalized}"

    return normalized


def _resolve_task_dir(trellis_dir: Path, task_ref: str) -> Path:
    normalized = _normalize_task_ref(task_ref)
    path_obj = Path(normalized)
    if path_obj.is_absolute():
        return path_obj
    if normalized.startswith(".trellis/"):
        return trellis_dir.parent / path_obj
    return trellis_dir / "tasks" / path_obj


def _repo_relative(repo_root: Path, path: Path) -> str:
    try:
        return path.relative_to(repo_root).as_posix()
    except ValueError:
        return str(path)


def _truncate_utf8(value: str, limit: int) -> str:
    encoded = value.encode("utf-8")
    if len(encoded) <= limit:
        return value
    return f"{encoded[:limit - 3].decode('utf-8', errors='ignore')}..."


def _collect_spec_index_paths(trellis_dir: Path) -> list[str]:
    paths: list[str] = []
    guides_index = trellis_dir / "spec" / "guides" / "index.md"
    if guides_index.is_file():
        paths.append(".trellis/spec/guides/index.md")

    spec_dir = trellis_dir / "spec"
    if not spec_dir.is_dir():
        return paths

    for sub in sorted(spec_dir.iterdir()):
        if not sub.is_dir() or sub.name.startswith(".") or sub.name == "guides":
            continue
        index_file = sub / "index.md"
        if index_file.is_file():
            paths.append(f".trellis/spec/{sub.name}/index.md")
            continue
        for nested in sorted(sub.iterdir()):
            if not nested.is_dir():
                continue
            nested_index = nested / "index.md"
            if nested_index.is_file():
                paths.append(f".trellis/spec/{sub.name}/{nested.name}/index.md")

    return paths


def _build_task_orientation(trellis_dir: Path, hook_input: dict) -> tuple[str, Path | None]:
    """Return current task identity/status without reading task prose."""
    active = _resolve_active_task(trellis_dir, hook_input)
    if not active.task_path:
        return "Task: none; status=none.", None

    task_dir = _resolve_task_dir(trellis_dir, active.task_path)
    task_label = _truncate_utf8(
        _repo_relative(trellis_dir.parent, task_dir),
        MAX_TASK_REFERENCE_BYTES,
    )
    if active.stale or not task_dir.is_dir():
        return f"Task: {task_label}; status=stale-pointer.", None

    task_status = "unknown"
    task_json_path = task_dir / "task.json"
    try:
        task_data = json.loads(task_json_path.read_text(encoding="utf-8"))
        if isinstance(task_data, dict) and isinstance(task_data.get("status"), str):
            task_status = _truncate_utf8(task_data["status"], MAX_TASK_STATUS_BYTES)
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        pass

    return f"Task: {task_label}; status={task_status}.", task_dir


def _build_artifact_index(task_dir: Path | None) -> str:
    if task_dir is None:
        return "Artifacts: unavailable."

    artifact_names = [
        name
        for name in (
            "task.json",
            "prd.md",
            "design.md",
            "implement.md",
            "check.md",
            "implement.jsonl",
            "check.jsonl",
        )
        if (task_dir / name).is_file()
    ]
    return f"Artifacts: {', '.join(artifact_names) or 'none'}."


def _build_bounded_context(trellis_dir: Path, hook_input: dict) -> str:
    """Build read-only orientation; compact checkpoint delivery is separate."""
    task_line, task_dir = _build_task_orientation(trellis_dir, hook_input)
    spec_indexes = _collect_spec_index_paths(trellis_dir)
    spec_line = f"Specs: {', '.join(spec_indexes)}." if spec_indexes else "Specs: unavailable."
    context = "\n".join(
        (
            "<trellis-session>\n"
            "Read-only current-task orientation; context-mode checkpoint context, if present, is separate.\n"
            "Workflow: Phase 1 Plan -> Phase 2 Execute -> Phase 3 Finish.",
            task_line,
            _build_artifact_index(task_dir),
            spec_line,
            "</trellis-session>",
        ),
    )
    if len(context.encode("utf-8")) <= MAX_ADDITIONAL_CONTEXT_BYTES:
        return context

    return "\n".join(
        (
            "<trellis-session>",
            "Read-only current-task orientation; separate from context-mode checkpoint context.",
            task_line,
            "</trellis-session>",
        ),
    )


def main() -> None:
    if should_skip_injection():
        sys.exit(0)

    # Read hook input from stdin
    try:
        hook_input = json.loads(sys.stdin.read())
        if not isinstance(hook_input, dict):
            hook_input = {}
        project_dir = Path(_normalize_windows_shell_path(hook_input.get("cwd", "."))).resolve()
    except (json.JSONDecodeError, KeyError):
        hook_input = {}
        project_dir = Path(".").resolve()

    configure_project_encoding(project_dir)

    try:
        context = _build_bounded_context(project_dir / ".trellis", hook_input)
    except Exception:
        context = ""
    result = {
        "suppressOutput": True,
        "systemMessage": f"Trellis context injected ({len(context)} chars)",
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": context,
        },
    }

    print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
