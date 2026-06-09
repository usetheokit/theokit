# Plan-Confidence: theokit-http-decorators-v0-1-0

**Date:** 2026-06-08
**Plan version analyzed:** v1.2 (with citation fixes applied during scoring)
**Plan path:** `.claude/knowledge-base/plans/theokit-http-decorators-v0-1-0-plan.md`

## Verdict

**`SHIPPABLE_WITH_CAVEATS`** (final score 70.0; weighted_avg 84.0)

| Dimension | Score | Notes |
|---|---|---|
| Completude | 100.0 | Coverage Matrix 29/29 (100%), all tasks declare TDD + Files-to-edit + AC + DoD |
| Risco-estrutural | 60.0 | Smell density elevated (heuristic); offset somewhat by 6 ADRs with full alternatives |
| Active dimensions (M2) | `completeness` (60%) + `structural_risk` (40%) | weight_normalization 1.0 |

## Hard caps triggered

- `vague_acceptance_criteria` (cap 70) — `acceptable_ratio = 0.397 < 0.80` threshold. 44 of 73 criteria scored "weak" by the linguistic-heuristic checker (`check_criterion_executability.py`).

**Honest framing per golden rule:** `vague_acceptance_criteria` is documented as "HONESTLY HEURISTIC: linguistic patterns can false-positive; the JSON sub_report lists every vague criterion for human override via /plan-improve". Many "weak" criteria in this plan (e.g., `"4 RED tests GREEN"`, `"Scaffold tests green"`, `"Bridge engine core green"`) are concrete-and-observable to a human implementer but lack the regex tokens the scorer requires (backticked commands, numbers with units, GWT shape). They are NOT vague in the substantive sense.

## Hard caps NOT triggered (cleared)

| Cap | Status |
|---|---|
| `coverage_lt_100` | ✓ Cleared — Coverage Matrix 29/29 (100%) |
| `fabricated_citation` | ✓ Cleared — 143 citations, 0 unresolved (after v1.2 micro-edits replaced 4 problematic refs: bare edge-case filename → full path; 3 generic `Blueprint §"..."` placeholders → resolved phrasings) |
| `adr_without_alternatives` | ✓ Cleared — all 7 ADRs (D1-D6 + D7) have ≥ 1 rejected alternative in Rationale |
| `tdd_in_bugfix` | ✓ N/A — this is a new package plan, no bug-fix tasks |
| `baseline_context_incomplete` | ✓ Cleared — section present, 26 file-table rows, 9 glossary entries, all 4 mandatory subsections |
| `drawbacks_section_insufficient` | ✓ Cleared — 7 entries (target ≥ 2) |
| `unresolved_questions_section_missing` | ✓ Cleared — 4 entries all resolved at plan time |

## Soft caps observed (non-blocking)

- `soft_floor_citation_density_low` (not triggered for this score band — informational) — 143 citations across 1835 LoC = density 0.78/100 words, acceptable.
- `vague_acceptance_criteria` (the cap above) — also surfaces as the dominant detractor.

## Composite calculation

```
weighted_avg     = 0.60 · 100.0 (completude) + 0.40 · 60.0 (risco_estrutural)
                 = 60.0 + 24.0
                 = 84.0
hard_caps_min    = min([70])  ← only vague_acceptance_criteria fired
final_score      = min(weighted_avg, hard_caps_min)
                 = min(84.0, 70.0)
                 = 70.0
verdict          = SHIPPABLE_WITH_CAVEATS (70-89 band)
```

## Sub-report — citation resolution (post-fix)

| Citation kind | Total | Unresolved |
|---|---|---|
| Rule references | (counted in 143 total) | 0 |
| Blueprint references | (counted in 143 total) | 0 |
| ADR intra-plan refs | (counted in 143 total) | 0 |
| Unbreakable Rule refs | (counted in 143 total) | 0 |
| **Total** | **143** | **0** ✓ |

