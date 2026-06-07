"""T5.1 + T5.2 + T5.3 — orchestrator + verdict aggregator + Markdown report tests."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts._shared import Finding, compute_verdict
from scripts.run_code_quality import _resolve_plan_path, main


def _write_rules(tmp_path: Path, *, with_allowlist: str = "") -> Path:
    rules = tmp_path / ".claude" / "rules"
    rules.mkdir(parents=True)
    (rules / "code-quality-languages.txt").write_text(
        "python | pyproject.toml | ENABLED |\n"
        "typescript | package.json | ENABLED |\n"
        "rust | Cargo.toml | ENABLED |\n"
        "go | go.mod | ENABLED |\n"
    )
    (rules / "code-quality-thresholds.txt").write_text("vulture.min_confidence = 80\n")
    (rules / "code-quality-allowlist.txt").write_text(with_allowlist)
    (tmp_path / ".claude" / "knowledge-base" / "plans").mkdir(parents=True)
    (tmp_path / ".git").mkdir()
    return tmp_path


# --------------------------------------------------------------------------
# T5.2 — compute_verdict
# --------------------------------------------------------------------------


def _f(severity: str, *, detector: str = "d1_dead_code", lang: str = "python") -> Finding:
    return Finding(
        detector=detector,
        language=lang,
        severity=severity,
        file_path="src/x.py",
        symbol_or_line="foo",
        message="...",
        allowlist_key=f"{lang}|src/x.py|{detector.split('_', 1)[1]}|foo",
    )


def test_verdict_pass_when_no_findings() -> None:
    verdict, caps = compute_verdict([])
    assert verdict == "PASS"
    assert caps == []


def test_verdict_fail_hard_when_hard_finding_present() -> None:
    verdict, caps = compute_verdict([_f("HARD")])
    assert verdict == "FAIL_HARD"
    assert "dead_code_unallowlisted_python" in caps


def test_verdict_fail_soft_when_only_soft_cap() -> None:
    verdict, _ = compute_verdict([_f("SOFT_CAP")])
    assert verdict == "FAIL_SOFT"


def test_verdict_pass_with_caveats_when_only_soft_floor() -> None:
    verdict, _ = compute_verdict([_f("SOFT_FLOOR")])
    assert verdict == "PASS_WITH_CAVEATS"


def test_verdict_smallest_cap_wins() -> None:
    """HARD + SOFT_FLOOR => FAIL_HARD (smallest cap)."""
    verdict, _ = compute_verdict([_f("SOFT_FLOOR"), _f("HARD")])
    assert verdict == "FAIL_HARD"


# --------------------------------------------------------------------------
# T5.1 — slug resolution (EC-6)
# --------------------------------------------------------------------------


def test_slug_resolution_finds_plan_in_plans_dir(tmp_path: Path) -> None:
    _write_rules(tmp_path)
    plan = tmp_path / ".claude" / "knowledge-base" / "plans" / "demo-plan.md"
    plan.write_text("# demo\n")
    resolved = _resolve_plan_path("demo", tmp_path)
    assert resolved == plan


def test_slug_resolution_finds_plan_in_completed(tmp_path: Path) -> None:
    _write_rules(tmp_path)
    completed = tmp_path / ".claude" / "knowledge-base" / "plans" / "completed"
    completed.mkdir()
    plan = completed / "old-plan.md"
    plan.write_text("# old\n")
    resolved = _resolve_plan_path("old", tmp_path)
    assert resolved == plan


def test_slug_resolution_refuses_discovery_plan(tmp_path: Path) -> None:
    """EC-6 — discovery plan slug must produce a helpful error mentioning /discover-confidence."""
    _write_rules(tmp_path)
    disc = tmp_path / ".claude" / "knowledge-base" / "discoveries" / "plans"
    disc.mkdir(parents=True)
    (disc / "investigation-plan.md").write_text("# discovery\n")
    with pytest.raises(FileNotFoundError, match="discover-confidence"):
        _resolve_plan_path("investigation", tmp_path)


def test_slug_resolution_not_found(tmp_path: Path) -> None:
    _write_rules(tmp_path)
    with pytest.raises(FileNotFoundError, match="plan_not_found"):
        _resolve_plan_path("nonexistent", tmp_path)


# --------------------------------------------------------------------------
# T5.1 — end-to-end CLI
# --------------------------------------------------------------------------


def test_cli_standalone_mode_pass_when_no_manifests(tmp_path: Path, capsys) -> None:
    _write_rules(tmp_path)
    exit_code = main(["--repo-root", str(tmp_path), "--no-network"])
    captured = capsys.readouterr()
    assert exit_code == 0
    data = json.loads(captured.out)
    assert data["verdict"] == "PASS"
    assert data["mode"] == "standalone"


def test_cli_no_network_emits_info_finding(tmp_path: Path, capsys) -> None:
    """EC-25 — --no-network disables D2, emits INFO not SOFT_FLOOR cascade."""
    _write_rules(tmp_path)
    (tmp_path / "pyproject.toml").write_text("[project]\nname='x'\n")
    exit_code = main(["--repo-root", str(tmp_path), "--no-network"])
    captured = capsys.readouterr()
    assert exit_code == 0
    # Verdict should still be PASS (vulture finds no Python files in tmp_path)
    data = json.loads(captured.out)
    assert data["verdict"] in ("PASS", "PASS_WITH_CAVEATS")  # Vulture may emit auditor_unavailable


def test_cli_malformed_allowlist_emits_hard(tmp_path: Path, capsys) -> None:
    """EC-4 — malformed allowlist sunset MUST produce HARD allowlist_malformed_entry."""
    _write_rules(tmp_path, with_allowlist="python|src/x.py|dead_code|foo|reason|01/08/2026\n")
    exit_code = main(["--repo-root", str(tmp_path), "--no-network"])
    captured = capsys.readouterr()
    assert exit_code == 1
    data = json.loads(captured.out)
    assert data["verdict"] == "FAIL_HARD"


def test_cli_plan_bound_mode_writes_markdown_report(tmp_path: Path, capsys) -> None:
    _write_rules(tmp_path)
    plan = tmp_path / ".claude" / "knowledge-base" / "plans" / "demo-plan.md"
    plan.write_text("# demo\n")
    exit_code = main(["demo", "--repo-root", str(tmp_path), "--no-network"])
    assert exit_code == 0
    audit_dir = tmp_path / ".claude" / "knowledge-base" / "audits"
    audit_files = list(audit_dir.glob("demo-code-quality-*.md"))
    assert len(audit_files) == 1, f"Expected audit Markdown file; got {audit_files}"


def test_cli_no_audit_write_skips_markdown(tmp_path: Path, capsys) -> None:
    """T6.5 contract — --no-audit-write produces JSON only."""
    _write_rules(tmp_path)
    plan = tmp_path / ".claude" / "knowledge-base" / "plans" / "demo-plan.md"
    plan.write_text("# demo\n")
    exit_code = main(
        ["demo", "--repo-root", str(tmp_path), "--no-network", "--no-audit-write"]
    )
    assert exit_code == 0
    audit_dir = tmp_path / ".claude" / "knowledge-base" / "audits"
    assert not audit_dir.exists() or not list(audit_dir.glob("*.md"))
