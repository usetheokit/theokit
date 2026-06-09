---
name: discover-confidence
description: Score a blueprint produced by /discover-execute for structural quality (M2 deterministic check). Mirrors /plan-confidence but with a blueprint-shape rubric (research coverage, reference citations, completeness, smells).
user-invocable: true
allowed-tools: Read Glob Grep Bash Write
argument-hint: "{blueprint-slug}"
---

# Discover-Confidence — M2 Structural Scoring for Blueprints

Scores a blueprint produced by `/discover-execute` against the M2 structural rubric for **technical blueprints**. Deterministic. Zero LLM calls. Latency < 5s. Cost $0.

Sibling of `/plan-confidence` — same architecture (Python deterministic + soft caps + hard caps), different rubric. Plan-confidence scores **implementation plans**; discover-confidence scores **research blueprints**.

**ADR reference:** see `templates/rubric-blueprint.md` for the YAML definition of the rubric.
**Hard caps:** see `.claude/rules/discover-blueprint-golden-rule.md`
**Thresholds (versioned):** `.claude/rules/discover-blueprint-thresholds.txt`

## When to Trigger

- After running `/discover-execute {slug}` and the halt-loop emitted `BLUEPRINT_COMPLETE` (or exhausted).
- After incorporating fixes from `/discover-improve`, BEFORE merging the blueprint into `docs/`.
- User explicitly invokes `/discover-confidence {blueprint-slug}`.

This skill is **phase 4** of [`cycle-discover`](../../rules/cycle-discover.md). The cycle rule is the source of truth for chain order (this skill scores blueprints from `/discover-execute`; if verdict ≥ SHIPPABLE_WITH_CAVEATS, the skill-distillation tail `/skill-writer → /skill-validator → /skill-register` runs next), hard gates, soft gates, stop conditions, anti-patterns, and rollback. Read it before invoking this skill. This SKILL.md retains phase-specific detail (the scoring rubric, hard caps, output schema, exit codes).

## What this skill checks (M2 active dimensions)

Five deterministic checkers, four dimensions:

| Dimension | Checker script | Hard cap | Default weight |
|---|---|---|---|
| **research_coverage** | `check_research_coverage.py` | ≤49 if any of the 4 corners (tests/deps/tools/techniques) is empty | 0.30 |
| **reference_citations** | `check_reference_citations.py` | ≤49 if ANY cited path in `.claude/knowledge-base/references/` is fabricated (file does not exist) | 0.30 |
| **blueprint_completeness** | `check_blueprint_completeness.py` | ≤70 if any mandatory section is missing or empty | 0.25 |
| **structural_risk** (smells) | `check_spec_smells.py` (adapted from plan-confidence) | penalty only (no hard cap) | 0.15 |

The four weights sum to 1.0. Composite formula: `final = 0.30·research_coverage + 0.30·reference_citations + 0.25·blueprint_completeness + 0.15·structural_risk`.

When a hard cap fires, `final_score_after_caps = min(weighted_avg, smallest_active_cap)`.

## What this skill does NOT do (yet)

