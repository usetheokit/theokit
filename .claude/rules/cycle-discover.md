# Cycle: DISCOVER

Source of Truth for the discovery cycle. Skills consume this; do not duplicate content into SKILL.md.

## Purpose

Investigate **how others solved a problem** before writing code. Outputs a blueprint of patterns, trade-offs, and references — never code.

## Pre-conditions

- "How does <project X> handle <Y>?"
- "What does the field do for <problem Z>?"
- A planning task is blocked because nobody on the team knows the prior art.
- (Optional macro context) — when running the `cycle-roadmap` super-loop, the active milestone's references in `knowledge-base/references/` (seeded by `/roadmap-init`) are the natural starting set for `/discover-plan`.

Do NOT trigger DISCOVER for:
- Locating a symbol in your own code (use Grep/Glob).
- Questions answered by reading your own `README.md` / `ARCHITECTURE.md`.

## Chain (unbreakable)

```
/discover-plan {topic-slug}
     ↓ (produces: knowledge-base/discoveries/plans/{slug}-plan.md)
/discover-edge-cases {topic-slug}
     ↓ (absorbs MUST-FIX into the plan)
/discover-plan-confidence {topic-slug}
     ↓ (plan-gate: structural score of the discovery plan itself; INVALID returns to /discover-plan)
/discover-execute {topic-slug}
     ↓ (produces: knowledge-base/discoveries/blueprints/{slug}-blueprint.md)
/discover-confidence {topic-slug}
     ↓ (blueprint score; INVALID returns to /discover-plan)
/discover-improve {topic-slug}  [optional — only if blueprint score is NEEDS_REVISION]
```

A blueprint is the terminal artifact of this cycle. Distilling a SHIPPABLE blueprint into a reusable skill is **out of the cycle** and entirely optional: invoke the standalone `/skill-creator` (`skills/skill-creator/`) on demand to author a first-class skill at `skills/{purpose}/`. The former in-cycle `skill-writer → skill-validator → skill-register` tail (and its `skills/generated/` staging area) has been retired.

## Phase contracts

| Phase | Input | Output | Hard gate |
|---|---|---|---|
| plan | topic slug + 1-sentence question | discovery plan with sources, questions, deliverables | sources cited and reachable |
| edge-cases | discovery plan | annotated plan with MUST-FIX items | every MUST-FIX has a citation or open question |
| plan-confidence | annotated plan | score + verdict on the plan itself | no fabricated citation; coverage corners non-empty |
| execute | annotated + scored plan | blueprint (patterns, trade-offs, references) | no fabricated citations |
| confidence | blueprint | score + verdict (INVALID / NEEDS_REVISION / SHIPPABLE_WITH_CAVEATS / SHIPPABLE) | INVALID returns to plan |
| improve (opt.) | NEEDS_REVISION blueprint | revised blueprint | bumped verdict on re-score |

## Halt-loop contracts (rigorous promises with measurable exit criteria)

Two phases drive autonomous halt-loops via `ralph-loop:ralph-loop`. Both follow the same rigorous template established for `/implement` (per `rules/cycle-implement.md`): pre-flight guard against concurrent ralph-loops, formal stop conditions, post-promise sanity check, anti-patterns enumerated, honest BLOCKED report over false PASS.

### /discover-execute (Phase 4)

- **Completion promise:** `<promise>BLUEPRINT_COMPLETE</promise>` — asserts (a) every plan question is `done` OR `blocked` with reason, (b) every citation in the blueprint resolves on disk, (c) all four coverage corners populated, (d) ≥ 1 ADR section. Step 7 post-promise sanity check re-verifies citation integrity. The loop runs until every assertion holds; never emit the promise on a partial state.
- **Failure promise:** `<promise>BLUEPRINT_BLOCKED</promise>` — emitted ONLY when a stop condition fires that genuinely cannot be resolved by another iteration (e.g., a cited source returns 404 and no alternative exists). Never emitted as a graceful exit from "too many iterations".
- **Stop conditions:** see `skills/discover-execute/SKILL.md § Stop conditions` (6 enumerated cases).

### /discover-improve (Phase 5, optional)

- **Completion promise:** `<promise>BLUEPRINT_IMPROVED</promise>` — asserts re-run of `run_blueprint_score.py` in the emitting iteration shows verdict ≥ `--target`. Step 6 post-promise sanity check re-verifies score-on-disk. The loop runs until the score on disk reaches the target; partial improvements do not justify emitting the promise.
- **Stop conditions:** see `skills/discover-improve/SKILL.md § Stop conditions` (6 enumerated cases). When the loop stops without reaching the target, emit a BLOCKED report (no completion promise) and surface the structural blocker to the human.

Either loop emitting a BLOCKED report blocks downstream: `/discover-confidence` MUST NOT honor the blueprint as SHIPPABLE until the human resolves the blocker.

## Stop conditions

- Verdict INVALID → return to `/discover-plan` (rewrite the question).
- 3 consecutive iterations without confidence improvement → escalate to a human.
- Either halt-loop emits BLOCKED → cycle pauses; downstream phases MUST NOT proceed.

## Anti-patterns

- Discovery that turns into implementation. The output is a document, not code.
- Fabricated citations (URLs that 404, projects that don't exist). The hook does not catch this — review does.
- Stopping at one source. A blueprint needs ≥ 2 independent references.
- Skipping `/discover-edge-cases`. Edge cases that surface here are the ones that protect downstream cycles from re-scoping mid-implementation; the phase is mandatory in the chain.

## Rollback

A blueprint that turns out wrong is simply not consumed downstream — delete or supersede the file under `knowledge-base/discoveries/blueprints/`. If a skill was later authored from it via the standalone `/skill-creator`, remove that skill with `rm -rf skills/{purpose}/`; `/to-plan`'s Step 0 stops discovering it on the next run.

## Cross-references

- Schema for cycle rules: `rules/cycle-rule-schema.md`
- Skills: `skills/discover-plan/SKILL.md`, `skills/discover-edge-cases/SKILL.md`, `skills/discover-plan-confidence/SKILL.md`, `skills/discover-execute/SKILL.md`, `skills/discover-confidence/SKILL.md`, `skills/discover-improve/SKILL.md`
- Optional skill distillation (out of cycle): `skills/skill-creator/SKILL.md`
- Allowlist: `rules/discover-web-allowlist.txt`
- Macro super-loop: `rules/cycle-roadmap.md` — seeds `knowledge-base/references/` at project inception via `/roadmap-init`
- Downstream: `rules/cycle-plan.md` (consumes blueprints as input to `/to-plan`)
