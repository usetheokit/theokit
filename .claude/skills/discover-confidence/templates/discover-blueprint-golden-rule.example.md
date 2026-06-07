# Discover-Blueprint Golden Rule (INQUEBRÁVEL) — TEMPLATE

> Copy this file to `.claude/rules/discover-blueprint-golden-rule.md` in your project.

**Source of truth for the `/discover-confidence` skill's most important contract.**

## The Rule

**A blueprint is INVALID and CANNOT produce a SHIPPABLE verdict when:**

1. **Empty coverage corner** — at least one of `## Coverage Corner 1 — Integration Tests`, `## Coverage Corner 2 — Dependencies`, `## Coverage Corner 3 — Tools`, `## Coverage Corner 4 — Techniques` is missing or has zero non-placeholder content.
2. **Fabricated citation** — at least one `.claude/knowledge-base/references/{project}/{path}` referenced in the blueprint does not exist when checked via `Path.exists()`.

This is NOT a guideline. It is a constraint enforced by the skill itself. The skill SHALL fail-closed when an unbreakable rule is violated.

## What it requires

1. **Score capping.** Final score is capped at 49 when any unbreakable rule is violated — regardless of how high the weighted_avg would be.
2. **Mandatory verdict.** The returned verdict is `INVALID`, not `SHIPPABLE_WITH_CAVEATS` or any other band.
3. **Vocabulary lock.** The word "shippable" SHALL NOT appear in the report (unqualified) when the score is capped.
4. **Hard cap audit.** JSON output MUST list all triggered caps in `hard_caps_triggered` with stable identifiers (`"empty_corner_tests"`, `"empty_corner_deps"`, `"empty_corner_tools"`, `"empty_corner_techniques"`, `"fabricated_citation"`).
5. **Visual rendering.** When capped, the INVALID band appears in red.

## Why this rule exists

A blueprint that is missing a coverage corner is a blueprint that did NOT do the deep-research it claimed. A blueprint with fabricated citations is unsafe to use as a design source — recipients will trust the cited paths and build on top of references that don't exist.

The lesson (mirrors plan-confidence's): **tests passing ≠ system works; coverage table green ≠ research complete.** A blueprint with one empty corner or one fabricated citation will produce wrong decisions downstream, even if 90% of other checks are green.

The rule closes this gap by forcing minimum structural state PRESENT before the aggregate matters.

## Rules that cannot be bent

| Rule | Enforcement |
|---|---|
| All 4 coverage corners populated | M2 — `run_blueprint_score.py` via `check_research_coverage.py` |
| All `.claude/knowledge-base/references/{...}` citations exist | M2 — `check_reference_citations.py` (path.exists() check) |
| Mandatory blueprint sections present | M2 — `check_blueprint_completeness.py` (cap 70) |
| ADRs section present with at least one ADR | M2 — `check_blueprint_completeness.py` (cap 70) |
| `--skip-checks` flag does not exist and SHALL NOT be added | Constructor invariant in `run_blueprint_score.py` |
| Score capped MUST appear marked in the report | Rendering rule |
| `hard_caps_triggered` list MUST be non-empty when verdict==INVALID | JSON schema invariant |

## When this rule may change

Only via explicit ADR signed by the project owner. Any PR that softens enforcement MUST:

1. Cite the ADR that justifies the change.
2. Document what changes in the `## Rules that cannot be bent` section of this file.
3. Bump `discover-blueprint-thresholds.txt` reference to the new ADR.
4. Add log entry with date and reason.

## Related

- Skill: `.claude/skills/discover-confidence/SKILL.md`
- Thresholds: `.claude/rules/discover-blueprint-thresholds.txt`
- Rubric: `.claude/skills/discover-confidence/templates/rubric-blueprint.md`
- Defaults (fallback): `.claude/skills/discover-confidence/defaults/`
