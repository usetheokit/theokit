"""run_structural.py — orchestrator for the M2 structural plan-confidence check.

Loads rubric-v1.md and thresholds allowlist. Runs all 4 checkers
(Coverage Matrix, ADR completeness, TDD in bug-fix, spec smells).
Composes a final score with ADR D8 renormalization for active dimensions.
Applies hard caps. Returns/prints a StructuralScoreReport JSON.

CLI:
    python3 run_structural.py <plan_slug-or-path> [--rubric PATH] [--thresholds PATH]

Exit codes (EC-10):
    0 — SHIPPABLE or SHIPPABLE_WITH_CAVEATS (green path)
    1 — INVALID (hard cap triggered)
    2 — Error (plan/rubric not found, malformed)
    3 — NON_SHIPPABLE (score < 50 without hard cap; over-penalization to investigate)
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from _rubric_loader import load_rubric
from check_adr_completeness import ADRReport, check_adr_completeness
from check_architecture_compliance import check_architecture_compliance
from check_coverage_matrix import CoverageReport, check_coverage_matrix
from check_criterion_executability import ExecutabilityReport, check_criterion_executability
from check_evidence_citations import EvidenceReport, check_evidence_citations
from check_spec_smells import SmellReport, check_spec_smells
from check_tdd_in_bugfix import TDDReport, check_tdd_in_bugfix

SKILL_ROOT = Path(__file__).parent.parent
DEFAULT_RUBRIC = SKILL_ROOT / "templates" / "rubric-v1.md"


def _find_project_root(start: Path) -> Path:
    """Walk up from `start` to find the nearest project root.

    Heuristics (in order):
      1. Directory containing `.claude/` — Claude Code project root
      2. Directory containing `.git/` — git repo root
      3. Fall back to `start.parent.parent.parent` (legacy assumption)

    This makes the skill portable: it works in any project that contains
    a `.claude/` or `.git/` directory above the skill location.
    """
    current = start.resolve()
    while current != current.parent:
        if (current / ".claude").exists() and (current / ".claude").is_dir():
            return current
        if (current / ".git").exists():
            return current
        current = current.parent
    # Last-ditch fallback: assume legacy layout
    return start.parent.parent.parent


def _find_plans_dir(project_root: Path) -> Path:
    """Auto-detect the plans directory across common project conventions."""
    candidates = [
        project_root / ".claude" / "knowledge-base" / "plans",
        project_root / ".claude" / "plans",
        project_root / "plans",
        project_root / "docs" / "plans",
    ]
    for candidate in candidates:
        if candidate.exists() and candidate.is_dir():
            return candidate
    # Default: the canonical Claude Code path (skill assumes this if absent)
    return candidates[0]


def _find_holdout_dir(project_root: Path) -> Path:
    """Auto-detect holdout dir; fall back to canonical path."""
    candidates = [
        project_root / ".claude" / "knowledge-base" / "concepts" / "plan-confidence" / "holdout",
        project_root / ".claude" / "plan-confidence" / "holdout",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


PROJECT_ROOT = _find_project_root(SKILL_ROOT)
DEFAULT_THRESHOLDS = PROJECT_ROOT / ".claude" / "rules" / "plan-confidence-thresholds.txt"
PLANS_DIR = _find_plans_dir(PROJECT_ROOT)
HOLDOUT_DIR = _find_holdout_dir(PROJECT_ROOT)
HOLDOUT_TARGET = 30  # M1 milestone: N>=30 for Cohen's kappa to make sense

# SOTA composite weights (ADR D8 — renormalize for active dimensions in each milestone)
SOTA_WEIGHTS = {
    "completeness": 0.30,
    "evidence": 0.30,
    "calibration": 0.20,
    "structural_risk": 0.20,
}
M2_ACTIVE_DIMENSIONS = ["completeness", "structural_risk"]


@dataclass
class Motivo:
    sign: str  # 'positive' | 'negative' | 'neutral'
    label: str
    weight: float


@dataclass
class StructuralScoreReport:
    plan_slug: str
    plan_path: str
    plan_version: str
    scored_at: str
    completude_score: float
    risco_estrutural_score: float
    active_dimensions: list[str]
    weight_normalization_factor: float
    weighted_avg: float
    hard_caps_triggered: list[str]
    final_score_after_caps: float
    verdict: str
    reasons: dict[str, list[Motivo]]
    sub_reports: dict[str, Any] = field(default_factory=dict)


def renormalize_weights(active_dimensions: list[str]) -> dict[str, float]:
    """ADR D8: renormalize SOTA weights to active dimensions only.

    Sum of SOTA weights over active dims becomes the denominator; each active
    dim gets weight = SOTA_weight / denominator. Sum is 1.0 across active dims.
    """
    sota_sum = sum(SOTA_WEIGHTS[d] for d in active_dimensions if d in SOTA_WEIGHTS)
    if sota_sum == 0:
        raise ValueError(f"No SOTA weight found for active dimensions {active_dimensions}")
    return {d: SOTA_WEIGHTS[d] / sota_sum for d in active_dimensions if d in SOTA_WEIGHTS}


def _resolve_plan_path(arg: str) -> Path:
    """Accept a slug like 'plan-confidence-setup' or a path."""
    candidate = Path(arg)
    if candidate.exists() and candidate.is_file():
        return candidate
    # Try as a slug
    slug = arg.removesuffix("-plan").removesuffix(".md")
    slug_path = PLANS_DIR / f"{slug}-plan.md"
    if slug_path.exists():
        return slug_path
    raise FileNotFoundError(f"Plan not found: {arg}")


def _read_plan_version(plan_path: Path) -> str:
    content = plan_path.read_text(encoding="utf-8-sig")
    m = re.search(r"\*\*Version\s+([\d\.]+)\*\*", content)
    return m.group(1) if m else "unknown"


def _load_thresholds(thresholds_path: Path) -> list[tuple[str, int]]:
    """Parse thresholds allowlist into [(band, min_score), ...] sorted desc."""
    bands: list[tuple[str, int]] = []
    for line in thresholds_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split("|")
        if len(parts) < 2:
            continue
        bands.append((parts[0].strip(), int(parts[1].strip())))
    bands.sort(key=lambda x: x[1], reverse=True)
    return bands


def _lookup_verdict(score: float, bands: list[tuple[str, int]]) -> str:
    for band_name, min_score in bands:
        if score >= min_score:
            return band_name
    return "INVALID"


def _compute_completude(cov: CoverageReport, adr: ADRReport, tdd: TDDReport) -> tuple[float, list[Motivo]]:
    """v1.1 EC-1 fix: single formula (rubric weights 0.6/0.2/0.2 per Phase 4.3 algorithm)."""
    coverage_int = 1.0 if cov.is_complete else 0.0
    coverage_score = 60.0 * coverage_int  # weight 0.6 * 100
    adr_score = 20.0 * adr.completeness_ratio
    tdd_score = 20.0 * tdd.coverage_ratio
    completeness = coverage_score + adr_score + tdd_score

    reasons: list[Motivo] = []
    sign_cov = "positive" if cov.is_complete else "negative"
    reasons.append(Motivo(sign=sign_cov, label=f"Coverage Matrix {'100%' if cov.is_complete else f'{cov.coverage_ratio:.0%}'}", weight=coverage_score))
    sign_adr = "positive" if adr.completeness_ratio >= 1.0 else "negative"
    reasons.append(Motivo(sign=sign_adr, label=f"ADR alternatives ({adr.with_alternatives}/{adr.total_adrs})", weight=adr_score))
    sign_tdd = "positive" if tdd.coverage_ratio >= 1.0 else "negative"
    reasons.append(Motivo(sign=sign_tdd, label=f"TDD in bug-fix ({tdd.with_tdd}/{tdd.total_bugfix_tasks})", weight=tdd_score))

    return completeness, reasons


def _compute_risco(smells: SmellReport) -> tuple[float, list[Motivo]]:
    risco = max(0.0, 100.0 + smells.total_penalty)
    # Top 3 categories by hit count
    sorted_cats = sorted(smells.by_category.items(), key=lambda x: x[1], reverse=True)
    reasons: list[Motivo] = []
    for cat, count in sorted_cats[:3]:
        reasons.append(Motivo(sign="negative" if count > 0 else "neutral", label=f"{count} {cat} hits", weight=-float(count)))
    return risco, reasons


def _detect_hard_caps(
    cov: CoverageReport,
    adr: ADRReport,
    tdd: TDDReport,
    evidence: EvidenceReport | None = None,
    executability: ExecutabilityReport | None = None,
) -> list[tuple[str, int]]:
    """Return list of (cap_id, cap_value) for triggered caps.

    L5 fail-closed principle: when in doubt, FAIL the plan rather than pass.
    Caps are STRICTLY enforced (no soft-cap variants, no '--skip-checks' flag).
    """
    triggered: list[tuple[str, int]] = []
    if not cov.is_complete:
        triggered.append(("coverage_lt_100", 49))
    if adr.total_adrs > 0 and adr.completeness_ratio < 1.0:
        triggered.append(("adr_without_alternatives", 70))
    if tdd.total_bugfix_tasks > 0 and tdd.coverage_ratio < 1.0:
        triggered.append(("bugfix_without_tdd", 70))
    if evidence is not None and evidence.unresolved_citations:
        triggered.append(("fabricated_citation", 49))
    if executability is not None and executability.soft_cap_triggered:
        # Heuristic-grade soft cap — Acceptance Criteria not executable enough.
        # See check_criterion_executability.py for the gate thresholds.
        triggered.append(("vague_acceptance_criteria", 70))
    return triggered


def _apply_conservative_floor(
    score: float, smells_total_hits: int, cov: CoverageReport
) -> tuple[float, str | None]:
    """L5 conservative bias: when signals indicate risk, never give SHIPPABLE.

    Fail-closed rules:
      1) If smell density is suspicious (>= 30 hits in prose-stripped content),
         cap final at 89 (SHIPPABLE -> SHIPPABLE_WITH_CAVEATS).
      2) If coverage is borderline (ratio in [0.9, 1.0) but is_complete due to
         deferred items), cap final at 89.

    These caps are SOFT (cap but don't trigger INVALID); they enforce the
    "false-positive over false-negative" principle.
    """
    reason: str | None = None
    soft_cap = 100.0

    if smells_total_hits >= 30:
        soft_cap = min(soft_cap, 89.0)
        reason = "smell_density_high"
    if cov.deferred_gaps > 0 and cov.total_gaps > 0:
        deferred_ratio = cov.deferred_gaps / cov.total_gaps
        if deferred_ratio > 0.2:  # >20% of gaps deferred
            soft_cap = min(soft_cap, 89.0)
            reason = reason or "high_deferred_ratio"

    if score > soft_cap:
        return soft_cap, reason
    return score, None


def run_structural(
    plan_path: Path,
    rubric_path: Path = DEFAULT_RUBRIC,
    thresholds_path: Path = DEFAULT_THRESHOLDS,
) -> StructuralScoreReport:
    """Main orchestrator."""
    plan_version = _read_plan_version(plan_path)
    # Validate rubric parses (raises if malformed) — content used inside check_spec_smells.
    load_rubric(rubric_path)
    bands = _load_thresholds(thresholds_path) if thresholds_path.exists() else [
        ("SHIPPABLE", 90), ("SHIPPABLE_WITH_CAVEATS", 70),
        ("NON_SHIPPABLE", 50), ("INVALID", 0),
    ]

    # Run checkers
    cov = check_coverage_matrix(plan_path)
    adr = check_adr_completeness(plan_path)
    tdd = check_tdd_in_bugfix(plan_path)
    smells = check_spec_smells(plan_path, rubric_path)
    compliance = check_architecture_compliance(plan_path)
    evidence = check_evidence_citations(plan_path, _find_repo_root_from_plan(plan_path))
    executability = check_criterion_executability(plan_path)

    # Compute per-dimension scores
    completeness, completude_motivos = _compute_completude(cov, adr, tdd)
    risco, risco_motivos = _compute_risco(smells)

    # ADR D8 — renormalize for active dimensions
    active = M2_ACTIVE_DIMENSIONS[:]
    normalized_weights = renormalize_weights(active)
    norm_factor = sum(SOTA_WEIGHTS[d] for d in active)  # e.g., M2: 0.30+0.20=0.50

    weighted_avg = (
        normalized_weights["completeness"] * completeness
        + normalized_weights["structural_risk"] * risco
    )

    # Hard caps (strict, fail-closed)
    triggered = _detect_hard_caps(cov, adr, tdd, evidence, executability)
    hard_cap_ids = [t[0] for t in triggered]
    if triggered:
        smallest_cap = min(t[1] for t in triggered)
        final_score = min(weighted_avg, float(smallest_cap))
    else:
        final_score = weighted_avg

    # L5 conservative soft-floor (fail-closed bias)
    final_score, soft_reason = _apply_conservative_floor(
        final_score, smells.total_hits, cov
    )
    if soft_reason:
        hard_cap_ids.append(f"soft_floor_{soft_reason}")

    # L6 architecture compliance soft cap: plans that don't reference any rule
    # in `.claude/rules/` (compliance_score < 0.4) cap at 89 (RESSALVAS max).
    # This is the user's "TODAS etapas devem estar 100% alinhadas a .claude/rules/"
    # contract — surfaces non-alignment as a visible deduction.
    if compliance.compliance_score < 0.4 and final_score > 89.0:
        final_score = 89.0
        hard_cap_ids.append("soft_floor_low_architecture_compliance")

    verdict = _lookup_verdict(final_score, bands)
    # Hard caps "coverage_lt_100" and "fabricated_citation" force INVALID regardless of bands.
    if "coverage_lt_100" in hard_cap_ids or "fabricated_citation" in hard_cap_ids:
        verdict = "INVALID"

    evidence_motivos: list[Motivo] = []
    if evidence.total_citations > 0:
        resolved_count = evidence.total_citations - len(evidence.unresolved_citations)
        if resolved_count > 0:
            evidence_motivos.append(
                Motivo(sign="positive", label=f"{resolved_count} citations resolved", weight=float(resolved_count))
            )
        if evidence.unresolved_citations:
            evidence_motivos.append(
                Motivo(
                    sign="negative",
                    label=f"{len(evidence.unresolved_citations)} fabricated citation(s)",
                    weight=-float(len(evidence.unresolved_citations)),
                )
            )

    motivos_map: dict[str, list[Motivo]] = {
        "completeness": completude_motivos,
        "evidence": evidence_motivos,
        "calibration": [],  # M5 future
        "structural_risk": risco_motivos,
    }

    return StructuralScoreReport(
        plan_slug=plan_path.stem.removesuffix("-plan"),
        plan_path=str(plan_path),
        plan_version=plan_version,
        scored_at=datetime.now(tz=timezone.utc).isoformat(timespec="seconds"),
        completude_score=round(completeness, 2),
        risco_estrutural_score=round(risco, 2),
        active_dimensions=active,
        weight_normalization_factor=round(1.0 / norm_factor, 4),
        weighted_avg=round(weighted_avg, 2),
        hard_caps_triggered=hard_cap_ids,
        final_score_after_caps=round(final_score, 2),
        verdict=verdict,
        reasons=motivos_map,
        sub_reports={
            "coverage_matrix": {
                "total_gaps": cov.total_gaps,
                "mapped_gaps": cov.mapped_gaps,
                "coverage_ratio": cov.coverage_ratio,
                "is_complete": cov.is_complete,
                "orphan_tasks": list(cov.orphan_tasks),
                "unmapped_gaps": list(cov.unmapped_gaps),
            },
            "adr_completeness": {
                "total_adrs": adr.total_adrs,
                "with_alternatives": adr.with_alternatives,
                "completeness_ratio": adr.completeness_ratio,
                "missing_alternatives": list(adr.missing_alternatives),
            },
            "tdd_in_bugfix": {
                "total_bugfix_tasks": tdd.total_bugfix_tasks,
                "with_tdd": tdd.with_tdd,
                "coverage_ratio": tdd.coverage_ratio,
                "missing_tdd": list(tdd.missing_tdd),
            },
            "spec_smells": {
                "total_hits": smells.total_hits,
                "by_category": dict(smells.by_category),
                "total_penalty": smells.total_penalty,
            },
            "architecture_compliance": {
                "compliance_score": compliance.compliance_score,
                "project_rules_found_count": len(compliance.project_rules_found),
                "fallback_to_defaults": compliance.fallback_to_defaults,
                "rules_referenced_in_plan": list(compliance.rules_referenced_in_plan),
                "principles_cited": list(compliance.principles_cited),
                "has_dod_quality_signal": compliance.has_dod_quality_signal,
                "has_size_budget_signal": compliance.has_size_budget_signal,
                "reasons": list(compliance.reasons),
            },
            "evidence": {
                "total_citations": evidence.total_citations,
                "unresolved_citations": [
                    {
                        "kind": c.kind,
                        "raw_text": c.raw_text,
                        "location_line": c.location_line,
                        "reason": c.reason,
                    }
                    for c in evidence.unresolved_citations
                ],
            },
            "criterion_executability": {
                "total_criteria": executability.total_criteria,
                "vague_count": executability.vague_count,
                "weak_count": executability.weak_count,
                "acceptable_count": executability.acceptable_count,
                "executable_count": executability.executable_count,
                "vague_ratio": round(executability.vague_ratio, 3),
                "acceptable_ratio": round(executability.acceptable_ratio, 3),
                "executable_ratio": round(executability.executable_ratio, 3),
                "soft_cap_triggered": executability.soft_cap_triggered,
                "vague_criteria_sample": [
                    c.text for c in executability.criteria if c.score == 0
                ][:5],
            },
        },
    )


def _exit_code(verdict: str) -> int:
    if verdict in ("SHIPPABLE", "SHIPPABLE_WITH_CAVEATS"):
        return 0
    if verdict == "INVALID":
        return 1
    if verdict == "NON_SHIPPABLE":
        return 3
    return 2


def _calibration_status() -> tuple[str, int, int]:
    """Return (status, holdout_count, target).

    Fix #1+#6: warns users when thresholds are still PROVISIONAL.
    Calibration is PRODUCTION_v1 only when N>=target AND a `.calibrated`
    marker file exists in the holdout dir (set after Cohen's kappa>=0.6 check).
    """
    if not HOLDOUT_DIR.exists():
        return ("PROVISIONAL_v1", 0, HOLDOUT_TARGET)
    entries = [
        p for p in HOLDOUT_DIR.iterdir()
        if p.is_file() and p.suffix == ".md" and p.name != "README.md"
    ]
    count = len(entries)
    calibrated_marker = HOLDOUT_DIR / ".calibrated"
    if count >= HOLDOUT_TARGET and calibrated_marker.exists():
        return ("PRODUCTION_v1", count, HOLDOUT_TARGET)
    return ("PROVISIONAL_v1", count, HOLDOUT_TARGET)


def _emit_calibration_warning() -> None:
    status, count, target = _calibration_status()
    if status == "PROVISIONAL_v1":
        print(
            f"WARN: thresholds are PROVISIONAL_v1 (calibration pending; "
            f"{count}/{target} holdout entries; Cohen's kappa not yet measured). "
            f"Score is structurally meaningful but cutoffs (49/70/90) are not "
            f"yet empirically validated. See `.claude/rules/plan-confidence-thresholds.txt`.",
            file=sys.stderr,
        )


def _find_repo_root_from_plan(plan_path: Path) -> Path:
    """Walk up from the plan path looking for a project-root marker.

    Recognizes (in order of preference):
      - `.git/`
      - `.claude/` (when the plan is NOT inside a `.claude/` subtree)
      - `plugin.json` (Claude Code plugin manifest — the canonical `plan` repo signature)
      - `rules/` directory paired with `skills/` (the planning ecosystem layout)
    """
    cur = plan_path.resolve().parent
    for _ in range(20):
        if ".claude" not in cur.parts:
            if (cur / ".git").exists():
                return cur
            if (cur / ".claude").exists():
                return cur
            if (cur / "plugin.json").exists():
                return cur
            if (cur / "rules").is_dir() and (cur / "skills").is_dir():
                return cur
        if cur == cur.parent:
            break
        cur = cur.parent
    return plan_path.resolve().parent


# T2.1 (R4.x / harden-fab-and-cq-gate) — code-quality subprocess + merge logic
# extracted to `skills/code-quality/scripts/cq_invoke.py` as the shared helper
# consumed by both this orchestrator and `skills/implement/scripts/run_validation.py`.
# Keeps wiring triad pillar (a) honest: cq_invoke.merge_verdict_into_plan_confidence
# has a real production caller below (previously this file kept private copies that
# starved the public helper of a caller — captured by judge-codex implementation stage
# on 2026-06-04 as wiring_triad_missing_caller_cq_merge_helper).
_CQ_INVOKE_DIRS = [
    Path(__file__).resolve().parent.parent.parent / "code-quality" / "scripts",
    Path(__file__).resolve().parent.parent.parent.parent / "skills" / "code-quality" / "scripts",
]
for _cq_dir in _CQ_INVOKE_DIRS:
    if _cq_dir.exists():
        sys.path.insert(0, str(_cq_dir))
        break

try:
    import cq_invoke  # type: ignore[import-not-found]
except ImportError:
    cq_invoke = None  # type: ignore[assignment]


def _merge_code_quality_verdict(out: dict, cq_summary: dict) -> None:
    """Thin wrapper around `cq_invoke.merge_verdict_into_plan_confidence` for
    backward compatibility with existing call sites + the test suite that
    imports this symbol via `from run_structural import _merge_code_quality_verdict`.
    """
    if cq_invoke is None:
        return
    cq_invoke.merge_verdict_into_plan_confidence(out, cq_summary)


def _invoke_code_quality(plan_slug: str, repo_root: Path, timeout_s: int = 600) -> dict | None:
    """Thin wrapper around `cq_invoke.invoke`. Kept for backward compatibility
    with the test suite (`test_run_structural.py` imports the symbol).
    """
    if cq_invoke is None:
        return None
    return cq_invoke.invoke(plan_slug, repo_root, timeout_s=timeout_s)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run M2 structural plan-confidence scoring.")
    parser.add_argument("plan", help="plan slug (e.g., 'plan-confidence-setup') or .md path")
    parser.add_argument("--rubric", default=str(DEFAULT_RUBRIC))
    parser.add_argument("--thresholds", default=str(DEFAULT_THRESHOLDS))
    parser.add_argument("--no-warn", action="store_true", help="suppress calibration warning")
    parser.add_argument(
        "--no-code-quality",
        action="store_true",
        help="skip /code-quality runtime integration (T6.5)",
    )
    args = parser.parse_args(argv)

    try:
        plan_path = _resolve_plan_path(args.plan)
    except FileNotFoundError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    try:
        report = run_structural(plan_path, Path(args.rubric), Path(args.thresholds))
    except (FileNotFoundError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    if not args.no_warn:
        _emit_calibration_warning()

    out = asdict(report)
    out["reasons"] = {
        k: [asdict(m) for m in v] for k, v in report.reasons.items()
    }
    # Embed calibration status in the JSON output for auditability.
    cal_status, cal_count, cal_target = _calibration_status()
    out["calibration"] = {
        "status": cal_status,
        "holdout_count": cal_count,
        "holdout_target": cal_target,
        "kappa_measured": False,
    }

    # T6.5 / EC-29 — runtime integration with /code-quality skill.
    if not args.no_code_quality:
        repo_root = _find_repo_root_from_plan(plan_path)
        cq_summary = _invoke_code_quality(report.plan_slug, repo_root)
        if cq_summary:
            cq_caps = list(cq_summary.get("hard_caps_triggered", []))
            cq_soft = list(cq_summary.get("soft_caps_triggered", []))
            out["code_quality"] = {
                "verdict": cq_summary.get("verdict"),
                "score_cap": cq_summary.get("score_cap"),
                "hard_caps_triggered": cq_caps,
                "soft_caps_triggered": cq_soft,
                "languages_audited": cq_summary.get("languages_audited", []),
            }
            # Severity-tier-aware merge (bug fix 2026-05-23: previous logic blindly
            # forced INVALID on any cq cap entry, neutralizing allowlist downgrades).
            _merge_code_quality_verdict(out, cq_summary)
        else:
            out["code_quality"] = {"verdict": "UNAVAILABLE", "reason": "invocation failed or skipped"}

    print(json.dumps(out, indent=2, ensure_ascii=False))
    return _exit_code(out.get("verdict", report.verdict))


if __name__ == "__main__":
    sys.exit(main())
