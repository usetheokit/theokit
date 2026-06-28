"""Tests for check_drawbacks_section (SOTA upgrade)."""
from __future__ import annotations

import tempfile
from pathlib import Path

import pytest


from check_drawbacks_section import check_drawbacks_section  # noqa: E402


def _write(content: str) -> Path:
    p = Path(tempfile.mktemp(suffix="-plan.md"))
    p.write_text(content)
    return p


def test_empty_plan_drawbacks_absent():
    p = _write("# Plan\n## Goal\n")
    r = check_drawbacks_section(p)
    assert r.drawbacks_section_present is False
    assert r.drawbacks_is_complete is False
    assert r.unresolved_section_present is False
    assert r.unresolved_is_complete is False
    p.unlink()


def test_drawbacks_present_but_one_entry_only():
    content = """# Plan
## Drawbacks & Risks
| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| only one risk | High | mitigation | owner |
## Goal
"""
    p = _write(content)
    r = check_drawbacks_section(p)
    assert r.drawbacks_section_present is True
    assert r.drawbacks_entries == 1
    assert r.drawbacks_is_complete is False
    assert any("minimum required is 2" in reason for reason in r.drawbacks_reasons)
    p.unlink()


def test_drawbacks_complete_with_two_entries():
    content = """# Plan
## Drawbacks & Risks
| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| risk A | High | mitigation A | owner1 |
| risk B | Low | mitigation B | owner2 |
## Goal
"""
    p = _write(content)
    r = check_drawbacks_section(p)
    assert r.drawbacks_is_complete is True
    assert r.drawbacks_entries == 2
    p.unlink()


def test_drawbacks_with_placeholders_caps_completion():
    content = """# Plan
## Drawbacks & Risks
| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Migration window leaves users on old schema for ~2h | Medium | Run dual-write | DBA |
| New dependency `libX` adds 800KB to bundle | Low | Tree-shake; benchmark before/after | FE |
## Goal
"""
    p = _write(content)
    r = check_drawbacks_section(p)
    assert r.drawbacks_placeholder_hits >= 2
    assert r.drawbacks_is_complete is False
    p.unlink()


def test_unresolved_questions_with_entries():
    content = """# Plan
## Unresolved Questions
- Q1 — does retry policy apply?
- Q2 — what about timeouts?

## Goal
"""
    p = _write(content)
    r = check_drawbacks_section(p)
    assert r.unresolved_section_present is True
    assert r.unresolved_entries == 2
    assert r.unresolved_is_complete is True
    p.unlink()


def test_unresolved_explicit_none_is_acceptable():
    content = """# Plan
## Unresolved Questions

(none — every decision is resolved at plan time)

## Goal
"""
    p = _write(content)
    r = check_drawbacks_section(p)
    assert r.unresolved_section_present is True
    assert r.unresolved_explicit_none is True
    assert r.unresolved_is_complete is True
    p.unlink()


def test_unresolved_empty_section_caps_completion():
    content = """# Plan
## Unresolved Questions

## Goal
"""
    p = _write(content)
    r = check_drawbacks_section(p)
    assert r.unresolved_section_present is True
    assert r.unresolved_entries == 0
    assert r.unresolved_is_complete is False
    p.unlink()


def test_drawbacks_heading_with_trailing_text_detected():
    content = """# Plan
## Drawbacks & Risks (RFC-style)
| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| risk A | High | mitigation A | owner1 |
| risk B | Low | mitigation B | owner2 |
## Goal
"""
    p = _write(content)
    r = check_drawbacks_section(p)
    assert r.drawbacks_section_present is True
    p.unlink()
