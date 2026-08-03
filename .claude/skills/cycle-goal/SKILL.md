---
name: cycle-goal
version: 0.1.0
requires: [auto-plan, to-plan, implement, code-quality, review, release, acceptance]
description: 'Turn one or more ROADMAP.md milestones into an active session goal. Validates the requested M<N> ids against ROADMAP.md (exists, still open, dependency order honoured), composes a termination condition whose single stop criterion is a green /acceptance run (ACCEPTED or ACCEPTED_WITH_CAVEATS) and which names the artifact each cycle phase must produce on the way there, and hands it to Claude Code''s built-in /goal — which registers a session-scoped Stop hook so the agent cannot stop until the condition is evaluated as met. Milestones run sequentially, one in flight at a time, per the single-flip invariant. Use AFTER /roadmap-init or /roadmap-feature have created the milestones and BEFORE driving them with /auto-plan. Refuses on unknown, already-released, or dependency-blocked milestones, and on a condition over /goal''s 4000-char cap.'
user-invocable: true
allowed-tools: Read Glob Grep Bash
argument-hint: "M<N> [M<N> ...]"
---

# `/cycle-goal` — Bind a session to one or more roadmap milestones

`/roadmap-init` writes the milestones. `/auto-plan` executes one. Between them sits a gap: nothing holds the session to the process. The agent can stop early, declare a phase done without its artifact, or drift into a second milestone before the first shipped.

This skill closes that gap. It hands Claude Code's built-in `/goal` a condition that only a genuinely finished milestone can satisfy.

## Cycle contract

This skill is the entry gate of [`cycle-roadmap`](../../rules/cycle-roadmap.md) — the macro super-loop. That rule is the **source of truth** for milestone selection, the single-flip invariant, dependency respect, the roadmap-run audit file, and the verdicts (`MILESTONE_RELEASED`, `MILESTONE_IN_FLIGHT`, `ROADMAP_COMPLETE`, `ROADMAP_BLOCKED`, `MILESTONE_BLOCKED`). **Read it before invoking.** This skill sets the termination condition; [`cycle-auto-plan`](../../rules/cycle-auto-plan.md) does the executing.

## When to invoke

`/cycle-goal M2` or `/cycle-goal M2 M3 M4` when:

- `ROADMAP.md` exists at the repo root and the named milestones are still `[ ]`.
- You are on the `workspace` branch (per `rules/git-safety.md`).
- You want the session bound to the full CYCLE process rather than to a single command.

Do NOT invoke when:

- `ROADMAP.md` is missing — run `/roadmap-init` first.
- The milestone is already `[x]` — a goal over finished work is met before any work happens.
- A dependency of the requested milestone is neither released nor part of the same call — resolve the wall first.
- A goal is already active — `/goal clear` cancels it before setting a new one.

## Unbreakable rules of the goal

These are stated inside the composed condition itself, not merely here — the Stop-hook evaluator reads the condition, so a rule that lives only in this file would not bind anything.

1. **The stop criterion IS the acceptance run.** The goal is met for a milestone **if and only if** `/acceptance M<N>` emitted `ACCEPTED` or `ACCEPTED_WITH_CAVEATS`.
2. **Nothing else ends it.** Not a green test suite, not `READY_TO_MERGE`, not `RELEASED`, not a published tag, not the agent's own sense that the work looks finished. `RELEASED` means it shipped; only the acceptance verdict means it works. That gap is exactly why `cycle-acceptance` exists, so a goal that stopped at `RELEASED` would re-open it.
3. **`/acceptance` not run ⇒ goal not met.** Silence is not a pass.
4. **`REJECTED` and `NOT_VALIDATED` never satisfy the goal.** Both keep it open, and both keep the checkbox `[ ]`.
5. **Three exits are closed by name:** re-running `/acceptance` without fixing what it found; editing the milestone's Definition of done so the run can pass; reporting a verdict `compute_acceptance_verdict.py` did not print. Each is a violation, not a completion.

The other six phases are in the condition as the honest path to that verdict — an acceptance run reached by skipping `/review` is not the same fact — but the terminator is one and only one thing.

## What `/goal` actually is

Getting this wrong produces a skill that looks right and does nothing, so it is stated plainly:

- `/goal <condition>` registers a **session-scoped Stop hook**. Every time the agent tries to stop, a small fast model judges the condition and re-prompts if it is not met.
- The evaluator reads the **transcript**, not the filesystem. A condition is only enforceable if the transcript would show the evidence — which is why the composed condition names artifacts the phases report.
- The condition has a **hard 4000-character cap**. Overflow is a gate violation here, never a truncation.
- `/goal` is a **termination condition, not a system prompt**. Persona and process discipline belong in this file, read into the session at invocation; only the verifiable condition goes to `/goal`.

## Process

### 1. Resolve and validate the milestones

```bash
python3 skills/cycle-goal/scripts/compose_goal_condition.py --roadmap ROADMAP.md M2 M3
```

The script is the deterministic gate. It parses `ROADMAP.md` with the same header shape `cycle-release` flips (`### M<N> — [ ] Name`), then refuses on: unknown id, already-`[x]` milestone, duplicate id, invalid id format, dependency wall, duplicated header, wrong header level, and condition over the cap. On success it prints the condition to stdout and exits 0; every refusal exits 1 with a `BLOCKED cycle-goal:` line naming the cause.

Milestones are normalized to ascending order — never parallel. If the caller's order differed, the script says so on stderr rather than reordering silently.

### 2. Read the operating contract into the session

Restate the contract below to the user, naming the specific milestones. This is the persona-and-discipline half, which `/goal` cannot carry.

### 3. Invoke `/goal`

Pass the script's stdout verbatim as the condition:

```
/goal <composed condition>
```

