# Score Report Template

The `run_structural.py` orchestrator emits a JSON object matching this schema. Use this template to validate output and to render a human-readable report from the JSON.

## JSON Schema (canonical)

```json
{
  "plan_slug": "example-plan-slug",
  "plan_path": ".claude/knowledge-base/plans/example-plan-slug-plan.md",
  "plan_version": "1.0",
  "scored_at": "2026-05-17T00:00:00Z",
  "completude_score": 95.0,
  "structural_risk_score": 80.0,
  "active_dimensions": ["completeness", "structural_risk"],
  "weight_normalization_factor": 1.6666666666666667,
  "weighted_avg": 89.0,
  "hard_caps_triggered": [],
  "final_score_after_caps": 89.0,
  "verdict": "SHIPPABLE_WITH_CAVEATS",
  "reasons": {
    "completeness": [
      {"sign": "positive", "label": "Coverage Matrix 100%", "weight": 60.0},
      {"sign": "positive", "label": "All ADRs have alternatives", "weight": 20.0},
      {"sign": "positive", "label": "All bug-fix tasks have TDD", "weight": 20.0}
    ],
    "evidence": [],
    "calibration": [],
    "structural_risk": [
      {"sign": "negative", "label": "5 weak_imperatives hits", "weight": -15.0},
      {"sign": "negative", "label": "2 loopholes hits", "weight": -6.0},
      {"sign": "neutral", "label": "0 subjective_adjectives", "weight": 0.0}
    ]
  },
  "sub_reports": {
    "coverage_matrix": {
      "total_gaps": 15,
      "mapped_gaps": 15,
      "coverage_ratio": 1.0,
      "is_complete": true,
      "orphan_tasks": []
    },
    "adr_completeness": {
      "total_adrs": 8,
      "with_alternatives": 8,
      "completeness_ratio": 1.0
    },
    "tdd_in_bugfix": {
      "total_bugfix_tasks": 0,
      "with_tdd": 0,
      "coverage_ratio": 1.0
    },
    "spec_smells": {
      "total_hits": 7,
      "by_category": {
        "weak_imperatives": 5,
        "loopholes": 2
      },
      "total_penalty": -21
    }
  }
}
```

## Field Semantics

### Top-level

- **plan_slug** (str): basename of plan file without `-plan.md` suffix.
- **plan_path** (str): path relative to project root.
- **plan_version** (str): parsed from the `> **Version X.Y**` line in the plan, or `"unknown"`.
- **scored_at** (ISO 8601 str): when the score was computed.
- **completude_score** (float 0-100): Completude factual score (M2 dimension active).
- **structural_risk_score** (float 0-100): Technical risk score, M2 part only (smells).
- **active_dimensions** (list[str]): dimensions actually scored. M2: `["completeness", "structural_risk"]`. M3+ will add `"evidence"`. M5+ will add `"calibration"`.
- **weight_normalization_factor** (float): ADR D8. Factor used to normalize SOTA weights (0.30/0.30/0.20/0.20) to active dimensions. In M2 with `(0.30 + 0.20) / 0.50 = 1.0` → factor for completeness is `0.30/0.50 = 0.6`; for structural_risk is `0.20/0.50 = 0.4`.
- **weighted_avg** (float): `sum(weight * score for each active dimension)`.
- **hard_caps_triggered** (list[str]): identifiers of hard caps fired. Possible values: `"coverage_lt_100"`, `"adr_without_alternatives"`, `"bugfix_without_tdd"`, `"citation_fabricated"` (M3 future).
- **final_score_after_caps** (float): `min(weighted_avg, smallest_active_cap)`. Equal to `weighted_avg` if no caps fired.
- **verdict** (str): one of `"SHIPPABLE"`, `"SHIPPABLE_WITH_CAVEATS"`, `"NON_SHIPPABLE"`, `"INVALID"`. Looked up via `.claude/rules/plan-confidence-thresholds.txt`.

### reasons

Each dimension key maps to a list of `{sign, label, weight}` objects:

- **sign**: `"positive"` (contributes up), `"negative"` (contributes down), `"neutral"` (no effect or zero-count).
- **label**: human-readable description.
- **weight**: numeric contribution in points (positive for gains, negative for penalties).

Max 3 entries per dimension (top contributors). Empty list for dimensions not yet active (M2: evidence, calibration).

### sub_reports

Raw output from each underlying checker. Useful for auditability and debugging. Should always be present, even if empty.

## Human-Readable Rendering

When rendering JSON to user, follow this template:

```
Plan: {plan_slug} (v{plan_version})
Verdict: {verdict}  ─── Score: {final_score_after_caps}/100

Completude: {completude_score}/100
  + {reasons.completeness[0].label} (+{weight})
  + {reasons.completeness[1].label} (+{weight})
  - {reasons.completeness[2].label} ({weight})

Risco Estrutural: {structural_risk_score}/100
  ...

Active dimensions: {active_dimensions} (factor {weight_normalization_factor:.3f})
Hard caps: {hard_caps_triggered or "none"}
```

Color coding (when terminal supports):
- SHIPPABLE → green
- SHIPPABLE_WITH_CAVEATS → yellow
- NON_SHIPPABLE → orange
- INVALID → red

## Notes on M2 Scope

M2 only populates `completeness` and `structural_risk`. The `evidence` and `calibration` lists are intentionally empty until M3 and M5 respectively activate them.

`weight_normalization_factor` is the M2 mechanism (ADR D8) to keep the composite score range 0-100 instead of capping at 50 due to unscored dimensions. Without it, a perfect M2 plan would max at `0.30·100 + 0.20·100 = 50`. With renormalization, `0.30/0.50 = 0.6` and `0.20/0.50 = 0.4`, so max is `0.6·100 + 0.4·100 = 100`.
