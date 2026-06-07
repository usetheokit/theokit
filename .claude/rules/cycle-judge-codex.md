# Cycle: JUDGE-CODEX (orthogonal LLM jury)

Source of Truth for the orthogonal-LLM judge cycle. **Optional but recommended** addition to the canonical pipeline that breaks the Claude-only monoculture in `cycle-review`.

## Purpose

`cycle-review` already runs 5–7 Claude sub-agents in parallel (architecture, tests, wiring, cross-validation, domain). They are all **Claude** — same model family, same training, same blind spots. Concurrency hazards, side-channel risks, and certain classes of subtle defects get systematically under-weighted because every reviewer shares the same priors.

**JUDGE-CODEX** invokes GPT-Codex (via the official `@openai/codex` CLI) as an **orthogonal LLM jury** that consumes the same cycle artifact and emits an independent verdict using this ecosystem's canonical vocabulary. When Claude (`/review`) and Codex (`/judge-codex:*`) agree → confidence ↑. When they disagree → the disagreement itself is the highest-value signal in the pipeline.

This cycle is delivered by an external plugin — `judge-codex-plugin-cc` (https://github.com/usetheodev/judge-codex-plugin-cc) — not by skills inside this repo. The plugin reads `plan` artifacts by path convention and emits structured JSON aligned with this schema.

## Pre-conditions

- Codex CLI installed (`npm install -g @openai/codex`) and authenticated (`codex login`).
- judge-codex plugin installed in Claude Code (`/plugin marketplace add usetheodev/judge-codex-plugin-cc` then `/plugin install judge-codex@judge-codex`).
- At least one `plan` cycle artifact persisted (blueprint, plan, implementation log, or review report).

Do NOT invoke when:
- Codex CLI is missing — run `/judge-codex:setup` first.
- The artifact is unstable (e.g., plan still being edited) — judge a stable file.
- The slice is trivial (single-line fix) — KISS, this cycle is heavyweight.

## Chain

```
/judge-codex:discover       <slug>   (after cycle-discover produces a blueprint)
     ↓
/judge-codex:plan           <slug>   (after cycle-plan produces a plan;
     ↓                                typically also after /plan-confidence)
/judge-codex:implementation <slug>   (after cycle-implement emits
     ↓                                IMPLEMENTATION_COMPLETE)
/judge-codex:final          <slug>   (after cycle-review consolidates;
                                      review-of-review meta stage)

Shortcut for end-to-end:  /judge-codex:auto <slug>
```

Each stage is **idempotent** and **independent** — running `plan` later does not invalidate `discover`. The aggregator only honors stages that completed cleanly through the `quality-evaluator` keep/discard gate.

## Phase contracts

| Phase | Input | Output | Hard gate |
|---|---|---|---|
| `:discover` | blueprint at `knowledge-base/discoveries/blueprints/{slug}-blueprint.md` | `knowledge-base/judge-codex/{slug}-discover-judge-{date}.json` | ≥2-source evidence rule enforced; `fabricated_citation` caps to INVALID |
| `:plan` | plan at `knowledge-base/plans/{slug}-plan.md` + optional plan-confidence output | `knowledge-base/judge-codex/{slug}-plan-judge-{date}.json` | semantic completeness above `plan-confidence` M3 structural check; Goal SMART; Risks; fabricated citations beyond Evidence-block scope |
| `:implementation` | implementation log + `git log` of slice commits | `knowledge-base/judge-codex/{slug}-implementation-judge-{date}.json` | wiring triad pillar (a) caller present; TDD RED commit precedes GREEN; no symbol fabrication |
| `:final` | consolidated review report + raw agent finding files | `knowledge-base/judge-codex/{slug}-final-judge-{date}.json` | review-of-review: aggregator did not silently drop agent files; verdict consistent with findings |
| `:auto` | (orchestrates all 4 above) | `knowledge-base/judge-codex/{slug}-auto-judge-{date}.json` | smallest-cap-wins aggregation; halts at first disagreement when `--stop-on-disagreement` is set |

## Verdicts

The plugin uses **this** ecosystem's canonical vocabulary (NOT the binary `approve`/`needs-attention` of generic code review):

- `SHIPPABLE` (90–100)
- `SHIPPABLE_WITH_CAVEATS` (70–89)
- `NEEDS_REVISION` (50–69)
- `FAIL_SOFT` (49)
- `FAIL_HARD` (49)
- `INVALID` (0)

Plus meta-verdicts at the `:final` stage:

- `META_DEFECT_FOUND` — at least one hard-cap meta-defect (silently dropped agent file, verdict inconsistent with findings, fabricated finding location, process drift unlogged).
- `AGGREGATOR_BUG_SUSPECTED` — used when the inconsistency suggests `consolidate_findings.py` itself has a bug (the fix lives in this `plan` repo, not in the slice).

## Disagreement protocol

When `judge-codex:*` and the Claude-side equivalent gate (`/discover-confidence`, `/plan-confidence`, `/review`, etc.) reach **different verdicts** on the same artifact:

1. The disagreement is persisted at `knowledge-base/judge-codex/{slug}-{stage}-disagreement-{date}.json`.
2. The downstream pipeline is **paused** at the disagreeing stage.
3. **Human adjudication is required** — neither LLM is automatically trusted.

This is the entire point of having an orthogonal jury: agreement = high confidence; disagreement = signal for human attention. The system is designed to FAIL-CLOSED on disagreement, never silently pick one side.

## Hard gates

The plugin's per-stage hard caps mirror the canonical golden rules:

- `:discover` consults `rules/discover-blueprint-golden-rule.md`.
- `:plan` consults `rules/plan-confidence-golden-rule.md` (and the **unbreakable** `feedback_never_single_source_evidence` rule that is currently encoded in memory; will be promoted to a hard-cap detector in a follow-up slice).
- `:implementation` consults `rules/cycle-implement.md` + `rules/code-quality-golden-rule.md`.
- `:final` consults `rules/cycle-review.md`.

A `FAIL_HARD` or `INVALID` verdict at any stage **blocks downstream cycles** until either the underlying issue is fixed OR an explicit ADR dismisses it with a sunset window.

## Anti-patterns

- Treating `:auto` as a substitute for `/review` — it is a **complement**, never a replacement. The Claude `/review` 5–7-agent pipeline still runs; Codex jury runs in addition.
- Cherry-picking only the `:plan` stage and skipping `:final` — the review-of-review stage catches a class of meta-defects (e.g., consolidate_findings.py silently dropping agent files) that no other gate covers.
- Anchoring Codex's verdict to Claude's prior result — the plugin's prompt template explicitly instructs Codex *not* to anchor; treat anchoring as a quality-evaluator DISCARD signal.
- Silently absorbing a `FAIL_HARD` verdict to "keep the pipeline green" — the disagreement IS the signal. Fix or document via ADR, do not paper over.

## Output

- `knowledge-base/judge-codex/{slug}-{stage}-judge-{date}.json` per stage.
- `knowledge-base/judge-codex/{slug}-auto-judge-{date}.json` for `:auto` runs.
- `knowledge-base/judge-codex/{slug}-{stage}-disagreement-{date}.json` when Claude vs Codex differ.

## Install + first run

```bash
# Once per environment
npm install -g @openai/codex
codex login

# Install the plugin
/plugin marketplace add usetheodev/judge-codex-plugin-cc
/plugin install judge-codex@judge-codex
/reload-plugins

# Verify
/judge-codex:setup

# Use after any plan cycle stage
/judge-codex:plan my-slug
# OR end-to-end after a slice completes:
/judge-codex:auto my-slug
```

## Validated against

- **Live integration test (2026-06-04)** against `knowledge-base/plans/harden-fabrication-and-cq-gate-plan.md`:
  - Claude side `plan-confidence` (M3 v0.1): `SHIPPABLE` 98.8 — only structural check on `#### Evidence` blocks.
  - Codex side `judge-codex:plan`: `INVALID` 49 — caught fabricated `ADR D9` reference in plan prose outside Evidence blocks, plus 2 medium-severity soft caps (`goal_not_smart_timebound`, `risks_section_missing`).
  - Disagreement persisted as the **proof-of-value** for the cycle.

## Cross-references

- Schema for cycle rules: `rules/cycle-rule-schema.md`
- Plugin repo: https://github.com/usetheodev/judge-codex-plugin-cc
- Plugin's per-stage agents: https://github.com/usetheodev/judge-codex-plugin-cc/tree/develop/agents
- Upstream cycles: `rules/cycle-discover.md`, `rules/cycle-plan.md`, `rules/cycle-implement.md`, `rules/cycle-review.md`
- Related unbreakable rules (in memory, propagated from `plan` ecosystem): `feedback_never_single_source_evidence`, `feedback_discover_first_on_architecture`, `feedback_release_phase_explicit_pr_merge`.