If the environment exposes the `SlashCommand` tool for built-in commands, issue it directly. Otherwise print the exact one-line command for the user to run — and say which of the two happened. Never report the goal as active without confirming the CLI acknowledged it (`A session-scoped Stop hook is now active with condition: …`).

### 4. Report

State: the ordered milestone chain, the condition's character count against the 4000 cap, whether `/goal` is confirmed active, and that `/goal clear` cancels at any time.

## The operating contract

Read into the session at step 2, adapted to the milestones in play.

**Role.** Senior engineer accountable for system design, architecture, design patterns, SOLID, DRY, KISS, DDD, automated testing, observability, performance, scalability, security. The priority is a solution that is robust, simple to maintain and ready to evolve — not one that merely passes.

**The process is the seven-phase cycle, in order, no phase implicit:**

| Phase | Rule | Produces |
|---|---|---|
| discover | [`cycle-discover`](../../rules/cycle-discover.md) | requirements, dependencies, risks, bottlenecks, edge cases, architectural impact |
| plan | [`cycle-plan`](../../rules/cycle-plan.md) | `knowledge-base/plans/{slug}-plan.md` with `milestone_id`, acceptance criteria, test strategy, rollback |
| implement | [`cycle-implement`](../../rules/cycle-implement.md) | `knowledge-base/implementations/{slug}-implementation.md`, one commit per task |
| code-quality | [`cycle-code-quality`](../../rules/cycle-code-quality.md) | quality verdict with no BLOCKER open |
| review | [`cycle-review`](../../rules/cycle-review.md) | `READY_TO_MERGE` verdict |
| release | [`cycle-release`](../../rules/cycle-release.md) | PR `workspace → develop`, then `develop → main` + semver tag → `RELEASED` |
| **acceptance** | [`cycle-acceptance`](../../rules/cycle-acceptance.md) | the released delivery exercised against the milestone DoD with evidence → `ACCEPTED`; **this is the terminator**, and only it flips the ROADMAP checkbox |

The fourth phase is the one most process descriptions omit. It is not optional here.

**Done is `cycle-acceptance`, not `cycle-release`.** The tag being cut is the second-to-last step; the milestone is finished when the released delivery was exercised and accepted.

**Integration is `cycle-release`, not a manual merge.** `workspace` originates the work, `develop` only integrates via promotion PR, `main` receives release merges. Direct commits to `develop` or `main` are forbidden by `rules/git-safety.md` — no exception for "just this once".

**Absolute rules.** Never bypass a phase. Never mask a problem with a workaround. Never invent results, evidence or data. Never claim something was executed, validated, tested or integrated without the artifact that proves it. Never omit a known risk. Never ignore an architectural failure.

**Always.** Think about bottlenecks, edge cases, integration failures, scalability, security, observability, systemic impact. Explain architectural decisions when they are not obvious. When uncertain, say so explicitly and propose an objective way to settle it — per the 95% confidence rule, stopping to ask beats redoing.

**Scope.** Only the named milestones, one in flight at a time, in ascending order.

## Hard gates

- **One milestone in flight.** Parallel milestones collide on shared modules and corrupt the audit trail (`cycle-roadmap` § Anti-patterns). The composed condition states the order and the script enforces ascending.
- **No goal over finished work.** An already-`[x]` milestone makes the condition true before anything happens, which reads as success and is not.
- **Dependency respect.** A dependency must be released already or earlier in the same call.
- **The terminator is the acceptance verdict, and only that.** A condition that would let `RELEASED` (or any earlier verdict) end the goal is malformed — it re-opens the shipped-vs-works gap `cycle-acceptance` closes.
- **Cap is a block, not a trim.** A condition over 4000 chars is refused with its measured length. Silently truncating would drop phases from the condition — the exact bypass this skill exists to prevent.
- **No unconfirmed activation.** Reporting "goal set" without the CLI's acknowledgement is the same class of unevidenced claim the contract forbids.

## Anti-patterns

- **Stuffing the persona into `/goal`.** It is a Stop-hook condition evaluated by a small model, and it would blow the cap. The persona belongs in the session; the condition stays verifiable.
- **Vague conditions.** "M2 is done" lets the evaluator accept an assertion. Name the artifact per phase.
- **Setting a goal to force work through a block.** A blocked phase means the condition is not met; the goal must not become a reason to invent a way around it.
- **Treating `RELEASED` as the finish line.** It is the second-to-last phase. A goal that stops there certifies that something shipped, not that it works.
- **Using this instead of `/auto-plan`.** This binds the session; it does not execute the cycle.
- **Leaving a goal active after the milestones ship.** `/goal clear` — a stale goal re-prompts against work nobody is doing.

## What this skill does NOT do

- Does not execute any cycle phase — `/auto-plan M<N>` does that.
- Does not edit `ROADMAP.md`. The checkbox flip belongs to `cycle-release`.
- Does not create plans, branches, commits or PRs.
- Does not clear an existing goal for you — that is `/goal clear`, a deliberate human act.
- Does not evaluate whether the condition was met. The CLI's evaluator owns that.

## Related

- [`skills/roadmap-init/SKILL.md`](../roadmap-init/SKILL.md) — creates `ROADMAP.md` and its milestones
- [`skills/roadmap-feature/SKILL.md`](../roadmap-feature/SKILL.md) — appends a milestone to an existing roadmap
- [`skills/auto-plan/SKILL.md`](../auto-plan/SKILL.md) — executes one milestone end-to-end
- `commands/plan-goal.md` — the sibling bridge that derives a `/goal` condition from an active plan instead of a milestone
- `commands/plan-loop.md` — cadence primitive that pairs with a goal
- `rules/git-safety.md` — the `workspace → develop → main` flow the release phase obeys
