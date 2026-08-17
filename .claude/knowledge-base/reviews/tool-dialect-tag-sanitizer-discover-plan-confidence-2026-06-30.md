# Discover-Plan-Confidence — tool-dialect-tag-sanitizer

**Date:** 2026-06-30
**Plan:** `.claude/knowledge-base/discoveries/plans/tool-dialect-tag-sanitizer-plan.md` (v1.1)
**Verdict:** **SHIPPABLE_WITH_CAVEATS** — final score **89.0** (weighted_avg 99.2)

## Dimension scores

| Dimension | Score | Notes |
|---|---|---|
| research_coverage | 100.0 | 4/4 corners populated (tests/deps/tools/techniques), 0 empty |
| reference_citations | 100.0 | **6/6 citations verified, 0 fabricated** — the EC-1 Q2 repoint to `openai-chat.ts` is reflected; no path fabrication |
| plan_completeness | 100.0 | 10/10 mandatory sections, 3 ADRs (≥2 required), question budget OK (5 Qs) |
| structural_risk | 95.0 | 2 minor smell hits (1 vague_pronoun, 1 weak_imperative) → −5 penalty |

## Caps triggered

- `soft_floor_citation_density_low` — citation density 0.72 per 200 words (below the 1.0 floor). **Caveat accepted, not fixed:** the plan is deliberately concise (1669 words, 6 real references + the in-repo think-tag precedent); padding it with redundant citations to lift the density ratio would be noise (anti-pattern). The 6 citations are all verified and load-bearing. This is a soft floor (cap 89), NOT a hard cap — no structural defect.

## Gate decision

Verdict ≥ SHIPPABLE_WITH_CAVEATS → **plan is structurally sound; proceed to `/discover-execute`.** The single caveat is cosmetic (density ratio), explicitly accepted. No hard cap fired (no empty corner, no fabricated citation, no missing section, no budget violation).

> Calibration note: scorer reports `PROVISIONAL_v1` (SOTA-default bands, holdout not yet calibrated). The hard-cap checks (coverage corners, citation existence) are deterministic and unaffected by calibration status.
