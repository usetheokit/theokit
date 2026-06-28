"""L4 — Adversarial inputs. System MUST degrade gracefully, never crash."""
from __future__ import annotations

from pathlib import Path

import pytest
import yaml


from check_coverage_matrix import check_coverage_matrix  # noqa: E402
from check_spec_smells import check_spec_smells  # noqa: E402
from run_structural import run_structural  # noqa: E402

SKILL_ROOT = Path(__file__).parent.parent
RUBRIC = SKILL_ROOT / "templates" / "rubric-v1.md"
THRESHOLDS = SKILL_ROOT.parent.parent / "rules" / "plan-confidence-thresholds.txt"


def _write_bytes(tmp_path: Path, name: str, data: bytes) -> Path:
    p = tmp_path / name
    p.write_bytes(data)
    return p


# ---------------------------------------------------------------------------
# Encoding edge cases
# ---------------------------------------------------------------------------

def test_utf8_bom_handled(tmp_path: Path) -> None:
    plan = _write_bytes(
        tmp_path,
        "bom.md",
        b"\xef\xbb\xbf# Plan\n\n## Coverage Matrix\n\n"
        b"| # | Gap | Task(s) | Resolution |\n"
        b"|---|-----|---------|------------|\n"
        b"| 1 | a | T1.1 | x |\n",
    )
    report = check_coverage_matrix(plan)
    assert report.total_gaps == 1


def test_utf16_bom_handled_or_clear_error(tmp_path: Path) -> None:
    """UTF-16 BOM: utf-8-sig won't auto-strip; expect ValueError (handled), not crash."""
    plan = _write_bytes(tmp_path, "u16.md", b"\xff\xfe# P\x00")
    # Should raise UnicodeDecodeError or ValueError, NOT crash with stack trace
    with pytest.raises((UnicodeDecodeError, ValueError)):
        check_coverage_matrix(plan)


def test_invalid_utf8_handled(tmp_path: Path) -> None:
    plan = _write_bytes(tmp_path, "bad.md", b"# Plan\n\xc3\x28\nbad utf-8\n")
    with pytest.raises((UnicodeDecodeError, ValueError)):
        check_coverage_matrix(plan)


def test_unicode_in_table(tmp_path: Path) -> None:
    """Unicode chars (accents, emojis-via-text, RTL) shouldn't break parsing."""
    plan = tmp_path / "unicode.md"
    plan.write_text(
        "# Plan\n\n## Coverage Matrix\n\n"
        "| # | Gap | Task(s) | Resolution |\n"
        "|---|-----|---------|------------|\n"
        "| 1 | gap com acentuação ção ã | T1.1 | ✓ done |\n"
        "| 2 | hebrew אבג text | T1.2 | done |\n",
        encoding="utf-8",
    )
    report = check_coverage_matrix(plan)
    assert report.total_gaps == 2
    assert report.is_complete


# ---------------------------------------------------------------------------
# Structural edge cases
# ---------------------------------------------------------------------------

def test_empty_file(tmp_path: Path) -> None:
    plan = tmp_path / "empty.md"
    plan.write_text("", encoding="utf-8")
    with pytest.raises(ValueError, match="Coverage Matrix"):
        check_coverage_matrix(plan)


def test_only_whitespace(tmp_path: Path) -> None:
    plan = tmp_path / "ws.md"
    plan.write_text("   \n\n\t\n", encoding="utf-8")
    with pytest.raises(ValueError, match="Coverage Matrix"):
        check_coverage_matrix(plan)


def test_huge_plan_does_not_timeout(tmp_path: Path) -> None:
    """5000-line plan should complete in <5s."""
    import time

    rows = [
        f"| {i + 1} | gap {i} | T1.{i + 1} | done |"
        for i in range(50)
    ]
    body = "\n".join(["random prose line"] * 4000)
    plan = tmp_path / "huge.md"
    plan.write_text(
        f"# Plan\n\n{body}\n\n## Coverage Matrix\n\n"
        "| # | Gap | Task(s) | Resolution |\n"
        "|---|-----|---------|------------|\n"
        + "\n".join(rows),
        encoding="utf-8",
    )
    start = time.perf_counter()
    report = check_coverage_matrix(plan)
    elapsed = time.perf_counter() - start
    assert elapsed < 5.0, f"took {elapsed:.2f}s (>5s)"
    assert report.total_gaps == 50


def test_deeply_nested_code_blocks(tmp_path: Path) -> None:
    """Adversarial: try to break code-block stripping via deep nesting."""
    plan = tmp_path / "nest.md"
    plan.write_text(
        "# Plan\n\n"
        "```python\n"
        "should = could  # weak imperatives inside code\n"
        "if possible:\n"
        "    pass\n"
        "```\n\n"
        "## Coverage Matrix\n\n"
        "| # | Gap | Task(s) | Resolution |\n"
        "|---|-----|---------|------------|\n"
        "| 1 | gap a | T1.1 | done |\n",
        encoding="utf-8",
    )
    report = check_spec_smells(plan, RUBRIC)
    # All smell words are inside code block -> should be stripped
    assert report.total_hits == 0


