# Discover-Blueprint Golden Rule

Locked unbreakable contract that `/discover-confidence` reads to score blueprints, decide verdicts, and gate the optional skill-promotion downstream. This file is the per-project Source of Truth promoted from `skills/discover-confidence/templates/discover-blueprint-golden-rule.example.md`.

Without this file, `/discover-confidence` falls back to the example template in the skill's `templates/` directory — usable, but not project-locked. Adopt this file as the project's contract.

## § 1 — The unbreakable rule (LOCKED)

A blueprint is `INVALID` and **cannot** produce a `SHIPPABLE` or `SHIPPABLE_WITH_CAVEATS` verdict when any of the following holds:

1. **Empty coverage corner** — at least one of `## Coverage Corner 1 — Integration Tests`, `## Coverage Corner 2 — Dependencies`, `## Coverage Corner 3 — Tools`, `## Coverage Corner 4 — Techniques` is missing or has zero non-placeholder content.
2. **Fabricated citation** — at least one `knowledge-base/references/{project}/{path}` (or `.claude/knowledge-base/references/...` plugin-style) referenced in the blueprint does not exist when checked via `Path.exists()`.

This is NOT a guideline. It is a constraint enforced by the skill. The skill SHALL fail-closed when an unbreakable rule is violated.

## § 2 — What the rule requires

| Requirement | Enforcement |
|---|---|
| **Score capping** — final score capped at 49 when any unbreakable rule is violated, regardless of weighted_avg | M2 `run_blueprint_score.py` |
| **Mandatory verdict** — returned verdict is `INVALID`, not any soft band | M2 `run_blueprint_score.py` |
| **Vocabulary lock** — the word "shippable" SHALL NOT appear in the report (unqualified) when the score is capped | Rendering invariant |
| **Hard cap audit** — JSON output MUST list every triggered cap in `hard_caps_triggered` with stable identifiers (`empty_corner_tests`, `empty_corner_deps`, `empty_corner_tools`, `empty_corner_techniques`, `fabricated_citation`) | JSON schema invariant |
| **Visual rendering** — INVALID band appears in red when score is capped | Renderer |

## § 3 — Rules that cannot be bent (LOCKED)

| Rule | Enforcement script |
|---|---|
| All 4 coverage corners populated | `skills/discover-confidence/scripts/check_research_coverage.py` |
| All `knowledge-base/references/{...}` citations exist | `skills/discover-confidence/scripts/check_reference_citations.py` |
| Mandatory blueprint sections present | `skills/discover-confidence/scripts/check_blueprint_completeness.py` (cap 70) |
| ADRs section present with at least one ADR | `skills/discover-confidence/scripts/check_blueprint_completeness.py` (cap 70) |
| `--skip-checks` flag does not exist and SHALL NOT be added | Constructor invariant in `run_blueprint_score.py` |
| Score-capped reports MUST mark the cap explicitly | Rendering invariant |
| `hard_caps_triggered` list MUST be non-empty when verdict==INVALID | JSON schema invariant |

## § 4 — Why the rule exists

A blueprint missing a coverage corner is a blueprint that did NOT do the deep research it claimed. A blueprint with fabricated citations is unsafe to use as a design source — recipients trust cited paths and build on top of references that do not exist.

The lesson — which mirrors `plan-confidence`'s: **tests passing ≠ system works; coverage table green ≠ research complete.** A blueprint with one empty corner or one fabricated citation will produce wrong decisions downstream, even if 90% of other checks are green.

This rule forces minimum structural state PRESENT before the aggregate matters.

## § 5 — Verdict tokens (LOCKED)

`/discover-confidence` MUST emit one of these verdicts (matching `cycle-rule-schema.md`):

| Verdict | Score cap | Meaning | Downstream action |
|---|---|---|---|
| `SHIPPABLE` | 100 | Blueprint passes all gates with high confidence | Optional skill-promotion via `/skill-writer` |
| `SHIPPABLE_WITH_CAVEATS` | 89 | Passes hard caps; some soft caps flagged | Promotion allowed; caveats logged |
| `NEEDS_REVISION` | 70 | Soft caps fire; structurally OK | Loop to `/discover-improve` |
| `INVALID` | 49 (capped) | Hard cap triggered (this rule fired) | Loop back to `/discover-plan` — rewrite, not improve |

## § 6 — When this rule may change

Only via explicit ADR signed by the project owner. Any change that softens enforcement MUST:

1. Cite the ADR in `knowledge-base/adrs/`.
2. Document the change in `## § 3 — Rules that cannot be bent`.
3. Bump `rules/discover-blueprint-thresholds.txt` reference to the new ADR (when that file exists).
4. Add CHANGELOG entry under `[Unreleased] § Changed`.

## § 7 — Failure modes the rule guards against

- Deep-research theatre — claiming investigation that wasn't done.
- Fabricated citations slipping through manual review.
- Downstream skill promotion of an INVALID blueprint.
- `--skip-checks` flags being added to gate-bypass production-ready claims.
- Soft caps masking hard structural failure.

## Cross-references

- Schema: `cycle-rule-schema.md`
- Cycle rule: `cycle-discover.md`
- Skill: `skills/discover-confidence/SKILL.md`
- Skill template (the seed for this file): `skills/discover-confidence/templates/discover-blueprint-golden-rule.example.md`
- Thresholds template: `skills/discover-confidence/templates/discover-blueprint-thresholds.example.txt`
- Rubric: `skills/discover-confidence/templates/rubric-blueprint.md`
- Defaults (fallback): `skills/discover-confidence/defaults/`
