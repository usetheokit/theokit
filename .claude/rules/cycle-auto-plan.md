# Cycle: AUTO-PLAN (sub-cycle of cycle-roadmap)

Source of Truth for the end-to-end autonomous orchestrator. Sits **below** `cycle-roadmap` in the cycle hierarchy: `cycle-roadmap` selects the next milestone and delegates one full `cycle-auto-plan` run per milestone.

## Purpose

Chain DISCOVER → PLAN → IMPLEMENT → CODE-QUALITY → REVIEW → RELEASE autonomously for **one milestone** (or one ad-hoc topic), taking it from idea to a release PR awaiting human approval — without the user having to invoke 9+ slash commands manually. Default mode is `full-pipeline`; the `--plan-only` flag retains the legacy "discover + plan" behavior.

Two invocation modes coexist:

- **Roadmap-driven** (`/auto-plan M<N>` OR `/auto-plan` without arg): reads `ROADMAP.md`, takes the milestone objective + DoD as the input topic, persists `milestone_id` in the resulting plan frontmatter so `cycle-release` can flip the checkbox post-merge.
- **Ad-hoc** (`/auto-plan {topic-slug}`): legacy mode for work outside the roadmap (hotfixes, exploratory). The plan does NOT carry `milestone_id` — `cycle-release` skips the checkbox flip with a WARN.

## Pre-conditions

- The topic is large enough that running cycles manually would be tedious.
- The user explicitly authorizes autonomous execution.
- **Roadmap-driven mode only:** `ROADMAP.md` exists at the repo root AND at least one milestone is `[ ]` (unchecked) AND has all its declared dependencies satisfied (all `[x]`).

When NOT to use:
- A plan already exists AND only implementation remains → call `/implement` directly.
- The feature is trivial (< 1 hour by hand).
- You're not 95% sure about requirements (Unbreakable Rule 1).
- **Roadmap-driven mode:** all milestones already `[x]` (project's V1 scope is complete — declare V2 or stop) OR every `[ ]` milestone is blocked by another `[ ]` (dependency wall — `cycle-roadmap` emits `ROADMAP_BLOCKED`).

## Chain

Default roadmap-driven (`/auto-plan` or `/auto-plan M<N>`):

```
/auto-plan M<N>
     ↓ READ ROADMAP — extract milestone objective + DoD; derive slug; record milestone_id
     ↓ DISCOVER     (full chain, if no prior blueprint)
     ↓ PLAN         (full chain — auto-injects MUST-FIX from edge-case-plan into the plan)
     ↓                — plan frontmatter carries milestone_id: M<N> (contract with cycle-roadmap)
     ↓ gate:         only proceed if /plan-confidence ≥ SHIPPABLE_WITH_CAVEATS
     ↓ IMPLEMENT    (halt-loop until IMPLEMENTATION_COMPLETE)
     ↓ CODE-QUALITY (audit; gate proceeds only when PASS / PASS_WITH_CAVEATS)
     ↓ REVIEW       (5-7 specialist agents)
     ↓ gate:         only proceed if /review = READY_TO_MERGE
     ↓ RELEASE      (opens develop→main PR with semver tag; PAUSES for human approval)
     ↓                — post-merge: cycle-release flips ROADMAP.md M<N> [ ] → [x]
     ↓ verdict:      RELEASED OR PR_OPEN_AWAITING_APPROVAL
```

Ad-hoc (`/auto-plan {topic-slug}` with arbitrary slug):

```
/auto-plan {topic-slug}
     ↓ (same chain as above)
     ↓ plan frontmatter carries NO milestone_id (this work is off-roadmap)
     ↓ post-merge: cycle-release SKIPS the checkbox flip with WARN
     ↓ verdict:      RELEASED OR PR_OPEN_AWAITING_APPROVAL
```

`--plan-only` mode:

```
/auto-plan {topic-slug} --plan-only
     ↓ DISCOVER
     ↓ PLAN
     ↓ stops at the locked plan; user invokes /implement manually later
```

## Confidence gates between phases

- Before PLAN starts: discovery blueprint exists OR user explicitly confirms no prior art needed (deterministic; pre-recorded via `--no-discover`).
- Before IMPLEMENT starts: plan-confidence verdict ≥ SHIPPABLE_WITH_CAVEATS.
- Before CODE-QUALITY starts: implementation emitted `IMPLEMENTATION_COMPLETE`.
- Before REVIEW starts: code-quality verdict ∈ {`PASS`, `PASS_WITH_CAVEATS`}.
- Before RELEASE starts: review verdict = `READY_TO_MERGE`.
- Final manual gate: human approves the release PR. Auto-merge is forbidden (Unbreakable Rule 4).

Any gate failure → pause + surface the blocking finding. The orchestrator does NOT loop indefinitely; after 1 fix-and-retry attempt at the same gate, it halts with `BLOCKED` and asks the human.

## Stop conditions

- Any cycle's stop condition fires.
- A hard gate failure that the orchestrator cannot resolve autonomously (e.g., merge conflict, missing credential).

## Anti-patterns

- Running `/auto-plan` on a topic with unclear requirements. Garbage in, garbage out.
- Ignoring the confidence gates ("just proceed anyway"). The gates exist to catch divergence early.
- Mixing manual and auto-plan invocations on the same slug — they share state and will conflict.

## When manual cycles are preferred

For most features, running cycles manually with human review between them produces better output than autonomous chaining. Reserve `/auto-plan` for topics where the orchestration overhead actually pays for itself.

## Cross-references

- Schema for cycle rules: `rules/cycle-rule-schema.md`
- Orchestrator skill: `skills/auto-plan/SKILL.md`
- Upstream macro super-loop: `rules/cycle-roadmap.md` — selects the next milestone, delegates one full `cycle-auto-plan` run per milestone
- Chained cycles: `rules/cycle-discover.md`, `rules/cycle-plan.md`, `rules/cycle-implement.md`, `rules/cycle-code-quality.md`, `rules/cycle-review.md`, `rules/cycle-release.md`
- Conventions: `rules/loop-engine-convention.md`
