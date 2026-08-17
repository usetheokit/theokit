"""Tests for detect_domain.py — verifies agnostic keyword matching across domains.

``scripts/detect_domain.py`` is intentionally AGNOSTIC: its ``DOMAINS`` dict ships
generic software-engineering domains (auth, database, cli-tooling, …) — no
consumer-specific domains. These tests exercise that real contract against the
``database`` and ``auth`` domains, which have distinctive keywords.
"""
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


def test_database_plan_detected_as_database(sample_plan: Path) -> None:
    """A plan dominated by database keywords resolves to the `database` domain (rc 0)."""
    rc, data = _run(sample_plan)
    assert rc == 0
    assert data["primary_domain"] == "database"


def test_unknown_domain_when_no_keywords(tmp_path: Path) -> None:
    """A plan with genuinely no domain keywords → primary 'unknown', rc 1."""
    plan = tmp_path / "unknown.md"
    plan.write_text(
        "# Plan: Unrelated\n\n"
        "This document describes a generic improvement to the wording of help output. "
        "We will tidy up some prose. Nothing notable belongs to any known topic here.\n",
        encoding="utf-8",
    )
    rc, data = _run(plan)
    assert rc == 1
    assert data["primary_domain"] == "unknown"


def test_auth_keywords_detected_as_auth(tmp_path: Path) -> None:
    """A plan built from `auth` keywords resolves to the `auth` domain (rc 0, confidence > 0)."""
    plan = tmp_path / "auth.md"
    plan.write_text(
        "# Plan: Auth\n\n"
        "Implement authentication and authorization. Issue a JWT on login, "
        "support OAuth and OIDC. Hash the password with argon2. Enforce RBAC "
        "permission checks and protect against CSRF.\n",
        encoding="utf-8",
    )
    rc, data = _run(plan)
    assert rc == 0
    assert data["primary_domain"] == "auth"
    assert data["confidence"]["auth"] > 0


def test_multiple_domains_with_confidence(tmp_path: Path) -> None:
    """A plan mixing database (dominant) + auth yields auth as a secondary domain."""
    plan = tmp_path / "multi.md"
    plan.write_text(
        "# Plan: Multi\n\n"
        "Database schema with an Alembic migration, CREATE TABLE, INDEX, "
        "FOREIGN KEY, ORM and connection pool tuning. Also add authentication "
        "with JWT, OAuth, login and RBAC permission checks.\n",
        encoding="utf-8",
    )
    rc, data = _run(plan)
    assert rc == 0
    assert data["primary_domain"] == "database"
    assert "auth" in data["secondary_domains"]
    assert data["confidence"]["database"] > data["confidence"]["auth"]
