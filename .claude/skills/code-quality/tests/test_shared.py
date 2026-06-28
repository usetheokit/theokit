"""T0.4 — _shared.py utilities tests.

Tests for the cross-detector helpers: config loaders, allowlist parser with
sunset validation, Finding dataclass invariants, atomic writes, safe JSON
parsing, path normalization, symbol sanitization.

Per plan v1.3 § T0.4 TDD section (19 RED tests).
"""
from __future__ import annotations

import json
import threading
from datetime import date
from pathlib import Path

import pytest

from scripts._shared import (
    DEFAULT_SKIP_DIRS,
    AllowlistEntry,
    AllowlistMatch,
    Finding,
    emit_json_summary,
    is_allowlisted,
    load_allowlist,
    load_languages_config,
    load_thresholds,
    make_relative,
    safe_parse_json,
    sanitize_symbol,
    write_atomic,
)

# --- Languages config ---


def test_load_languages_config_parses_4_entries(tmp_path: Path) -> None:
    rule = tmp_path / "languages.txt"
    rule.write_text(
        "# header comment\n"
        "python | pyproject.toml | ENABLED | py notes\n"
        "typescript | package.json | ENABLED | ts notes\n"
        "rust | Cargo.toml | ENABLED | rust notes\n"
        "go | go.mod | ENABLED | go notes\n"
    )
    cfg = load_languages_config(rule)
    assert set(cfg.keys()) == {"python", "typescript", "rust", "go"}
    assert cfg["python"]["manifest"] == "pyproject.toml"
    assert cfg["python"]["status"] == "ENABLED"


def test_load_languages_config_rejects_invalid_status(tmp_path: Path) -> None:
    rule = tmp_path / "languages.txt"
    rule.write_text("python | pyproject.toml | INVALID_STATUS | foo\n")
    with pytest.raises(ValueError, match="invalid STATUS"):
        load_languages_config(rule)


# --- Thresholds ---


def test_load_thresholds_coerces_types(tmp_path: Path) -> None:
    rule = tmp_path / "thresholds.txt"
    rule.write_text(
        "vulture.min_confidence = 80\n"
        "mutation.score_floor_low = 60.0\n"
        "knip.exit_code = strict\n"
        "orchestrator.no_network_disables_d2 = true\n"
    )
    t = load_thresholds(rule)
    assert t["vulture.min_confidence"] == 80
    assert isinstance(t["mutation.score_floor_low"], float)
    assert t["knip.exit_code"] == "strict"
    assert t["orchestrator.no_network_disables_d2"] is True


# --- Allowlist + sunset validation (EC-4) ---


def test_load_allowlist_parses_sunset_date(tmp_path: Path) -> None:
    rule = tmp_path / "allowlist.txt"
    rule.write_text(
        "python|src/foo.py|dead_code|unused_helper|Pending refactor|2026-08-01\n"
    )
    entries = load_allowlist(rule)
    assert len(entries) == 1
    assert entries[0].sunset_date == date(2026, 8, 1)


def test_load_allowlist_rejects_malformed_sunset_date(tmp_path: Path) -> None:
    """EC-4 — date in dd/mm/yyyy or empty MUST raise."""
    rule = tmp_path / "allowlist.txt"
    rule.write_text(
        "python|src/foo.py|dead_code|x|reason|01/08/2026\n"  # locale BR
    )
    with pytest.raises(ValueError, match="malformed sunset date"):
        load_allowlist(rule)


def test_load_allowlist_rejects_invalid_calendar_date(tmp_path: Path) -> None:
    rule = tmp_path / "allowlist.txt"
    rule.write_text(
        "python|src/foo.py|dead_code|x|reason|2026-13-45\n"
    )
    with pytest.raises(ValueError, match="malformed sunset date"):
        load_allowlist(rule)


def test_load_allowlist_rejects_empty_sunset(tmp_path: Path) -> None:
    rule = tmp_path / "allowlist.txt"
    rule.write_text(
        "python|src/foo.py|dead_code|x|reason|\n"
    )
    with pytest.raises(ValueError, match="malformed sunset date"):
        load_allowlist(rule)


def test_is_allowlisted_returns_active_within_sunset() -> None:
    finding = Finding(
        detector="d1_dead_code",
        language="python",
        severity="HARD",
        file_path="src/foo.py",
        symbol_or_line="unused_helper",
        message="...",
        allowlist_key="python|src/foo.py|dead_code|unused_helper",
    )
    entry = AllowlistEntry(
        ecosystem="python",
        file_path="src/foo.py",
        finding_type="dead_code",
        symbol="unused_helper",
        reason="...",
        sunset_date=date(2026, 12, 31),
    )
    match = is_allowlisted(finding, [entry], date(2026, 6, 1))
    assert match == AllowlistMatch.ACTIVE


def test_is_allowlisted_returns_expired_after_sunset() -> None:
    finding = Finding(
        detector="d1_dead_code",
        language="python",
        severity="HARD",
        file_path="src/foo.py",
        symbol_or_line="unused_helper",
        message="...",
        allowlist_key="python|src/foo.py|dead_code|unused_helper",
    )
    entry = AllowlistEntry(
        ecosystem="python",
        file_path="src/foo.py",
        finding_type="dead_code",
        symbol="unused_helper",
        reason="...",
        sunset_date=date(2026, 1, 1),
    )
    match = is_allowlisted(finding, [entry], date(2026, 6, 1))
    assert match == AllowlistMatch.EXPIRED


