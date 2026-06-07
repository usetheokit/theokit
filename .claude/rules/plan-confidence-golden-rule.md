# Plan-Confidence Golden Rule (INQUEBRÁVEL) 

> Promoted from skill template; per-project Source of Truth.

**Source of truth for the `/plan-confidence` skill's most important contract.**

## The Rule

**A plan is INVALID and CANNOT produce a SHIPPABLE verdict when:**

1. Coverage Matrix < 100% (gaps not mapped to tasks)
2. At least one fabricated citation (rule file, blueprint section, intra-plan ADR, or Unbreakable Rule referenced in prose does not resolve) — *M3 v0.1 active (rule files, blueprints, intra-plan ADRs, Unbreakable Rules 1..13). M3 v0.2 (code-file refs `src/foo.py:42`) deferred.*

This is NOT a guideline. It is a constraint enforced by the skill itself.
The skill SHALL fail-closed when an unbreakable rule is violated.

## What it requires

1. **Score capping.** Final score is capped at 49 when any unbreakable rule is violated — regardless of how high the weighted_avg would be.
2. **Mandatory verdict.** The returned verdict is `INVALID`, not `SHIPPABLE_WITH_CAVEATS` or any other band.
3. **Vocabulary lock.** The word "shippable" SHALL NOT appear in the report (unqualified) when the score is capped.
4. **Hard cap audit.** JSON output MUST list all triggered caps in `hard_caps_triggered` with stable identifiers (e.g., `"coverage_lt_100"`, `"adr_without_alternatives"`).
5. **Visual rendering.** When capped, the INVALID band appears in red (terminal with color; plain `[INVALID]` when no color).

## Why this rule exists

The SOTA literature documents that ~57% of citations in LLM systems are post-rationalizations (Wallat et al. 2024, `arXiv:2412.18004`). The model decides first and cites later. Without unbreakable hard caps, a plan with incomplete Coverage Matrix or fabricated citations can score high via composition (other dimensions perfect mask structural failure).

The lesson: **tests passing ≠ system works.** Applied to planning: **average scores ≠ implementable plan.** A plan with coverage gaps or fabricated claims will produce production bugs even if 90% of other checks are green.

The rule closes this gap by forcing minimum structural state PRESENT before the aggregate matters.

## Rules that cannot be bent

| Rule | Enforcement |
|---|---|
| Coverage Matrix present and 100% | M2 — `run_structural.py` via `check_coverage_matrix.py` |
| Fabricated citation → score ≤ 49 | M3 v0.1 — `check_evidence_citations.py` (regex + `Path.exists` + section grep); covers rule refs, Blueprint refs, intra-plan ADR refs, Unbreakable Rules 1..13. ADR `0001-m3-fabricated-citation-v01`. |
| ADR without alternatives in Rationale → score ≤ 70 | M2 — `check_adr_completeness.py` |
| Bug-fix task without TDD RED-GREEN-REFACTOR → score ≤ 70 | M2 — `check_tdd_in_bugfix.py` |
| Vague Acceptance Criteria → score ≤ 70 (heuristic) | `check_criterion_executability.py` — triggers when `vague_ratio > 0.10` OR `acceptable_ratio < 0.80` across DoD/Acceptance Criteria bullets. Each criterion scored on 3 axes (observable verb, measurable object, oracle). HONESTLY HEURISTIC: linguistic patterns can false-positive; the JSON sub_report lists every vague criterion for human override via `/plan-improve`. Closes the plan-vagueness propagation gap (companion gate in `skills/implement/scripts/check_tdd_shape.py`). |
| Baseline Context section missing OR placeholder-laden → score ≤ 89 (sunset 2026-09-07; then ≤ 70) | M4 v1.0 — `check_baseline_context.py`. The section is the "deep review of current state" — file table + LoC + git sha + callers + glossary + architecture boundaries. Junior implementer should not need to spelunk the repo. Stable id: `soft_floor_baseline_context_incomplete`. See § SOTA upgrade below. |
| Drawbacks & Risks section missing OR < 2 entries → score ≤ 89 (sunset 2026-09-07; then ≤ 70) | M4 v1.0 — `check_drawbacks_section.py`. RFC tradition — no non-trivial plan is risk-free. Stable id: `soft_floor_drawbacks_section_insufficient`. |
| Unresolved Questions section missing AND no explicit "(none)" marker → score ≤ 89 (sunset 2026-09-07; then ≤ 70) | M4 v1.0 — `check_drawbacks_section.py` (covers both Drawbacks & Unresolved). Stable id: `soft_floor_unresolved_questions_section_missing`. |
| `--skip-checks` flag does not exist and SHALL NOT be added | Constructor invariant in `run_structural.py` |
| Score capped MUST appear marked in the report | Rendering rule |
| `hard_caps_triggered` list MUST be non-empty when verdict==INVALID | JSON schema invariant |
| Renormalization (D8) does NOT bypass hard caps | `final_score_after_caps = min(weighted_avg, smallest_active_cap)` |

## SOTA upgrade (2026-06-07)

The template at `skills/to-plan/templates/plan-template.md` was upgraded with four new mandatory sections + one new mandatory subsection per task, drawing from three SOTA reference points:

1. **RFC tradition** (Rust RFCs, Python PEPs, IETF RFCs) — Motivation, Detailed Design, **Drawbacks**, Rationale & Alternatives, **Prior Art**, **Unresolved Questions**.
2. **C4 / ARC42 baseline view** — what exists today before any change is the foundation for evaluating what comes next.
3. **ReAct planning** (Yao et al. 2022 — action + reasoning per step) — each task now has a `#### Why this step` subsection forcing both the action and the reasoning chain to be explicit.

### Why the soft cap (not hard cap) at sunset 2026-09-07

There are ~115 active plans + ~55 completed plans across consumer projects when this upgrade ships. Hard-capping at 70 immediately would invalidate every plan currently in flight. The migration path:

1. **Now → 2026-09-07**: soft cap at 89. Legacy plans become at most SHIPPABLE_WITH_CAVEATS until migrated. `hard_caps_triggered` JSON lists `soft_floor_baseline_context_incomplete` etc., so authors see the WARN and migrate gradually.
2. **2026-09-07 →**: review the migration ratio. Promote each soft cap to a hard cap at 70 (or earlier, if the migration is complete). The promotion requires a new ADR per § "When this rule may change".

Authors migrating a legacy plan need only re-run `/to-plan` against the updated template OR hand-edit the plan to add the four new sections (and the per-task `#### Why this step` subsection). `/plan-confidence` re-scores them automatically.

## When this rule may change

Only via explicit ADR signed by the project owner. Any PR that softens enforcement MUST:

1. Cite the ADR that justifies the change.
2. Document what changes in the `## Rules that cannot be bent` section of this file.
3. Bump `plan-confidence-thresholds.txt` reference to the new ADR.
4. Add log entry with date and reason.

PRs that **add** new hard caps (e.g., M3 activates "fabricated citation") follow the same process, but with lower burden (extending, not softening).

## Related

- Skill: `.claude/skills/plan-confidence/SKILL.md`
- Thresholds: `.claude/rules/plan-confidence-thresholds.txt`
- Allowlist: `.claude/rules/plan-confidence-allowlist.txt`
- Defaults (fallback): `.claude/skills/plan-confidence/defaults/`
