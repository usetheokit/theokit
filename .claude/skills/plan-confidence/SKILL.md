---
name: plan-confidence
version: 0.1.0
requires: [edge-case-plan]
description: Score a plan produced by /to-plan for structural quality (M2 deterministic check). Sibling of /discover-confidence with a plan-shape rubric. Use after /edge-case-plan, before /implement.
user-invocable: true
allowed-tools: Read Glob Grep Bash Write
argument-hint: "{plan-slug}"
---

# Plan-Confidence — M2 Structural Scoring

Scores a plan produced by `/to-plan` against the M2 structural rubric. Deterministic. Zero LLM calls. Latency < 5s. Cost $0.

**Rubric:** `templates/rubric-v1.md` (this skill's templates dir)
**Hard caps:** see `.claude/rules/plan-confidence-golden-rule.md`
**Thresholds (versioned):** `.claude/rules/plan-confidence-thresholds.txt`

## When to Trigger

- After running `/edge-case-plan {slug}` and incorporating MUST FIX items, BEFORE implementation.
- User explicitly invokes `/plan-confidence {plan-slug}`.

This skill is **phase 3** of [`cycle-plan`](../../rules/cycle-plan.md). The cycle rule is the source of truth for chain order, hard gates, soft gates, stop conditions, anti-patterns, and rollback. Read it before invoking this skill. This SKILL.md retains phase-specific detail (the scoring rubric, hard caps, output schema, exit codes).

## Architecture compliance check (always runs)

`/plan-confidence` ALWAYS reads `.claude/rules/` (or falls back to `.claude/skills/plan-confidence/defaults/`) and verifies the plan REFERENCES the rules. The sub-report `architecture_compliance` exposes:

- `project_rules_found_count` — how many `.md` rules were detected
- `fallback_to_defaults` — true if no project rules existed (and defaults were used)
- `rules_referenced_in_plan` — which rule filenames the plan cited
- `principles_cited` — which principles (SOLID/DRY/KISS/YAGNI/...) the plan mentions
- `has_dod_quality_signal` — Global DoD mentions lint/complexity/size
- `has_size_budget_signal` — plan mentions file-size budget
- `compliance_score` — 0.0 to 1.0

If `compliance_score < 0.4` AND the plan otherwise scores ≥ 90, a soft cap fires (`soft_floor_low_architecture_compliance`, score capped at 89). Plans that don't show awareness of project rules cannot be SHIPPABLE.

## What This Skill Does NOT Do (Yet)

**Out of scope for M2:**

- **M3 (Evidence verification via SAFE adapted to `ripgrep + tree-sitter`)** — detects citation fabrication.
- **M4 (PoLL Jury cross-family)** — Sonnet + GPT-4o-mini + Gemini Flash as judges.
- **M5 (Calibration via Semantic Entropy + P(True))** — N-sample uncertainty.
- **M6 (Evolutionary Loop)** — adaptive thresholds with human-gate.

These dimensions return empty `reasons` in M2 output. The composite formula renormalizes to active dimensions (ADR D8): in M2, `final = 0.60·Completude + 0.40·Risco-estrutural`.

## Workflow

1. **Resolve plan path.** If argument is a slug like `plan-confidence-setup`, resolve to `.claude/knowledge-base/plans/{slug}-plan.md`. If argument is a path (`.md` suffix), use directly.
2. **Invoke the structural runner.** Call `python3 scripts/run_structural.py <plan-path>` from the skill directory. Pass rubric path and thresholds path as arguments.
3. **Parse the JSON output.** The runner emits a JSON object matching `templates/score-report-template.md`.
4. **Render the report.** Render the JSON to the user, highlighting the top 3 contributors and detractors per dimension, with the verdict band clearly marked. If `verdict == INVALID`, display in red. If `verdict == SHIPPABLE`, display in green.

## Hard Caps (mirror plan-confidence-golden-rule.md)

A plan is INVALID and CANNOT score above 49 when any of these fire:

- **Coverage Matrix < 100%** (gaps not mapped to tasks) — capped at 49 (M2 enforced). Stable identifier: `coverage_lt_100`.
- **Fabricated citation** (file/symbol in `Evidence:` doesn't exist in repo) — capped at 49 (M3 future). Stable identifier: `fabricated_citation`.

A plan caps at 70 (SHIPPABLE_WITH_CAVEATS at most) when:

- **ADR without alternatives** listed in Rationale. Stable identifier: `adr_without_alternatives`.
- **Bug-fix task without explicit TDD** (RED-GREEN-REFACTOR block). Stable identifier: `tdd_in_bugfix`.

These caps are INQUEBRÁVEIS. See `.claude/rules/plan-confidence-golden-rule.md` for full enforcement contract. The stable identifiers above are what appears in the JSON output's `hard_caps_triggered` list.

## Conservative Bias (fail-closed)

The system **biases toward false positives** (over-flag) rather than false negatives
(under-flag). When signals indicate risk, the system caps the verdict at
SHIPPABLE_WITH_CAVEATS (89) instead of allowing SHIPPABLE (90+):

- **High smell density** (≥30 weak-imperative/loophole/vague hits in prose) → soft cap 89.
- **High deferred ratio** (>20% of Coverage Matrix entries marked out-of-scope) → soft cap 89.

This is a deliberate engineering choice: it is much easier to recover from a
plan that was marked WITH_CAVEATS but is actually clean (loses 1 minute of
human review time) than from a plan that was marked SHIPPABLE but had real
gaps (loses days/weeks of implementation rework). Asymmetry favors RESSALVAS.

Soft caps are listed in `hard_caps_triggered` with prefix `soft_floor_`
(e.g., `soft_floor_smell_density_high`) for auditability. They do NOT
trigger `verdict == INVALID`.

## Verdict Bands (versioned in thresholds allowlist)

| Score | Verdict | Action |
|---|---|---|
| 90-100 | SHIPPABLE | Implement with confidence |
| 70-89 | SHIPPABLE_WITH_CAVEATS | List caveats, review manually |
| 50-69 | NON_SHIPPABLE | Re-run `/to-plan` + `/edge-case-plan` |
| 0-49 | INVALID | Structural defect — re-plan |

## Output Format

The skill produces a JSON object with these top-level keys (see `templates/score-report-template.md` for full schema):

- `plan_slug`, `plan_path`, `plan_version`
- `completude_score`, `risco_estrutural_score` (0-100 each)
- `active_dimensions` — list of dimensions scored in this milestone (M2: `["completeness", "structural_risk"]`)
- `weight_normalization_factor` — ADR D8 normalization factor applied
- `hard_caps_triggered` — list of triggered caps (e.g., `["coverage_lt_100"]`)
- `final_score_after_caps` — composite after applying caps
- `verdict` — one of SHIPPABLE / SHIPPABLE_WITH_CAVEATS / NON_SHIPPABLE / INVALID
- `reasons` — dict of dimension → list of top-3 contributors and detractors (with citations)
- `sub_reports` — raw output from each checker for auditability

## Exit Codes

- `0` — SHIPPABLE or SHIPPABLE_WITH_CAVEATS (green path).
- `1` — INVALID (hard cap triggered).
- `2` — Error (plan not found, malformed rubric).
- `3` — NON_SHIPPABLE (score < 50 without hard cap; over-penalization to investigate).

## How to Read Edge Case Outputs

If a previous `/edge-case-plan {slug}` produced MUST FIX items, the current plan should have incorporated them BEFORE invoking `/plan-confidence`. The skill does NOT cross-reference edge-case reports automatically in M2 — that's an M4 feature (jury layer).

## Related

- Golden rule: `.claude/rules/plan-confidence-golden-rule.md`
- Thresholds: `.claude/rules/plan-confidence-thresholds.txt`
- Rubric: `templates/rubric-v1.md`
- Schema: `templates/score-report.schema.json`
- Defaults (fallback when project rules missing): `defaults/`
- Sibling skill: `/discover-confidence` (same architecture, scores blueprints instead of plans)
