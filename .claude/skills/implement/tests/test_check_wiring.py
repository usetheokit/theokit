"""Tests for check_wiring.py — verifies the triad enforcement."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parent.parent / "scripts" / "check_wiring.py"


def _run_wiring(symbol: str, project_root: Path, metric: str | None = None) -> tuple[int, dict]:
    args = [sys.executable, str(SCRIPT), "--symbol", symbol, "--project-root", str(project_root)]
    if metric:
        args.extend(["--metric", metric])
    result = subprocess.run(args, capture_output=True, text=True)
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        data = {"raw": result.stdout, "stderr": result.stderr}
    return result.returncode, data


def test_pillar_a_fail_when_zero_callers(fake_project: Path) -> None:
    """Symbol with no callers in src/ → pillar (a) FAIL → verdict HALT."""
    rc, data = _run_wiring("nonExistentSymbol123", fake_project)
    assert rc == 1
    assert data["verdict"] == "HALT"
    pillar_a = next(p for p in data["pillars"] if p["pillar"] == "a_static_caller")
    assert pillar_a["status"] == "FAIL"


def test_pillar_a_pass_with_real_caller(fake_project: Path) -> None:
    """Symbol referenced in a production file → pillar (a) PASS."""
    (fake_project / "src" / "uses-it.ts").write_text(
        "export function myCaller() { rememberFact('hello'); }\n",
        encoding="utf-8",
    )
    rc, data = _run_wiring("rememberFact", fake_project)
    pillar_a = next(p for p in data["pillars"] if p["pillar"] == "a_static_caller")
    # rc=1 because pillar b will fail (no integration test), but pillar a should PASS
    assert pillar_a["status"] == "PASS"


def test_pillar_b_fail_when_no_integration_test(fake_project: Path) -> None:
    """No file in tests/integration/ references symbol → pillar (b) FAIL."""
    (fake_project / "src" / "uses-it.ts").write_text(
        "export function caller() { mySymbol(); }\n", encoding="utf-8"
    )
    rc, data = _run_wiring("mySymbol", fake_project)
    pillar_b = next(p for p in data["pillars"] if p["pillar"] == "b_integration_test")
    assert pillar_b["status"] == "FAIL"


def test_pillar_b_pass_when_integration_test_exists(fake_project: Path) -> None:
    """File in tests/integration/ references symbol → pillar (b) PASS."""
    (fake_project / "src" / "uses-it.ts").write_text(
        "export function caller() { mySymbol(); }\n", encoding="utf-8"
    )
    (fake_project / "tests" / "integration" / "test.ts").write_text(
        "test('uses mySymbol', () => { mySymbol(); });\n", encoding="utf-8"
    )
    rc, data = _run_wiring("mySymbol", fake_project)
    pillar_b = next(p for p in data["pillars"] if p["pillar"] == "b_integration_test")
    assert pillar_b["status"] == "PASS"


def test_pillar_c_na_when_no_metric(fake_project: Path) -> None:
    """No metric declared → pillar (c) is N/A."""
    rc, data = _run_wiring("anySymbol", fake_project)
    pillar_c = next(p for p in data["pillars"] if p["pillar"] == "c_runtime_metric")
    assert pillar_c["status"] == "N/A"


def test_pillar_c_fail_when_metric_declared_but_evidence_missing(fake_project: Path) -> None:
    """Metric declared but no .wiring-evidence.json → pillar (c) FAIL."""
    rc, data = _run_wiring("anySymbol", fake_project, metric="memory.add.count")
    pillar_c = next(p for p in data["pillars"] if p["pillar"] == "c_runtime_metric")
    assert pillar_c["status"] == "FAIL"


def test_pillar_c_pass_with_evidence(fake_project: Path) -> None:
    """Metric declared and observed > 0 in .wiring-evidence.json → pillar (c) PASS."""
    evidence = fake_project / ".wiring-evidence.json"
    evidence.write_text(json.dumps({"memory.add.count": 12}), encoding="utf-8")
    rc, data = _run_wiring("anySymbol", fake_project, metric="memory.add.count")
    pillar_c = next(p for p in data["pillars"] if p["pillar"] == "c_runtime_metric")
    assert pillar_c["status"] == "PASS"
    assert pillar_c["count_observed"] == 12
