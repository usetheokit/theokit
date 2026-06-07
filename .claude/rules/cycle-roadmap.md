# Cycle: ROADMAP (macro super-loop)

Source of Truth for the macro super-loop that runs from a `ROADMAP.md` milestone all the way back to the same `ROADMAP.md` with the milestone's checkbox flipped to `[x]`. Sits **above** `cycle-auto-plan`: where `cycle-auto-plan` orchestrates one feature end-to-end, `cycle-roadmap` orchestrates the whole project — milestone by milestone — until the roadmap is exhausted.

## Purpose

Close the feedback loop between **strategic intent** (`ROADMAP.md` written by `/roadmap-init`) and **delivered work** (`RELEASED` verdicts from `cycle-release`). Without this loop, the roadmap drifts: milestones get implemented but the checkbox never flips, the team loses the bird's-eye view, and the roadmap rots into a stale artifact within weeks.

The cycle produces no new files of its own. It produces **state transitions on `ROADMAP.md` checkboxes** and **traceability** between every released artifact and the milestone it satisfies.

## Pre-conditions

- `ROADMAP.md` exists at the repo root (typically created by `/roadmap-init` at project inception).
- `ROADMAP.md` has at least one milestone with `[ ]` (unchecked).
- The working branch is `develop` (per Unbreakable Rule 4 — `main` is release-only).
- `knowledge-base/references/` may be populated by `/roadmap-init`; downstream `cycle-discover` will read from it when invoked.

Do NOT trigger when:

- `ROADMAP.md` is missing — run `/roadmap-init` first.
- Every milestone is already `[x]` — the project's V1 scope is complete; the team must either declare V2 (new `ROADMAP-v2.md`) or stop.
- The next-eligible milestone's dependencies are all still unchecked — surface the dependency wall to the human rather than picking arbitrarily.

## Chain

The macro loop. Each milestone is one full pass through the inner chain; the outer loop continues until no `[ ]` milestone is eligible.

```
SELECT next milestone:
     ↓ read ROADMAP.md
     ↓ filter milestones with [ ]
     ↓ filter milestones whose declared dependencies are all [x]
     ↓ pick the first (lowest milestone ID — M0 before M1 before M2…)
     ↓
     ↓ if NO eligible milestone:
     ↓   if all milestones are [x]                 → emit ROADMAP_COMPLETE
     ↓   if [ ] milestones blocked by dependencies → emit ROADMAP_BLOCKED
     ↓
LOCK milestone:
     ↓ record knowledge-base/roadmap-runs/{milestone-id}-{date}.md (status: in_progress)
     ↓
DELEGATE to /auto-plan:
     ↓ Skill(/auto-plan M<N>)
     ↓   /auto-plan reads ROADMAP.md § M<N>, derives slug, persists milestone_id in plan frontmatter
     ↓   /auto-plan runs cycle-discover → cycle-plan → cycle-implement → cycle-code-quality → cycle-review → cycle-release
     ↓   /auto-plan exits with auto-plan verdict (RELEASED | PR_OPEN_AWAITING_APPROVAL | BLOCKED)
     ↓
ON RESUME after PR merge (when /auto-plan paused at PR_OPEN_AWAITING_APPROVAL):
     ↓ /release --resume triggers the post-merge phase
     ↓ post-merge phase flips ROADMAP.md M<N> checkbox [ ] → [x]
     ↓ updates roadmap-runs/{milestone-id}-{date}.md (status: completed)
     ↓
LOOP back to SELECT until ROADMAP_COMPLETE or ROADMAP_BLOCKED.
```

When invoked interactively (`/auto-plan` without args), the loop runs **one milestone per invocation**: select, delegate, exit at the human-approval gate. The human approves the release PR; on the next invocation, the loop resumes from SELECT after the previous milestone's checkbox was flipped.

When invoked autonomously (rare — only the `/auto-plan --until=ROADMAP_COMPLETE` opt-in flag), the loop iterates milestones back-to-back, pausing only at human-approval gates.

## Phase contracts

| Phase | Input | Output | Hard gate |
|---|---|---|---|
| select | ROADMAP.md | milestone_id ∈ {M0…M8} OR cycle terminator | exactly one eligible milestone (or terminator) chosen deterministically |
| lock | milestone_id | `knowledge-base/roadmap-runs/{milestone-id}-{date}.md` with `status: in_progress` | no other run-file for the same milestone with status: in_progress |
| delegate | milestone_id + objective + DoD from ROADMAP.md | auto-plan verdict | auto-plan ran with `--milestone={milestone_id}` injected into the plan frontmatter |
| flip-checkbox (post-merge) | RELEASED verdict from cycle-release | ROADMAP.md edited; `[ ]` → `[x]` on the milestone header | exactly one milestone flipped per release; plan frontmatter `milestone_id` matched a ROADMAP.md milestone exactly |

## Verdicts

- `MILESTONE_RELEASED` — one milestone completed end-to-end this invocation; checkbox flipped to `[x]`; loop ready to advance to next.
- `MILESTONE_IN_FLIGHT` — auto-plan paused at `PR_OPEN_AWAITING_APPROVAL`; human approval pending; checkbox NOT flipped yet.
- `ROADMAP_COMPLETE` — every milestone is `[x]`; the roadmap as written is fully delivered. The next decision (V2? archive?) is human-only.
- `ROADMAP_BLOCKED` — `[ ]` milestones remain but each one's dependencies are themselves still `[ ]`. Cannot pick a target without violating the dependency graph. Surface the dependency wall to the human.
- `MILESTONE_BLOCKED` — auto-plan returned `BLOCKED` for the selected milestone. The roadmap run-file records why; the human resolves.