**Out of scope for M2** (mirrors plan-confidence's deferred dimensions):

- **M3 (semantic citation faithfulness)** — verifies the cited path actually contains the claimed symbol/behavior. Adapted from SAFE.
- **M4 (PoLL Jury cross-family)** — Sonnet + GPT-4o-mini + Gemini Flash as judges of blueprint quality.
- **M5 (Calibration via Semantic Entropy)** — N-sample uncertainty.

In M2, future dimensions return empty `reasons`. The four active dimensions already sum to 1.0 (`0.30 + 0.30 + 0.25 + 0.15`), so no renormalization is currently applied. The renormalization machinery (same approach as `plan-confidence` ADR D8) only kicks in once M3+ dimensions are added without rebalancing the existing weights.

## Hard Caps (mirror discover-blueprint-golden-rule.md)

A blueprint is INVALID and CANNOT score above 49 when any of these fire:

- **Empty coverage corner** — at least one of `## Integration tests`, `## Dependencies`, `## Tools`, `## Techniques` sections is missing or has zero content lines (only header / TBD placeholder).
- **Fabricated citation** — at least one `.claude/knowledge-base/references/{project}/{path}` referenced in the blueprint does not exist when checked via `Path.exists()`.

A blueprint caps at 70 (SHIPPABLE_WITH_CAVEATS at most) when:

- **Mandatory section missing** — Header, Context, Per-project sections (one per in-scope project), Cross-cutting comparison, Recommendations.
- **No ADRs** — blueprint must include an ADR section explaining decisions taken during synthesis.

These caps are INQUEBRÁVEIS. See `.claude/rules/discover-blueprint-golden-rule.md` for full enforcement.

## Conservative Bias (fail-closed)

The system **biases toward false positives** (over-flag) rather than false negatives. When signals indicate risk, the system caps the verdict at SHIPPABLE_WITH_CAVEATS (89) instead of allowing SHIPPABLE (90+):

- **High smell density** (≥20 weak-imperative / loophole / vague hits in prose) → soft cap 89.
- **Citation density low** (<1 citation per 200 words of prose) → soft cap 89 (blueprint is too thin on evidence).
- **Per-project asymmetry** — one project gets 80% of content while others get crumbs, when all 3 were in scope → soft cap 89. **Status: documented in rubric and defaults but NOT yet enforced in M2 (no Python checker exists). Deferred to M2.1 — until then this cap never fires.**

Soft caps are listed in `hard_caps_triggered` with prefix `soft_floor_` for auditability. They do NOT trigger `verdict == INVALID`.

## Verdict Bands

| Score | Verdict | Action |
|---|---|---|
| 90-100 | SHIPPABLE | Blueprint ready — proceed to use it as design source |
| 70-89 | SHIPPABLE_WITH_CAVEATS | List caveats, manual review of flagged items |
| 50-69 | NON_SHIPPABLE | Re-run `/discover-execute` with revised plan |
| 0-49 | INVALID | Structural defect — re-plan and re-execute |

## Workflow

1. **Resolve blueprint path.** If argument is a slug, resolve to `.claude/knowledge-base/discoveries/blueprints/{slug}-blueprint.md`. If path with `.md` suffix, use directly.
2. **Invoke the structural runner.** Call `python3 scripts/run_blueprint_score.py <blueprint-path>` from the skill directory. Pass rubric path and thresholds path as arguments.
3. **Parse the JSON output.** The runner emits a JSON object matching `templates/score-report.schema.json`.
4. **Render the report.** Highlight the top 3 contributors and detractors per dimension, with the verdict band clearly marked. If `verdict == INVALID`, display in red. If `verdict == SHIPPABLE`, display in green.

## Output Format

JSON with these top-level keys:

- `blueprint_slug`, `blueprint_path`, `blueprint_version`
- `research_coverage_score`, `reference_citations_score`, `blueprint_completeness_score`, `risco_estrutural_score` (0-100 each)
- `active_dimensions` — `["research_coverage", "reference_citations", "blueprint_completeness", "structural_risk"]`
- `weight_normalization_factor` — 1.0 in M2 (all four active)
- `hard_caps_triggered` — list of triggered caps (`["empty_corner_tests"]`, `["fabricated_citation"]`, etc.)
- `final_score_after_caps` — composite after applying caps
- `verdict` — SHIPPABLE / SHIPPABLE_WITH_CAVEATS / NON_SHIPPABLE / INVALID
- `reasons` — dict of dimension → list of top-3 contributors and detractors (with citations)
- `sub_reports` — raw output from each checker for auditability

## Exit Codes

- `0` — SHIPPABLE or SHIPPABLE_WITH_CAVEATS (green path)
- `1` — INVALID (hard cap triggered)
- `2` — Error (blueprint not found, malformed rubric)
- `3` — NON_SHIPPABLE (score < 50 without hard cap)

## Related

- Upstream skill: `/discover-execute` (produces the blueprint this skill scores)
- Downstream skill: `/discover-improve` (refines low-scoring blueprints via halt-loop)
- Golden rule: `.claude/rules/discover-blueprint-golden-rule.md`
- Thresholds: `.claude/rules/discover-blueprint-thresholds.txt`
- Rubric: `templates/rubric-blueprint.md`
- Schema: `templates/score-report.schema.json`
- Defaults (fallback): `defaults/research-coverage.md`
- Sibling skill: `/plan-confidence` (same architecture, scores implementation plans instead)
