# Discover-Plan Confidence — guardrails-module

**Date:** 2026-06-10
**Plan:** `.claude/knowledge-base/discoveries/plans/guardrails-module-plan.md` (v1.1)
**Scorer:** `run_discover_plan_score.py` (PROVISIONAL_v1 calibration)

## Verdict: SHIPPABLE_WITH_CAVEATS (70)

| Dimension | Score | Weight | Weighted |
|---|---|---|---|
| research_coverage | 100 | 0.30 | 30.0 |
| reference_citations | 100 | 0.30 | 30.0 |
| plan_completeness | 100 | 0.25 | 25.0 |
| risco_estrutural | 97 | 0.15 | 14.55 |
| **Weighted avg** | | | **99.5** |
| **After caps** | | | **70.0** |

## Hard caps triggered

| Cap | Stable ID | Impact |
|---|---|---|
| Techniques corner has 5 questions (max 3 per corner) | `question_budget_violated` | Capped at 70 |
| Citation density 0.7 per 200 words (target >= 1.0) | `soft_floor_citation_density_low` | Soft floor |

## What's strong

- **4/4 coverage corners populated** (tests, deps, tools, techniques)
- **7 reference citations verified** — zero fabricated
- **10/10 mandatory sections present** (Header through Global DoD)
- **3 ADRs** with rationale + alternatives considered
- **Every question has Fase A + Fase B** populated with concrete methods

## What needs attention

1. **Techniques corner overflow (5 > 3):** Q1, Q2, Q3, Q5, Q8 all map to "techniques". The budget rule says max 3 per corner. Options:
   - **Option A:** Re-classify Q5 (credential masking) as "tools" (it's about a specific tool pattern)
   - **Option B:** Re-classify Q8 (SDK audit) as "tools" (it's about existing tooling)
   - **Option C:** Add ADR D4 deferring the overflow with justification

2. **Citation density slightly low (0.7/200w):** The plan is well-structured but could cite more specific file:line references in the Context section.

## Recommendation

The plan is structurally sound — all critical gates pass. The techniques-corner overflow is a budget-shape issue, not a quality issue. **Proceed to `/discover-execute`** after applying one of the 3 options above to lift the cap from 70 → 90+.

Fastest fix: Option B — Q8 is literally "audit existing SDK tooling" which fits the Tools corner better than Techniques.
