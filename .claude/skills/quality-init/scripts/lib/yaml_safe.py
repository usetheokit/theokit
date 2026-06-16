"""Safe JSON read/write for settings.json manipulation."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def read_json(path: str | Path) -> dict[str, Any]:
    """Read a JSON file. Returns empty dict if file doesn't exist."""
    p = Path(path)
    if not p.exists():
        return {}
    with p.open("r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path: str | Path, data: dict[str, Any]) -> None:
    """Write JSON with 2-space indent, trailing newline."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def merge_hook_into_settings(
    settings_path: str | Path,
    hook_command: str,
    matcher: str = "Write|Edit",
) -> dict[str, Any]:
    """Merge a PostToolUse hook into settings.json without destroying existing config.

    If PostToolUse already has entries, appends. If the exact same command
    already exists, skips (idempotent).

    Returns the merged settings dict.
    """
    settings = read_json(settings_path)

    hooks = settings.setdefault("hooks", {})
    post_tool = hooks.setdefault("PostToolUse", [])

    new_entry = {
        "matcher": matcher,
        "hooks": [
            {
                "type": "command",
                "command": hook_command,
            }
        ],
    }

    # Idempotent: skip if an identical command already exists
    for existing in post_tool:
        for h in existing.get("hooks", []):
            if h.get("command") == hook_command:
                return settings

    post_tool.append(new_entry)
    return settings
