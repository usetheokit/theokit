"""Tests for detect_domain.py — verifies keyword matching across domains."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parent.parent / "scripts" / "detect_domain.py"


def _run(plan: Path) -> tuple[int, dict]:
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--plan", str(plan)],
        capture_output=True,
        text=True,
    )
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        data = {"raw": result.stdout, "stderr": result.stderr}
    return result.returncode, data


def test_pgvector_plan_detected_as_pgvector_schema(sample_plan: Path) -> None:
    rc, data = _run(sample_plan)
    assert rc == 0
    assert data["primary_domain"] == "pgvector-schema"


def test_unknown_domain_when_no_keywords(tmp_path: Path) -> None:
    plan = tmp_path / "unknown.md"
    plan.write_text(
        "# Plan: Unrelated\n\nWe will refactor some random text. No domain keywords here.\n",
        encoding="utf-8",
    )
    rc, data = _run(plan)
    assert rc == 1
    assert data["primary_domain"] == "unknown"


def test_memory_layer_keywords(tmp_path: Path) -> None:
    plan = tmp_path / "memory.md"
    plan.write_text(
        "# Plan: Memory\n\n"
        "Investigate memory store, memory tier, Project A-shape, OurProject, "
        "remember and recall operations. User scope, Agent scope.\n",
        encoding="utf-8",
    )
    rc, data = _run(plan)
    assert rc == 0
    assert data["primary_domain"] == "memory-layer"


def test_multiple_domains_with_confidence(sample_plan: Path) -> None:
    rc, data = _run(sample_plan)
    assert data["primary_domain"] == "pgvector-schema"
    # Sample plan mentions Alembic / migration → db-migrations secondary
    assert data["confidence"]["pgvector-schema"] > 0
