# Plan-Confidence Golden Rule (INQUEBRÁVEL) 

> Promoted from skill template; per-project Source of Truth.

**Source of truth for the `/plan-confidence` skill's most important contract.**

## The Rule

**A plan is INVALID and CANNOT produce a SHIPPABLE verdict when:**

1. Coverage Matrix < 100% (gaps not mapped to tasks)
2. At least one fabricated citation (rule file, blueprint section, intra-plan ADR, or Unbreakable Rule referenced in prose does not resolve) — *M3 v0.1 active (rule files, blueprints, intra-plan ADRs, Unbreakable Rules 1..13). M3 v0.2 (code-file refs `src/foo.py:42`) deferred.*
3. An applicable `*-patterns` skill is silently ignored — one whose frontmatter `description:` shares a keyword with the plan's title/Goal, yet is neither cited in the plan body nor overridden by an ADR that names it.

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
| Applicable `*-patterns` skill ignored → score ≤ 49 (INVALID) | `check_patterns_consumption.py` (+ `patterns_match.py`) — a `*-patterns` skill whose `description:` shares a keyword with the plan title/Goal MUST be cited in the plan body OR overridden in `## ADRs`. Silently skipping applicable domain knowledge is as corrosive as a fabricated citation. Escape hatch: a one-line override ADR naming the skill. HEURISTIC matcher (keyword on the `description:` line only). Stable id: `patterns_skill_ignored`. Detection precedents reused: `auto-plan/assess_confidence.py`, `review/detect_domain.py`. Soft advisory companion at implement-time: `implement/run_validation.py` `patterns_consumption` (never FAIL). |
| ADR without alternatives in Rationale → score ≤ 70 | M2 — `check_adr_completeness.py` |
| Bug-fix task without TDD RED-GREEN-REFACTOR → score ≤ 70 | M2 — `check_tdd_in_bugfix.py` |
| Vague Acceptance Criteria → score ≤ 70 (heuristic) | `check_criterion_executability.py` — triggers when `vague_ratio > 0.10` OR `acceptable_ratio < 0.80` across DoD/Acceptance Criteria bullets. Each criterion scored on 3 axes (observable verb, measurable object, oracle). HONESTLY HEURISTIC: linguistic patterns can false-positive; the JSON sub_report lists every vague criterion for human override via `/plan-improve`. Closes the plan-vagueness propagation gap (companion gate in `skills/implement/scripts/check_tdd_shape.py`). |
| Baseline Context section missing OR placeholder-laden → score ≤ 89 (sunset 2026-09-07; then ≤ 70) | M4 v1.0 — `check_baseline_context.py`. The section is the "deep review of current state" — file table + LoC + git sha + callers + glossary + architecture boundaries. Junior implementer should not need to spelunk the repo. Stable id: `soft_floor_baseline_context_incomplete`. See § SOTA upgrade below. |
| Drawbacks & Risks section missing OR < 2 entries → score ≤ 89 (sunset 2026-09-07; then ≤ 70) | M4 v1.0 — `check_drawbacks_section.py`. RFC tradition — no non-trivial plan is risk-free. Stable id: `soft_floor_drawbacks_section_insufficient`. |
| Unresolved Questions section missing AND no explicit "(none)" marker → score ≤ 89 (sunset 2026-09-07; then ≤ 70) | M4 v1.0 — `check_drawbacks_section.py` (covers both Drawbacks & Unresolved). Stable id: `soft_floor_unresolved_questions_section_missing`. |
| Concurrency signals present AND task missing `#### Concurrency tests` with acceptable race-aware signal OR explicit `(none — single-threaded)` → score ≤ 89 (sunset 2026-09-07; then ≤ 70) | M4 v1.1 — `check_concurrency_tests.py`. CONDITIONAL — only triggers when the plan contains concurrency signals (mutex/lock/atomic/goroutine/async/channel/threading/concurrent). Single-thread TDD does NOT prove race-freedom. Stable id: `soft_floor_concurrency_tests_missing`. |
| External-I/O signals present AND `## Failure scenarios` section missing OR empty → score ≤ 89 (sunset 2026-09-07; then ≤ 70) | M4 v1.1 — `check_failure_scenarios.py`. CONDITIONAL — only triggers when the plan contains external-I/O signals (HTTP client / DB driver / queue / gRPC / object store). Happy-path tests do NOT prove resilience under timeout / 5xx / connection reset. Explicit `(none — no external I/O touched)` escape is honored. Stable id: `soft_floor_failure_scenarios_missing`. |
| `--skip-checks` flag does not exist and SHALL NOT be added | Constructor invariant in `run_structural.py` |
| Score capped MUST appear marked in the report | Rendering rule |
| `hard_caps_triggered` list MUST be non-empty when verdict==INVALID | JSON schema invariant |
| Renormalization (D8) does NOT bypass hard caps | `final_score_after_caps = min(weighted_avg, smallest_active_cap)` |

## Template provenance (M4 / M4.1 caps)

The four mandatory plan sections (Baseline Context, Drawbacks & Risks, Unresolved
Questions, Prior Art) and the per-task `#### Why this step` subsection — all capped in
the rubric above — come from a SOTA template upgrade (RFC tradition + C4/ARC42 baseline
view + ReAct planning). They ship as **soft** caps with sunset **2026-09-07** (then
promotable to a hard cap at 70 via ADR) so plans in flight migrate gradually rather than
being invalidated overnight; authors migrate by re-running `/to-plan` against the updated
template. Full migration rationale lives in the CHANGELOG + the upgrade ADR.

The concurrency-tests and failure-scenarios caps are **conditional** — they fire only
when the plan prose contains the matching signals (concurrency: mutex / lock / atomic /
goroutine / async / channel / …; external-I/O: HTTP client / DB driver / queue / RPC /
object store). Single-thread TDD never catches a race; happy-path tests never catch a
timeout / 5xx. The authoritative signal lists live in `check_concurrency_tests.py` /
`check_failure_scenarios.py`; plans without those signals are unaffected (a UI markup
change needs no race test).

## When this rule may change

Per `cycle-rule-schema.md § Golden Rule Change Protocol` (ADR signed by the project
owner). Rule-specific deviations:

- Document the change in the `## Rules that cannot be bent` section of this file.
- Bump the `plan-confidence-thresholds.txt` reference to the new ADR.

## Related

- Skill: `.claude/skills/plan-confidence/SKILL.md`
- Thresholds: `.claude/rules/plan-confidence-thresholds.txt`
- Allowlist: `.claude/rules/plan-confidence-allowlist.txt`
- Defaults (fallback): `.claude/skills/plan-confidence/defaults/`