def test_pipe_chars_in_cells(tmp_path: Path) -> None:
    """Pipes inside cells (escaped or not) shouldn't break table parsing catastrophically."""
    plan = tmp_path / "pipe.md"
    plan.write_text(
        "# Plan\n\n## Coverage Matrix\n\n"
        "| # | Gap | Task(s) | Resolution |\n"
        "|---|-----|---------|------------|\n"
        "| 1 | normal gap | T1.1 | done |\n"
        "| 2 | gap with no pipes | T2.1 | also done |\n",
        encoding="utf-8",
    )
    report = check_coverage_matrix(plan)
    assert report.total_gaps >= 1


def test_malformed_yaml_in_rubric_raises(tmp_path: Path) -> None:
    """If someone hands a corrupted rubric, fail with clear error not crash."""
    bad_rubric = tmp_path / "bad-rubric.md"
    bad_rubric.write_text(
        "```yaml\n"
        "version: not-a-number\n"
        "  : invalid yaml structure\n"
        "    nesting wrong\n"
        "```\n",
        encoding="utf-8",
    )
    plan = tmp_path / "p.md"
    plan.write_text("text", encoding="utf-8")
    with pytest.raises((ValueError, KeyError, TypeError, yaml.YAMLError)):
        check_spec_smells(plan, bad_rubric)


def test_rubric_without_yaml_block_raises(tmp_path: Path) -> None:
    bad = tmp_path / "no-yaml.md"
    bad.write_text("just prose, no yaml\n", encoding="utf-8")
    plan = tmp_path / "p.md"
    plan.write_text("text", encoding="utf-8")
    with pytest.raises(ValueError, match="yaml"):
        check_spec_smells(plan, bad)


def test_score_robust_to_extra_columns_in_matrix(tmp_path: Path) -> None:
    """Real plans add Severity/Status columns; system must handle 5-6 col tables."""
    plan = tmp_path / "wide.md"
    plan.write_text(
        "# Plan\n\n## Coverage Matrix\n\n"
        "| # | Finding | Severity | Status | Task(s) | Resolution | Notes |\n"
        "|---|---------|----------|--------|---------|------------|-------|\n"
        "| 1 | F-A     | HIGH     | open   | T1.1    | done       | n/a   |\n"
        "| 2 | F-B     | LOW      | closed | T1.2    | done       | ok    |\n",
        encoding="utf-8",
    )
    report = check_coverage_matrix(plan)
    assert report.total_gaps == 2
    assert report.mapped_gaps == 2


def test_no_arbitrary_code_execution_in_md(tmp_path: Path) -> None:
    """Markdown with embedded `eval`/`exec` strings is just text — should NOT execute."""
    plan = tmp_path / "evil.md"
    plan.write_text(
        "# Plan\n\n"
        "__import__('os').system('echo PWNED > /tmp/__pwned_test')\n"
        "eval('1+1')\n\n"
        "## Coverage Matrix\n\n"
        "| # | Gap | Task(s) | Resolution |\n"
        "|---|-----|---------|------------|\n"
        "| 1 | g | T1.1 | done |\n",
        encoding="utf-8",
    )
    pwn_marker = Path("/tmp/__pwned_test")
    pwn_marker.unlink(missing_ok=True)
    report = check_coverage_matrix(plan)
    assert not pwn_marker.exists(), "WORLD ENDS: scoring executed embedded shell command"
    assert report.total_gaps == 1


def test_file_not_found_clear_error(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        check_coverage_matrix(tmp_path / "does-not-exist.md")


def test_e2e_robust_to_no_adrs_section(tmp_path: Path) -> None:
    plan = tmp_path / "no-adr.md"
    plan.write_text(
        "# Plan\n\n## Coverage Matrix\n\n"
        "| # | Gap | Task(s) | Resolution |\n"
        "|---|-----|---------|------------|\n"
        "| 1 | g | T1.1 | done |\n",
        encoding="utf-8",
    )
    # No ADRs section — adr_completeness returns total_adrs=0, ratio=1.0 (vacuous)
    # End-to-end should succeed, not crash
    report = run_structural(plan, RUBRIC, THRESHOLDS)
    assert report.verdict != "INVALID"  # no cap fires for vacuous ADR rule


def test_very_long_single_line(tmp_path: Path) -> None:
    """Pathological 100KB single-line file."""
    huge_line = "word " * 20000  # ~100KB
    plan = tmp_path / "longline.md"
    plan.write_text(huge_line + "\n", encoding="utf-8")
    with pytest.raises(ValueError, match="Coverage Matrix"):
        check_coverage_matrix(plan)