## Hard gates

- **Single-flip invariant.** Every successful `cycle-release` flips at most ONE milestone checkbox. Multi-milestone releases violate the wiring triad assumption and corrupt traceability.
- **No silent flip.** Flipping `[ ]` → `[x]` MUST be recorded in `knowledge-base/roadmap-runs/{milestone-id}-{date}.md` with the release SHA, the plan slug, and the merge commit. Flips without a run-file are forbidden.
- **No flip without plan metadata.** If the plan at `knowledge-base/plans/{slug}-plan.md` does not declare `milestone_id: M<N>` in its frontmatter, the flip step is SKIPPED with a WARN — the human edits the checkbox manually. Silent flips based on slug-matching heuristics are forbidden.
- **Dependency respect.** The select phase MUST honor declared milestone dependencies. Skipping M3 to run M5 when M5 depends on M3 corrupts the project's structural sequence.

## Stop conditions

- `ROADMAP_COMPLETE` emitted — outer loop terminates; human decides V2 / archive / new project.
- `ROADMAP_BLOCKED` emitted — outer loop halts; surface the dependency wall.
- `MILESTONE_BLOCKED` emitted with no recoverable next step (the human cannot resolve auto-plan's block) — outer loop halts.
- Human invokes any cycle skill directly (manual override) — the outer loop is paused; the human is driving.

## Plan metadata contract (new)

For `cycle-release` to know **which** milestone to flip, the plan at `knowledge-base/plans/{slug}-plan.md` MUST carry `milestone_id` in its frontmatter:

```yaml
---
slug: {slug}
milestone_id: M2          # one of M0…M8 — must match a header in ROADMAP.md exactly
created_at: YYYY-MM-DD
goal: <one sentence>
---
```

Population paths:

1. **Via `/auto-plan M<N>`** — the orchestrator reads ROADMAP.md § M\<N\>, derives the slug from the milestone name, and writes `milestone_id: M<N>` into the plan frontmatter automatically.
2. **Via `/to-plan {slug} --milestone M<N>`** — the human invokes plan directly; the CLI flag injects the metadata.
3. **Manual** — the human edits the plan frontmatter to add `milestone_id` before invoking `/release`.

A plan without `milestone_id` releases normally but skips the checkbox flip (with a WARN, not a BLOCK). Roadmap traceability degrades but the release itself is not impeded — by design, so urgent hotfixes are not gated on roadmap metadata.

## Roadmap run-file contract (new)

Every milestone run gets one file at `knowledge-base/roadmap-runs/{milestone-id}-{YYYY-MM-DD}.md`:

```markdown
---
milestone_id: M<N>
slug: <slug>
date: YYYY-MM-DD
status: in_progress | completed | blocked
plan: knowledge-base/plans/{slug}-plan.md
implementation: knowledge-base/implementations/{slug}-implementation.md
review: knowledge-base/reviews/{slug}-review-{date}.md
release: knowledge-base/releases/v{version}-release.md
checkbox_flipped_at: <ISO timestamp> | null
flip_commit_sha: <sha> | null
---

# Milestone M<N> — <name>

## Objective (from ROADMAP.md)

<verbatim copy>

## Definition of done (from ROADMAP.md)

<verbatim copy with checkbox state at time of run>

## Outcome

<one-paragraph human summary written after MILESTONE_RELEASED>
```

This file is the audit trail between strategic intent (ROADMAP.md) and shipped reality (releases). Auditors read this folder to answer "did we actually deliver M3?" without spelunking commits.

## Anti-patterns

- **Flipping a checkbox without running cycle-release.** The roadmap reflects shipped state, not intent. Manual flips bypass the audit trail.
- **Running multiple milestones in parallel by editing two plans simultaneously.** The wiring triad assumes one milestone in flight; concurrent plans collide on shared modules and corrupt the audit trail.
- **Skipping the milestone-id population.** Plans without `milestone_id` lose roadmap traceability. Acceptable for hotfixes; never acceptable for planned work.
- **Editing ROADMAP.md mid-cycle.** Changing milestone objectives or DoD while the milestone is `in_progress` invalidates the plan-to-roadmap mapping. Revisions wait for the milestone to finish.
- **Picking a non-eligible milestone.** Skipping M3 to start M5 when M5 declares M3 as dependency is a structural violation. The select phase exists to prevent this.
- **Treating ROADMAP_BLOCKED as a single failure.** When the loop blocks, the dependency wall is a structural issue — the human re-scopes (either resolve the wall or revise the roadmap). Re-running the loop without changes will block identically.

## Cross-references

- Schema for cycle rules: `rules/cycle-rule-schema.md`
- Bootstrapper skill (single-shot at project inception): `skills/roadmap-init/SKILL.md` — produces `ROADMAP.md` and `knowledge-base/references/`
- Orchestrator (delegated to per milestone): `rules/cycle-auto-plan.md`
- Downstream chained cycles (via `cycle-auto-plan`): `rules/cycle-discover.md`, `rules/cycle-plan.md`, `rules/cycle-implement.md`, `rules/cycle-code-quality.md`, `rules/cycle-review.md`, `rules/cycle-release.md`
- Cycle that performs the checkbox flip: `rules/cycle-release.md § post-merge checkbox flip`
- Conventions: `rules/loop-engine-convention.md`
- Unbreakable rules consumed: Rule 4 (no commit to `main`; release-PR-only)
