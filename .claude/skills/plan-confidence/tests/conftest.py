"""Shared pytest fixtures and path helpers.

PORTABLE: paths are auto-detected via walk-up from the skill location, with
layout fallback so the test suite runs in BOTH layouts:

  - **standalone**: Cycle source repo itself — `rules/`, `skills/`, `knowledge-base/`
    live at the top level (no `.claude/` wrapper).
  - **consumer install**: Cycle ecosystem copied into a consumer project under
    `<consumer>/.claude/` (this is what `scripts/install.sh` and
    `scripts/patch_install.sh` produce).

Without the fallback every test asserting `<root>/.claude/rules/foo.md` exists
fails when the suite runs against the Cycle source itself — because the plan
source keeps its canonical files at `<root>/rules/foo.md`. The fixtures below
detect which layout is in use and route to the correct directory.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

SKILL_ROOT = Path(__file__).parent.parent
SCRIPTS_DIR = SKILL_ROOT / "scripts"

# Make scripts/ importable (e.g. `from check_adr_completeness import ...`)
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))


def _find_project_root(start: Path) -> Path:
    """Walk up to find a project root marker.

    Recognized markers (in priority order):
      1. `.claude/rules/` populated under the directory (consumer install)
      2. `rules/` AND `skills/` directly under the directory (plan standalone)
      3. `.git/` directory (any git repo root, last resort)

    Without this, a stray empty `.git/` at `/home/paulo/Projetos/plan/.git/`
    would short-circuit the walk-up and the test suite would look for files at
    `/home/paulo/Projetos/plan/.claude/rules/` which do not exist in the
    standalone layout.
    """
    current = start.resolve()
    while current != current.parent:
        if (current / ".claude" / "rules").is_dir():
            return current
        if (current / "rules").is_dir() and (current / "skills").is_dir():
            return current
        current = current.parent
    # Fallback: walk-up failed; do a second pass accepting bare `.git/` / `.claude/`.
    current = start.resolve()
    while current != current.parent:
        if (current / ".claude").is_dir() or (current / ".git").exists():
            return current
        current = current.parent
    return start.parent.parent.parent


def _resolve_rules_dir(project_root: Path) -> Path:
    """Return whichever of `<root>/.claude/rules/` or `<root>/rules/` actually exists.

    Consumer install populates `.claude/rules/`. Standalone Cycle source keeps
    `rules/` at the top level. Prefer consumer-install when both are present
    (consumers may also have a top-level `rules/` from prior conventions).
    """
    consumer = project_root / ".claude" / "rules"
    standalone = project_root / "rules"
    if consumer.is_dir() and any(consumer.iterdir()):
        return consumer
    if standalone.is_dir() and any(standalone.iterdir()):
        return standalone
    # Both empty / missing — return the consumer path so the assertion failure
    # message is clear about the expected layout.
    return consumer


def _resolve_concepts_dir(project_root: Path) -> Path:
    """Return whichever of `<root>/.claude/knowledge-base/concepts/plan-confidence/`
    or `<root>/knowledge-base/concepts/plan-confidence/` actually exists.
    """
    consumer = project_root / ".claude" / "knowledge-base" / "concepts" / "plan-confidence"
    standalone = project_root / "knowledge-base" / "concepts" / "plan-confidence"
    if consumer.exists():
        return consumer
    if standalone.exists():
        return standalone
    return consumer


PROJECT_ROOT = _find_project_root(SKILL_ROOT)
RULES_DIR = _resolve_rules_dir(PROJECT_ROOT)
CONCEPTS_DIR = _resolve_concepts_dir(PROJECT_ROOT)


@pytest.fixture(scope="session")
def skill_root() -> Path:
    """Path to the plan-confidence skill directory."""
    return SKILL_ROOT


@pytest.fixture(scope="session")
def project_root() -> Path:
    """Path to the project root (auto-detected via walk-up)."""
    return PROJECT_ROOT


@pytest.fixture(scope="session")
def rules_dir() -> Path:
    """Path to the rules directory (either `<root>/.claude/rules/` or `<root>/rules/`).

    Layout-aware: returns the consumer-install path when present, falls back to
    the plan-standalone path otherwise. See `_resolve_rules_dir` above.
    """
    return RULES_DIR


@pytest.fixture(scope="session")
def concepts_dir() -> Path:
    """Path to the plan-confidence concepts directory (layout-aware)."""
    return CONCEPTS_DIR