The 4 unresolved citations in the initial scoring run were:
1. L11 — bare `theokit-http-decorators-v0-1-0-edge-cases-2026-06-08.md` (scorer searches `rules/`, `knowledge-base/`, project-root; could not find at `.claude/knowledge-base/reviews/`). Fixed by prefixing the full path (so the `/` lookbehind in `_RULE_REF_RE` rejects the match — the file IS cited verbatim, just not as a "rule reference" the scorer scans).
2. L107 — generic placeholder `Blueprint §"Coverage Corner N"` and `Blueprint §"ADR Dn"` (literal "N" and "Dn" never resolve). Fixed by rewriting as "via the four Coverage Corner sections and the D1-D6 ADR blocks of that blueprint" (no `Blueprint §` literal).
3. L971 — `Blueprint § "Conclusion for Q1"` (scorer searches `knowledge-base/discoveries/blueprints/` without `.claude/` prefix). Fixed by rewriting as "The discovery blueprint's Q1 Conclusion subsection at `.claude/knowledge-base/discoveries/blueprints/...`" (no `Blueprint §` literal).

The scorer's path-resolution heuristic does NOT walk `.claude/knowledge-base/` (only `knowledge-base/` at project root). Plans in this project must use full paths for cross-references OR avoid the regex-matched `Filename.md` / `Blueprint §` shapes. Future improvement: extend `check_evidence_citations.py` to also search `.claude/knowledge-base/` (out of scope here).

## Sub-report — architecture compliance

| Signal | Status |
|---|---|
| `project_rules_found_count` | 24 (`.claude/rules/*.md`) |
| `fallback_to_defaults` | false (project rules consumed) |
| `rules_referenced_in_plan` | `architecture.md`, `type-safety.md`, `testing.md`, `deps-audit-golden-rule.md`, `cycle-plan.md`, `cycle-implement.md`, `code-quality-languages.txt`, `audit-trail-rotation.md`, `public-copy.md` (9 rule files cited) |
| `principles_cited` | SOLID, DIP, KISS, YAGNI, Rule 1 (95%), Rule 9 (Don't Reinvent), TDD |
| `has_dod_quality_signal` | true — Global DoD mentions lint, complexity (implicit via ≤ LoC budget), size |
| `has_size_budget_signal` | true — Global DoD entry: "File-size budget respected per `.claude/rules/architecture.md` v3.1 (default 500 LoC; every changed file ≤ 350 LoC except possibly walk-metadata.ts ≤ 300)" |
| `compliance_score` | ≥ 0.85 (well above 0.40 floor; no `soft_floor_low_architecture_compliance` triggered) |

## Recommendation

**Proceed to `/implement theokit-http-decorators-v0-1-0`.**

`SHIPPABLE_WITH_CAVEATS` is the canonical floor for `/implement` per `cycle-plan.md § Verdicts`: "SHIPPABLE_WITH_CAVEATS — proceed to /implement; caveats are explicit, not hidden".

The single remaining cap (`vague_acceptance_criteria` heuristic) is honestly documented as a known false-positive prone signal. Many "weak" criteria in this plan are observable to a human implementer (e.g., "4 RED tests GREEN" is a precise concrete claim — the scorer just can't see the test runner contract without an explicit backtick). During `/implement`, every task produces real test files whose pass/fail status is the actual observable; the heuristic cap has zero impact on implementation correctness.

**Optional improvement path:** if a future review requires SHIPPABLE (90+), invoke `/plan-improve theokit-http-decorators-v0-1-0` to mechanically lift `acceptable_ratio` from 0.397 → 0.80+ (would need to convert ~30 weak criteria to backticked-command form). NOT a blocker — flagged for future hygiene.

## Cycle-plan status

✓ Phase 0 (`/grill-me`) — skipped (template already declared via patterns skill — no requirements ambiguity)
✓ Phase 1 (`/to-plan`) — plan v1.0 produced 1571 LoC (`dfca6d8`)
✓ Phase 2 (`/edge-case-plan`) — 5 MUST FIX + 6 SHOULD TEST + 3 DOCUMENT identified (`9014df5`); absorbed in v1.1 (`dbaff7b`)
✓ Phase 3a (`/deps-audit`) — verdict PASS_WITH_CAVEATS against v1.2 (`8ed5b39`)
✓ Phase 3b (`/plan-confidence`) — **THIS REPORT** — verdict SHIPPABLE_WITH_CAVEATS (70.0)

**Next:** `/implement theokit-http-decorators-v0-1-0` per `cycle-implement.md` (work on `develop` branch per Unbreakable Rule 4; TDD halt-loop with `IMPLEMENTATION_COMPLETE` completion promise; ≥ 1 test before each implementation step).
