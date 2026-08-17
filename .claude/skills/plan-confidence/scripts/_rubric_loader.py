"""Shared helper to load rubric-v1.md YAML block.

Used by check_spec_smells.py and run_structural.py.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


def load_rubric(rubric_path: Path) -> dict[str, Any]:
    """Extract YAML block from rubric .md file and parse it."""
    content = rubric_path.read_text(encoding="utf-8-sig")
    start = content.find("```yaml")
    if start == -1:
        raise ValueError(f"No ```yaml block found in {rubric_path}")
    end = content.find("```", start + len("```yaml"))
    if end == -1:
        raise ValueError(f"Unclosed ```yaml block in {rubric_path}")
    yaml_block = content[start + len("```yaml") : end].strip()
    parsed: dict[str, Any] = yaml.safe_load(yaml_block)
    return parsed
