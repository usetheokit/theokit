---
description: "Bridge an active plan to Claude Code's built-in /goal primitive. Derives a goal condition from the plan (all sub-goals checked + Global DoD satisfied) and invokes /goal. Composes with the cycle without replacing ralph-loop in skills that still use it."
disable-model-invocation: true
allowed-tools: "Bash Read"
---

Bridge the active plan to Claude Code's `/goal` primitive.

## Steps

1. Resolve the active plan:
   - Prefer `${PLAN_SLUG}` env var
   - Then `.active_plan` pointer
   - Then newest `knowledge-base/plans/*-plan.md` by mtime
2. Read the resolved plan file.
3. Derive a goal condition from the plan's content:
   - **Default condition:** "all Objective checkboxes in `knowledge-base/plans/{slug}-plan.md` are checked AND the named metric in the Goal section is observable AND the Global DoD section's checkboxes all check"
   - If the user passed an argument (e.g., `/plan-goal until tests pass`), append it as an extra clause.
4. Issue Claude Code's `/goal {derived-condition}` invocation.
5. Confirm to the user:
   - Print the derived goal condition (truncated to 4000 chars if needed)
   - Print the active plan slug
   - Remind: `/goal clear` cancels the goal at any time

## Why this exists

`/goal` runs the agent until a small fast model confirms the named condition is met. It evaluates the transcript only, not files. By deriving the condition from the plan file, `/plan-goal` turns the file-based plan into a measurable termination criterion for `/goal`.

This complements the existing ralph-loop-based halt-loops in `/implement`, `/discover-execute`, and `/plan-improve`. Those skills can either:

- Continue using `ralph-loop:ralph-loop` (current default; see `rules/loop-engine-convention.md`), OR
- Be migrated incrementally to `/plan-goal` + `/plan-loop` composition (cheaper; uses Claude Code primitives; avoids the promise-detection regex bug seen in `/discover-execute` and `/plan-improve` iterations).

This file ships the BRIDGE — it does NOT mandate migration. Skills opt in when their authors prefer.

## Composition pattern (with /plan-loop for cadence)

```
/plan-loop 10m  →  /plan-goal until all phases complete
```

- `/plan-loop 10m` runs a tick every 10 minutes (built on Claude Code's `/loop`).
- `/plan-goal` provides the termination criterion that stops the cadence when the plan is genuinely done.

This is the lightweight equivalent of ralph-loop's `--completion-promise` mechanism, but uses Claude's native `/goal` evaluator (no custom regex; no transcript scraping).

## Notes

- `/plan-goal` does NOT replace `/goal`. Users can still run `/goal "any condition"` directly.
- The derived condition stays under `/goal`'s 4000-char limit by quoting only Objective + Goal-metric lines, not full task bodies.
- If `knowledge-base/plans/{slug}-plan.md` does not exist, this command refuses with "no plan found; run /to-plan first".
- Pairs naturally with `/plan-attest`: attest first to lock the plan; then `/plan-goal` to drive execution against the locked content.
