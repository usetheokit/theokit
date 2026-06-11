---
name: discover-plan-confidence
description: Score a discovery plan produced by /discover-plan for structural quality (M2 deterministic check). Sibling of /discover-confidence with a discovery-plan-shape rubric (research coverage, reference citations, plan completeness, smells). Use after /discover-edge-cases, before /discover-execute.
user-invocable: true
allowed-tools: Read Glob Grep Bash Write
argument-hint: "{discovery-plan-slug}"
---

# Discover-Plan-Confidence — M2 Structural Scoring for Discovery Plans

Scores a discovery plan produced by `/discover-plan` against the M2 structural rubric for **discovery plans** (NOT blueprints). Deterministic. Zero LLM calls. Latency < 5s. Cost $0.

Sibling of `/discover-confidence` — same architecture (Python deterministic + soft caps + hard caps), different rubric. `/discover-confidence` scores **research blueprints** (output of `/discover-execute`); this skill scores **research plans** (output of `/discover-plan`).

**Hard caps:** see [`.claude/rules/discover-plan-golden-rule.md`](../../rules/discover-plan-golden-rule.md)
**Thresholds (versioned):** [`.claude/rules/discover-plan-thresholds.txt`](../../rules/discover-plan-thresholds.txt)

## When to Trigger

- After running `/discover-edge-cases {slug}` and the plan was bumped to v1.x with MUST FIX absorbed.
- BEFORE running `/discover-execute {slug}` — a malformed plan poisons the entire downstream chain.
- User explicitly invokes `/discover-plan-confidence {slug}`.

This skill is the **plan-gate** of [`cycle-discover`](../../rules/cycle-discover.md). The cycle rule is the source of truth for chain order, hard gates, soft gates, stop conditions, anti-patterns, and rollback. Read it before invoking this skill. This SKILL.md retains phase-specific detail (rubric, hard caps, output schema, exit codes).

## What this skill checks (M2 active dimensions)

Four deterministic checkers, four dimensions:

| Dimension | Checker script | Hard cap | Default weight |
|---|---|---|---|
| **research_coverage** | `scripts/check_research_coverage.py` | ≤49 if any coverage corner is empty AND no `<!-- DEFER-CORNER: {corner} \| {reason} -->` marker present | 0.30 |
| **reference_citations** | `scripts/check_reference_citations.py` | ≤49 if ANY cited path in `.claude/knowledge-base/references/` is fabricated (file does not exist) | 0.30 |
| **plan_completeness** | `scripts/check_plan_completeness.py` | ≤70 if any of: mandatory section missing, ADR count < 2, question budget violated, method missing | 0.25 |
| **structural_risk** (smells) | `scripts/check_spec_smells.py` | penalty only (no hard cap) | 0.15 |

The four weights sum to 1.0. Composite formula: `final = 0.30·research_coverage + 0.30·reference_citations + 0.25·plan_completeness + 0.15·structural_risk`.

When a hard cap fires, `final_score_after_caps = min(weighted_avg, smallest_active_cap)`.

## What this skill does NOT do (yet)

**Out of scope for M2** (mirrors `/discover-confidence`'s deferred dimensions):

- **M3 (semantic citation faithfulness)** — verifies the cited path contains the claimed symbol/behavior. Future: SAFE adapted to `ripgrep + tree-sitter`.
- **5th coverage corner `prior_art`** — `cycle-discover.md` v1.1 added a 5th corner. The current `check_research_coverage.py` still recognizes the 4-corner v1.0 shape; v1.1 extension is tracked under `cycle-discover.md § Downstream changes required #8`. Until shipped, plans authored against the v1.1 template can still pass this scorer — the extra corner is recognized as an unmapped header but is NOT hard-capped. Human reviewers are expected to catch missing `prior_art` content until the script is extended.

## Workflow

1. **Resolve the plan path** — `.claude/knowledge-base/discoveries/plans/{slug}-plan.md`. Refuse if absent.
2. **Run the 4 checker scripts** in parallel via Bash subprocess. Each emits a JSON document on stdout.
3. **Combine outputs** — apply hard caps per the rubric above. Compute weighted average.
4. **Apply soft caps** — see `discover-plan-golden-rule.md § Soft gates`.
5. **Emit a JSON score report** at `.claude/knowledge-base/reviews/{slug}-discover-plan-confidence-{date}.json` AND a human-readable rendering at `.claude/knowledge-base/reviews/{slug}-discover-plan-confidence-{date}.md`.
6. **Print verdict** to stdout: one of `SHIPPABLE` (≥90), `SHIPPABLE_WITH_CAVEATS` (70-89), `NON_SHIPPABLE` (50-69), `INVALID` (≤49).

## Output schema

```json
{
  "slug": "{plan-slug}",
  "verdict": "SHIPPABLE | SHIPPABLE_WITH_CAVEATS | NON_SHIPPABLE | INVALID",
  "final_score": 0-100,
  "weighted_avg": 0-100,
  "hard_caps_triggered": ["empty_corner_tests", "fabricated_citation", ...],
  "dimensions": {
    "research_coverage": {"score": 0-100, "reasons": [...]},
    "reference_citations": {"score": 0-100, "reasons": [...]},
    "plan_completeness": {"score": 0-100, "reasons": [...]},
    "structural_risk":  {"score": 0-100, "reasons": [...]}
  }
}
```

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Plan scored; verdict in stdout JSON |
| 1 | Plan file not found OR malformed (cannot read) |
| 2 | Checker script crashed (bug in the skill) |

## Anti-patterns

1. **NEVER add a `--skip-checks` / `--force` flag.** Per `discover-plan-golden-rule.md § What it requires`, no bypass mechanism exists.
2. **NEVER silently lower hard caps.** Any change to the rubric requires an ADR signed by the project owner.
3. **NEVER edit the plan during scoring.** This skill is read-only on the plan; mutations belong to `/discover-improve` (when it exists).
4. **NEVER recommend skipping `/discover-execute` after this verdict ≥ SHIPPABLE_WITH_CAVEATS.** The verdict only proves the plan is STRUCTURALLY sound; the execute phase produces the actual blueprint.

## Related

- Sibling: [`/discover-confidence`](../discover-confidence/SKILL.md) — same shape for blueprints.
- Sibling: [`/plan-confidence`](../plan-confidence/SKILL.md) — same shape for implementation plans.
- Upstream: [`/discover-plan`](../discover-plan/SKILL.md), [`/discover-edge-cases`](../discover-edge-cases/SKILL.md).
- Downstream: [`/discover-execute`](../discover-execute/SKILL.md) (runs when verdict ≥ SHIPPABLE_WITH_CAVEATS).
- Golden rule: [`.claude/rules/discover-plan-golden-rule.md`](../../rules/discover-plan-golden-rule.md).
- Thresholds: [`.claude/rules/discover-plan-thresholds.txt`](../../rules/discover-plan-thresholds.txt).
- Cycle SoT: [`.claude/rules/cycle-discover.md`](../../rules/cycle-discover.md).
