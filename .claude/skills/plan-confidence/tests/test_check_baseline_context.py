"""Tests for check_baseline_context (SOTA upgrade)."""
from __future__ import annotations

import tempfile
from pathlib import Path

import pytest


from check_baseline_context import check_baseline_context  # noqa: E402


def _write(content: str) -> Path:
    p = Path(tempfile.mktemp(suffix="-plan.md"))
    p.write_text(content)
    return p


def test_empty_plan_section_absent():
    p = _write("# Plan: Foo\n\n## Goal\nfoo\n")
    r = check_baseline_context(p)
    assert r.section_present is False
    assert r.is_complete is False
    assert "Files that will be touched" in r.missing_subsections
    p.unlink()


def test_section_present_but_subsections_missing():
    p = _write("# Plan\n## Baseline Context\nsome prose only\n\n## Other\n")
    r = check_baseline_context(p)
    assert r.section_present is True
    assert r.is_complete is False
    assert set(r.missing_subsections) == {
        "Files that will be touched",
        "Current callers / dependents",
        "Domain glossary",
        "Architecture boundaries affected",
    }
    p.unlink()


def test_complete_section_with_real_data():
    content = """# Plan
## Baseline Context
### Files that will be touched
| File | LoC today | Last commit | Why | Invariants |
|---|---|---|---|---|
| src/foo.py | 123 | f7a91be (2026-06-07) | parser | API stable |
| src/bar.py | 80 | 9c4e2a1 (2026-05-20) | helper | error types frozen |
### Current callers / dependents
- **Symbol:** parse; production: src/x.py:5
### Domain glossary
- **token** — atomic lexer unit
- **chunk** — preprocessed bytes
### Architecture boundaries affected
Crosses parser → emitter boundary.

## Goal
do X
"""
    p = _write(content)
    r = check_baseline_context(p)
    assert r.is_complete is True
    assert r.file_table_rows == 2
    assert r.file_table_placeholder_hits == 0
    assert r.glossary_entries == 2
    assert r.glossary_placeholder_hits == 0
    assert r.missing_subsections == ()
    p.unlink()


def test_placeholders_in_file_table_cap_completion():
    content = """# Plan
## Baseline Context
### Files that will be touched
| File | LoC today | Last commit | Why | Invariants |
|---|---|---|---|---|
| src/path/to/file.ext | 142 | abc1234 | template stuff | none |
### Current callers / dependents
- **Symbol:** parse; production: src/x.py:5
### Domain glossary
- **token** — atomic lexer unit
- **chunk** — preprocessed bytes
### Architecture boundaries affected
Crosses boundary.

## Goal
do X
"""
    p = _write(content)
    r = check_baseline_context(p)
    assert r.is_complete is False
    assert r.file_table_placeholder_hits >= 2  # at least src/path/to/file.ext + abc1234
    assert any("placeholder" in reason for reason in r.reasons)
    p.unlink()


def test_glossary_explicit_none_is_acceptable():
    content = """# Plan
## Baseline Context
### Files that will be touched
| File | LoC today | Last commit | Why | Invariants |
|---|---|---|---|---|
| src/foo.py | 100 | f7a91be (2026-06-07) | parser | API stable |
### Current callers / dependents
- **Symbol:** parse
### Domain glossary
(none)
### Architecture boundaries affected
None affected.

## Goal
do X
"""
    p = _write(content)
    r = check_baseline_context(p)
    assert r.is_complete is True
    assert r.glossary_entries == 0
    p.unlink()


def test_section_with_trailing_text_in_heading_is_detected():
    """The plan-template title uses '## Baseline Context (deep review of current state)'.

    The checker MUST tolerate trailing parenthetical / prose in the H2.
    """
    content = """# Plan
## Baseline Context (deep review of current state)
### Files that will be touched
| File | LoC today | Last commit | Why | Invariants |
|---|---|---|---|---|
| src/foo.py | 100 | f7a91be (2026-06-07) | parser | API stable |
### Current callers / dependents
- **Symbol:** parse
### Domain glossary
- **token** — atomic unit
### Architecture boundaries affected
None.

## Goal
"""
    p = _write(content)
    r = check_baseline_context(p)
    assert r.section_present is True
    p.unlink()


def test_fenced_code_does_not_pollute_placeholder_count():
    """Placeholders inside fenced code blocks (e.g., examples) must not count."""
    content = """# Plan
## Baseline Context
### Files that will be touched
| File | LoC today | Last commit | Why | Invariants |
|---|---|---|---|---|
| src/real.py | 100 | f7a91be (2026-06-07) | parser | API stable |

Example of a placeholder (in code-block, must not count):
```
src/path/to/file.ext  ← this is an example
```

### Current callers / dependents
- **Symbol:** parse
### Domain glossary
- **token** — atomic unit
### Architecture boundaries affected
None.

## Goal
"""
    p = _write(content)
    r = check_baseline_context(p)
    assert r.is_complete is True
    assert r.file_table_placeholder_hits == 0
    p.unlink()
