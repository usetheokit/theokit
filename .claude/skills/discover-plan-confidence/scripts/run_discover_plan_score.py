#!/usr/bin/env python3
"""Run M2 structural discover-plan-confidence scoring.

Sibling of discover-confidence/scripts/run_blueprint_score.py — same architecture,
different artifact (discovery PLAN, not blueprint) and different node-3 checker
(check_plan_completeness instead of check_blueprint_completeness).

Hard caps enforced (per discover-plan-golden-rule.md):
  - empty_corner_{tests|deps|tools|techniques} (49)
  - fabricated_citation (49)
  - mandatory_section_missing (70)
  - insufficient_adrs (70)
  - question_budget_violated (70)
  - method_missing (70)

Soft caps (per rubric-discover-plan.md):
  - soft_floor_smell_density_high (89)
  - soft_floor_citation_density_low (89)

Copy-with-attribution from sibling (2026-05-30) per D1 of the discover-plan-confidence plan.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Allow sibling imports when invoked directly
sys.path.insert(0, str(Path(__file__).parent))

from _rubric_loader import load_rubric  # noqa: E402
from check_plan_completeness import check_plan_completeness  # noqa: E402
from check_reference_citations import check_reference_citations  # noqa: E402
from check_research_coverage import check_research_coverage  # noqa: E402
from check_spec_smells import check_spec_smells  # noqa: E402


SKILL_ROOT = Path(__file__).parent.parent


def _find_project_root(start: Path) -> Path:
    current = start.resolve().parent if start.is_file() else start.resolve()
    while current != current.parent:
        if (current / ".claude").exists() or (current / ".git").exists():
            return current
        current = current.parent
    return start.resolve().parent if start.is_file() else start.resolve()


def _resolve_plan(arg: str) -> Path:
    p = Path(arg)
    if p.exists() and p.suffix == ".md":
        return p.resolve()
    candidates = [
        Path(".claude/knowledge-base/discoveries/plans") / f"{arg}-plan.md",
        Path(".claude/knowledge-base/discoveries/plans") / f"{arg}.md",
    ]
    for c in candidates:
        if c.exists():
            return c.resolve()
    raise FileNotFoundError(f"Could not resolve discovery plan: {arg}")


def _resolve_rubric(arg: Path | None) -> Path:
    if arg and arg.exists():
        return arg
    return SKILL_ROOT / "templates" / "rubric-discover-plan.md"


def _resolve_thresholds(arg: Path | None, plan_path: Path) -> Path:
    if arg and arg.exists():
        return arg
    project_root = _find_project_root(plan_path)
    project_thresh = project_root / ".claude" / "rules" / "discover-plan-thresholds.txt"
    if project_thresh.exists():
        return project_thresh
    return SKILL_ROOT / "templates" / "discover-plan-thresholds.example.txt"


def _parse_thresholds(path: Path) -> dict[str, int]:
    bands: dict[str, int] = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) >= 2:
            try:
                bands[parts[0]] = int(parts[1])
            except ValueError:
                continue
    return bands


def _verdict_for(score: float, bands: dict[str, int]) -> str:
    sorted_bands = sorted(bands.items(), key=lambda kv: kv[1], reverse=True)
    for name, threshold in sorted_bands:
        if score >= threshold:
            return name
    return "INVALID"


def main() -> int:
    parser = argparse.ArgumentParser(description="Run M2 structural discover-plan-confidence scoring.")
    parser.add_argument("plan", help="plan slug or .md path")
    parser.add_argument("--rubric", type=Path, default=None)
    parser.add_argument("--thresholds", type=Path, default=None)
    parser.add_argument("--no-warn", action="store_true", help="suppress calibration warning")
    args = parser.parse_args()

    try:
        plan_path = _resolve_plan(args.plan)
    except FileNotFoundError as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        return 2

    rubric_path = _resolve_rubric(args.rubric)
    thresholds_path = _resolve_thresholds(args.thresholds, plan_path)
    bands = _parse_thresholds(thresholds_path)

    # Run all four checkers
    coverage = check_research_coverage(plan_path)
    citations = check_reference_citations(plan_path)
    completeness = check_plan_completeness(plan_path)
    smells = check_spec_smells(plan_path, rubric_path)

    # Compute per-dimension scores (0-100)
    rc_score = 100.0 * coverage["corners_populated"] / coverage["corners_total"]

    if citations["total"] == 0:
        rcit_score = 100.0
    else:
        rcit_score = 100.0 * citations["verified"] / citations["total"]

    pc_score = 100.0 * completeness["found"] / completeness["total_required"]

    re_score = max(0.0, 100.0 + smells.total_penalty)  # penalty is negative

    # Weighted average per rubric
    weights = {
        "research_coverage": 0.30,
        "reference_citations": 0.30,
        "plan_completeness": 0.25,
        "structural_risk": 0.15,
    }
    weighted = (
        weights["research_coverage"] * rc_score
        + weights["reference_citations"] * rcit_score
        + weights["plan_completeness"] * pc_score
        + weights["structural_risk"] * re_score
    )

    # Hard caps
    hard_caps_triggered: list[str] = []
    cap_value: float = 100.0

    # Node 1: research_coverage
    for empty in coverage["empty_corners"]:
        hard_caps_triggered.append(f"empty_corner_{empty}")
        cap_value = min(cap_value, 49.0)

    # Node 2: reference_citations
    if citations["fabricated"] > 0:
        hard_caps_triggered.append("fabricated_citation")
        cap_value = min(cap_value, 49.0)

    # Node 3: plan_completeness — bundles 4 sub-checks per check_plan_completeness module docstring
    if completeness["missing_mandatory"]:
        hard_caps_triggered.append("mandatory_section_missing")
        cap_value = min(cap_value, 70.0)

    if completeness["adr_count"] < 2:
        hard_caps_triggered.append("insufficient_adrs")
        cap_value = min(cap_value, 70.0)

    if completeness["budget_violations"]:
        hard_caps_triggered.append("question_budget_violated")
        cap_value = min(cap_value, 70.0)

    if completeness["methodless_questions"]:
        hard_caps_triggered.append("method_missing")
        cap_value = min(cap_value, 70.0)

    # Soft caps (conservative bias) — prefix soft_floor_ but do NOT trigger INVALID
    if smells.total_hits >= 20:
        hard_caps_triggered.append("soft_floor_smell_density_high")
        cap_value = min(cap_value, 89.0)

    citation_density = citations["citation_density_per_200w"]
    if 0 < citations["total"] and citation_density < 1.0:
        hard_caps_triggered.append("soft_floor_citation_density_low")
        cap_value = min(cap_value, 89.0)

    final_score = min(weighted, cap_value)
    verdict = _verdict_for(final_score, bands)

    # Build reasons
    reasons = {
        "research_coverage": {
            "contributors": coverage["contributors"],
            "detractors": coverage["detractors"],
        },
        "reference_citations": {
            "contributors": citations["contributors"],
            "detractors": citations["detractors"],
        },
        "plan_completeness": {
            "contributors": completeness["contributors"],
            "detractors": completeness["detractors"],
        },
        "structural_risk": {
            "contributors": [f"{smells.total_hits} smell hits across categories"]
            if smells.total_hits == 0
            else [],
            "detractors": [
                f"{cat}: {count} hits"
                for cat, count in sorted(smells.by_category.items(), key=lambda x: -x[1])[:3]
            ],
        },
    }

    sub_reports: dict[str, Any] = {
        "research_coverage": coverage,
        "reference_citations": citations,
        "plan_completeness": completeness,
        "structural_risk": {
            "total_hits": smells.total_hits,
            "by_category": smells.by_category,
            "total_penalty": smells.total_penalty,
        },
    }

    slug = plan_path.stem.replace("-plan", "")

    out = {
        "plan_slug": slug,
        "plan_path": str(plan_path),
        "plan_version": None,  # TODO: parse from H1 line or "Version" tag
        "scored_at": datetime.now(timezone.utc).isoformat(),
        "research_coverage_score": round(rc_score, 1),
        "reference_citations_score": round(rcit_score, 1),
        "plan_completeness_score": round(pc_score, 1),
        "risco_estrutural_score": round(re_score, 1),
        "active_dimensions": [
            "research_coverage",
            "reference_citations",
            "plan_completeness",
            "structural_risk",
        ],
        "weight_normalization_factor": 1.0,
        "weighted_avg": round(weighted, 1),
        "hard_caps_triggered": hard_caps_triggered,
        "final_score_after_caps": round(final_score, 1),
        "verdict": verdict,
        "calibration": {
            "status": "PROVISIONAL_v1",
            "holdout_count": 0,
            "holdout_target": 30,
            "kappa_measured": False,
        },
        "reasons": reasons,
        "sub_reports": sub_reports,
    }

    print(json.dumps(out, indent=2))

    if not args.no_warn and out["calibration"]["status"] == "PROVISIONAL_v1":
        print("WARN: PROVISIONAL_v1 calibration — score bands are SOTA defaults, not yet calibrated against project holdout.", file=sys.stderr)

    if verdict == "INVALID":
        return 1
    if verdict == "NON_SHIPPABLE":
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
