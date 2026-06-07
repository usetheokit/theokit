# Discover-Plan Golden Rule

Locked unbreakable contract that `/discover-plan-confidence` reads to score discovery plans (the *plan* of investigation, distinct from the resulting *blueprint*). Mirrors the discover-blueprint-golden-rule pattern.

Without this file, `/discover-plan-confidence` falls back to the example template in `skills/discover-plan-confidence/templates/` (when present), or uses defaults.

## § 1 — The unbreakable rule (LOCKED)

A discovery plan is `INVALID` and cannot produce a `SHIPPABLE` verdict when any of the following holds:

1. **Empty research question** — `## Research questions` is missing or has zero non-placeholder entries.
2. **Fabricated source citation** — at least one `knowledge-base/references/{project}` cited in the plan does not exist when checked via `Path.exists()`.
3. **Question budget violated** — declared question count > 15 (per `cycle-discover.md`).
4. **Coverage corner declared but empty** — any `## Coverage Corner N` heading present with zero questions targeting it.

## § 2 — What the rule requires

| Requirement | Enforcement |
|---|---|
| Score capping — capped at 49 when any hard cap fires | `skills/discover-plan-confidence/scripts/run_discover_plan_score.py` |
| Mandatory verdict — `INVALID` instead of soft band | `run_discover_plan_score.py` |
| Vocabulary lock — "shippable" never appears when capped | Rendering invariant |
| Hard cap audit — JSON `hard_caps_triggered` non-empty | Schema invariant |

## § 3 — Rules that cannot be bent (LOCKED)

| Rule | Enforcement script |
|---|---|
| All declared coverage corners have ≥ 1 question | `check_coverage_corners.py` |
| All `knowledge-base/references/{...}` paths resolve | `check_reference_citations.py` |
| Question count ≤ 15 | `check_question_budget.py` |
| `--skip-checks` flag does not exist and SHALL NOT be added | Constructor invariant |
| `hard_caps_triggered` MUST be non-empty when verdict==INVALID | JSON schema invariant |

## § 4 — Why the rule exists

A discovery plan that does not declare research questions is investigation theatre. A plan that cites references that do not exist will produce a blueprint built on fiction. A plan with > 15 questions has not been scoped — it is a research project, not a discovery cycle.

## § 5 — Verdict tokens (LOCKED)

Aligned with `cycle-rule-schema.md`:

| Verdict | Score cap | Meaning |
|---|---|---|
| `SHIPPABLE` | 100 | Plan passes all gates; proceed to `/discover-execute` |
| `SHIPPABLE_WITH_CAVEATS` | 89 | Passes hard caps; soft caps flagged |
| `NEEDS_REVISION` | 70 | Soft caps fire; structurally OK |
| `INVALID` | 49 (capped) | Hard cap triggered (rewrite via `/discover-plan`) |

## § 6 — When this rule may change

Only via explicit ADR. Requires CHANGELOG entry and passing `check_xrefs.py` + `test_e2e_smoke.py`.

## Cross-references

- Schema: `cycle-rule-schema.md`
- Cycle: `cycle-discover.md`
- Skill: `skills/discover-plan-confidence/SKILL.md`
- Thresholds: `discover-plan-thresholds.txt`