def test_is_allowlisted_returns_not_listed_no_match() -> None:
    finding = Finding(
        detector="d1_dead_code",
        language="python",
        severity="HARD",
        file_path="src/foo.py",
        symbol_or_line="unrelated",
        message="...",
        allowlist_key="python|src/foo.py|dead_code|unrelated",
    )
    match = is_allowlisted(finding, [], date(2026, 6, 1))
    assert match == AllowlistMatch.NOT_LISTED


# --- safe_parse_json (EC-1) ---


def test_safe_parse_json_returns_data_on_valid_json() -> None:
    data, finding = safe_parse_json('{"key": "value"}', "vulture")
    assert data == {"key": "value"}
    assert finding is None


def test_safe_parse_json_returns_finding_on_decode_error() -> None:
    data, finding = safe_parse_json('{not json', "vulture")
    assert data is None
    assert finding is not None
    assert "auditor_output_malformed_vulture" in finding.allowlist_key
    assert finding.severity == "SOFT_CAP"


# --- write_atomic (EC-9) ---


def test_write_atomic_writes_full_content(tmp_path: Path) -> None:
    target = tmp_path / "out.json"
    write_atomic(target, '{"hello": "world"}')
    assert target.read_text() == '{"hello": "world"}'


def test_write_atomic_no_partial_file_on_concurrent_writes(tmp_path: Path) -> None:
    """Concurrent writes leave EITHER old OR fully-new content — never partial."""
    target = tmp_path / "out.json"
    payload_a = json.dumps({"writer": "A", "data": "x" * 1000})
    payload_b = json.dumps({"writer": "B", "data": "y" * 1000})

    errors: list[Exception] = []

    def writer(payload: str) -> None:
        try:
            for _ in range(20):
                write_atomic(target, payload)
        except Exception as e:  # noqa: BLE001
            errors.append(e)

    t1 = threading.Thread(target=writer, args=(payload_a,))
    t2 = threading.Thread(target=writer, args=(payload_b,))
    t1.start()
    t2.start()
    t1.join()
    t2.join()

    assert not errors
    # File must be parseable JSON (no partial content)
    assert json.loads(target.read_text()) in (
        {"writer": "A", "data": "x" * 1000},
        {"writer": "B", "data": "y" * 1000},
    )


# --- Finding invariants (EC-12) ---


def test_finding_post_init_rejects_absolute_path() -> None:
    with pytest.raises(AssertionError, match="repo-relative"):
        Finding(
            detector="d1_dead_code",
            language="python",
            severity="HARD",
            file_path="/abs/path.py",
            symbol_or_line="x",
            message="...",
            allowlist_key="python|/abs/path.py|dead_code|x",
        )


def test_finding_post_init_rejects_unsanitized_symbol_in_key() -> None:
    with pytest.raises(AssertionError, match="sanitized"):
        Finding(
            detector="d1_dead_code",
            language="python",
            severity="HARD",
            file_path="src/foo.py",
            symbol_or_line="x|y",
            message="...",
            allowlist_key="python|src/foo.py|dead_code|x|y",  # raw pipe in symbol
        )


# --- Path + symbol helpers ---


def test_make_relative_strips_repo_root_prefix(tmp_path: Path) -> None:
    repo_root = tmp_path
    abs_path = tmp_path / "src" / "foo.py"
    assert make_relative(abs_path, repo_root) == "src/foo.py"


def test_sanitize_symbol_escapes_pipes() -> None:
    assert sanitize_symbol("foo|bar") == "foo\\|bar"
    assert sanitize_symbol("plain") == "plain"


# --- DEFAULT_SKIP_DIRS (EC-10) ---


def test_default_skip_dirs_includes_referencia() -> None:
    assert "referencia" in DEFAULT_SKIP_DIRS
    assert ".git" in DEFAULT_SKIP_DIRS
    assert "node_modules" in DEFAULT_SKIP_DIRS
    assert "__pycache__" in DEFAULT_SKIP_DIRS


def test_default_skip_dirs_includes_claude_meta() -> None:
    """The skill audits the PRODUCT, never the .claude meta-tooling that hosts it.

    Without this skip, /code-quality would falsely flag the skill's own scripts
    when the product manifests are added at repo root.
    """
    assert ".claude" in DEFAULT_SKIP_DIRS


# --- emit_json_summary ---


def test_emit_json_summary_includes_hard_caps_triggered() -> None:
    findings = [
        Finding(
            detector="d1_dead_code",
            language="python",
            severity="HARD",
            file_path="src/foo.py",
            symbol_or_line="unused",
            message="dead code",
            allowlist_key="python|src/foo.py|dead_code|unused",
        )
    ]
    summary = emit_json_summary(findings, "FAIL_HARD", ["dead_code_unallowlisted_python"])
    assert summary["verdict"] == "FAIL_HARD"
    assert "dead_code_unallowlisted_python" in summary["hard_caps_triggered"]
    assert summary["schema_version"]  # non-empty


def test_emit_json_summary_invalid_caps_score_at_zero() -> None:
    """INVALID (structural integrity broken) caps the score at 0 — Source of Truth is
    code-quality-golden-rule.md § 1 (INVALID = 0), not 49."""
    summary = emit_json_summary([], "INVALID", ["code_quality_golden_rule_missing"])
    assert summary["score_cap"] == 0


def test_emit_json_summary_score_caps_per_golden_rule() -> None:
    """Regression guard: every verdict maps to its golden-rule § 1 score cap."""
    assert emit_json_summary([], "PASS", [])["score_cap"] == 100
    assert emit_json_summary([], "PASS_WITH_CAVEATS", [])["score_cap"] == 89
    assert emit_json_summary([], "FAIL_SOFT", [])["score_cap"] == 70
    assert emit_json_summary([], "FAIL_HARD", [])["score_cap"] == 49
    assert emit_json_summary([], "INVALID", [])["score_cap"] == 0
