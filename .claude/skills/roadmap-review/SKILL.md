---
name: roadmap-review
version: 0.1.0
requires: []
description: 'Review an existing ROADMAP.md for edge cases, inconsistencies, clarity and cohesion. Runs a deterministic structural pass (dependency cycles, unknown/forward/self dependencies, a milestone released before its own dependency, duplicate ids, the M0–M8 cap, missing M0, malformed headers that would break the checkbox flip, milestones with no Definition of done — which makes them un-acceptable by cycle-acceptance, unfilled template placeholders, missing top-level sections, empty out-of-scope) plus labelled heuristics for vague DoD bullets, layer-shaped milestone names and thin definitions of done. Every finding declares whether it is deterministic or heuristic, and the verdict (SHIPPABLE / SHIPPABLE_WITH_CAVEATS / NEEDS_REVISION / INVALID) is derived from the findings rather than asserted. Sister skill of /roadmap-init and /roadmap-feature — same artifact, read-only. Use after /roadmap-init, after /roadmap-feature, and before committing a roadmap the team will execute for months.'
user-invocable: true
allowed-tools: Read Glob Grep Bash
argument-hint: "[roadmap-path]"
---

# `/roadmap-review` — Review the roadmap before the team executes it for months

`/roadmap-init` writes a roadmap in one session. Everything downstream then treats it as settled: `cycle-roadmap` picks milestones from it, `/auto-plan` derives plans from it, `cycle-acceptance` reads each milestone's Definition of done **as its acceptance criteria**, and `cycle-release` flips its checkboxes.

A defect in the roadmap is therefore not a documentation problem. A milestone with no Definition of done can never be accepted, so its checkbox can never flip. A dependency cycle makes the macro loop emit `ROADMAP_BLOCKED` forever. A header at the wrong level silently breaks the flip. This skill finds those before the team spends a quarter on them.

It is **read-only**. It never edits `ROADMAP.md` — revisions are a human decision, as `/roadmap-init` established.

## When to invoke

- Right after `/roadmap-init`, before committing the roadmap.
- After `/roadmap-feature` appends a milestone (a new dependency can create a cycle that did not exist).
- Before starting a milestone, when the roadmap has been edited since it was written.
- When `cycle-roadmap` emits `ROADMAP_BLOCKED` and the dependency wall is not obvious.

Do NOT invoke when `ROADMAP.md` does not exist — run `/roadmap-init` first.

## Process

### 1. Run the structural pass

```bash
python3 skills/roadmap-review/scripts/check_roadmap_structure.py --roadmap ROADMAP.md
python3 skills/roadmap-review/scripts/check_roadmap_structure.py --roadmap ROADMAP.md --json
```

Exit 0 → `SHIPPABLE` / `SHIPPABLE_WITH_CAVEATS`. Exit 1 → `NEEDS_REVISION` / `INVALID`. Findings go to stderr with severity, source label, location and the consequence.

### 2. Read the report honestly

Two things must survive into what you tell the user:

- **The source label.** `deterministic` findings are exact — a dependency cycle either exists or it does not. `heuristic` findings are signals: a wish-word without a number, a milestone named after a layer. Presenting a heuristic with the same confidence as a cycle detection is how a reviewer's tone outruns what it can know.
- **The floor warning.** When a header is malformed, the per-milestone checks never ran on that milestone. The script emits `checks_skipped_behind_malformed_header` saying so. That report is a **floor, not a full accounting** — fix the blockers and re-run.

### 3. Add the judgement the script cannot make

The script checks shape. These need reading, and are where most real damage hides:

- **Scope contradiction.** Does a milestone's objective or DoD deliver something the `Explicitly out of scope` section excludes? The script cannot tell; a reader can.
- **Milestone sequencing.** Does M0 actually prove the architecture end to end — one provider, one endpoint, one caller — or is it a component that happens to be first?
- **Cohesion within a milestone.** Do its DoD bullets belong to one deliverable, or is it two milestones wearing one header?
- **Coverage against the stated success criterion.** If every milestone shipped exactly as written, would the `Success criteria` section be satisfied? A roadmap that cannot reach its own north star is the most expensive defect on this list, and it is invisible to any per-milestone check.
- **Edge cases in the promises.** For each DoD bullet: what happens on failure, at limit, on retry, with concurrency? A bullet that only describes the happy path becomes an acceptance criterion that only tests the happy path.

Report these separately from the script's findings, and say plainly that they are judgement.

### 4. Report

State the verdict, the finding counts by severity, the deterministic/heuristic split, the floor warning when it applies, then your judgement findings. Do not edit the roadmap.

## Verdicts

Reuses the `cycle-plan` vocabulary — this is a structural fitness verdict on a document, the same shape of decision, so it needs no new tokens.

- `SHIPPABLE` — no findings. The roadmap is executable as written.
- `SHIPPABLE_WITH_CAVEATS` — MINOR findings only. Executable; the caveats are worth a pass.
- `NEEDS_REVISION` — at least one MAJOR. Recoverable by editing the roadmap.
- `INVALID` — at least one BLOCKER. Something downstream is structurally broken: a milestone that can never be accepted, a cycle that can never resolve, a checkbox that can never flip.

## Hard gates

- **The verdict is derived, never asserted.** Severity → verdict is a pure function in the script. Reporting a verdict it did not print is the same class of unevidenced claim `cycle-acceptance` forbids.
- **Every finding carries its source label.** A heuristic reported as fact is worse than not reporting it, because it trains the team to ignore the reviewer.
- **A malformed-header report is a floor.** Never present it as a complete accounting.
- **Read-only.** This skill does not edit `ROADMAP.md`, does not renumber milestones, does not rewrite bullets.

## Anti-patterns

- **Treating a heuristic as a blocker.** Wish-word detection is a wordlist. `"Make failover faster"` may be perfectly clear in context — the finding starts a conversation, it does not end one.
- **Reviewing only the milestones.** The `Scope`, `Constraints` and `Success criteria` sections are what make milestones interpretable; a roadmap can have nine flawless milestones that do not add up to its stated goal.
- **Fixing the roadmap during the review.** Splitting the reviewer from the editor is the reason the finding is trustworthy.
- **Re-running until the verdict is green by editing wording rather than substance.** Renaming `"Backend"` to `"Backend work"` clears the heuristic and changes nothing.
- **Reviewing a roadmap nobody has to execute.** If the roadmap is a sketch, the review is theatre. Run it when the team is about to commit.

## What this skill does NOT do

- Does not write or edit `ROADMAP.md` — `/roadmap-init` creates, `/roadmap-feature` appends, humans revise.
- Does not validate technical feasibility of a milestone — that is `/edge-case-plan` + `/plan-confidence`, at plan level.
- Does not score a plan — that is `/plan-confidence`.
- Does not check whether milestones were delivered — that is `cycle-acceptance`.
- Does not clone or evaluate reference projects — that is `/roadmap-init`.

## Related

- [`skills/roadmap-init/SKILL.md`](../roadmap-init/SKILL.md) — creates the roadmap; its § Anti-patterns and both fixtures are this skill's normative catalog
- [`skills/roadmap-feature/SKILL.md`](../roadmap-feature/SKILL.md) — appends a milestone; re-run this review after it
- [`skills/edge-case-plan/SKILL.md`](../edge-case-plan/SKILL.md) — the plan-level sibling for edge cases
- [`skills/acceptance/SKILL.md`](../acceptance/SKILL.md) — consumes each milestone's Definition of done as acceptance criteria
- `rules/cycle-roadmap.md` — the macro loop that reads this artifact
- `rules/cycle-acceptance.md` — why a milestone without a Definition of done can never be closed
