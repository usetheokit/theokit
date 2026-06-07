---
description: "Run a planning-aware cadence on top of Claude Code's /loop. Default tick reads the active plan + recent progress.md, runs lightweight completeness checks, nudges progress.md if stalled. Pairs with /plan-goal for termination."
disable-model-invocation: true
allowed-tools: "Bash Read"
---

Run a planning-aware recurring tick on top of Claude Code's `/loop` primitive.

## Steps

1. Parse args:
   - First arg matching `^\d+[smhd]$` is the interval (default `10m`)
   - Remaining args are an optional task prompt (overrides the default tick prompt)
2. Resolve the active plan via the same path as `/plan-goal` (`${PLAN_SLUG}` env > `.active_plan` > newest plan file).
3. Compose the loop tick prompt:
   - If the user passed a task prompt: use it verbatim.
   - Else: use the default planning tick prompt below.
4. Invoke `/loop <interval> "<prompt>"`.
5. Confirm to the user: print the interval, the active plan slug, and remind that bare `/loop` (no args) runs Claude Code's built-in maintenance prompt — `/plan-loop` differs by always grounding the tick in the planning files.

## Default planning tick prompt

```
Read `knowledge-base/plans/{slug}-plan.md` and the tail of
`knowledge-base/progress/{slug}-progress.md` (last 20 lines).

If no new entry has been added to progress.md since the previous tick,
write one summarizing the current state and what blocked progress.

If a phase finished (per Acceptance Criteria), update the Status line
in the plan AND `/plan-attest {slug}` to refresh the hash.

If work remains, continue executing the next task per the Dependency
Graph in the plan.
```

## Why this exists

`/loop` runs prompts on a cron schedule without any plan-state contract. `/plan-loop` injects a plan-aware default so the recurring tick always re-reads the planning files first, runs the completeness check, and writes a progress entry. Users get "babysit my plan" UX without writing a custom loop prompt every time.

This is the cadence half of the composition pattern:

```
/plan-loop 10m   ← cadence (this command)
/plan-goal       ← termination criterion (sibling command)
```

Together they replace ralph-loop's `--max-iterations` + `--completion-promise` mechanism with Claude Code's native primitives — cheaper, no custom transcript scraping, no regex promise-detection bugs.

## Notes

- `/plan-loop` composes with `/loop`; it does NOT replace it. `/loop 5m "anything"` still works.
- For "babysit until plan is done" semantics, combine `/plan-loop 10m` (cadence) with `/plan-goal` (termination). The loop runs every 10 minutes; the goal stops it when the plan is complete.
- The default tick prompt is intentionally short to stay within compaction-safe length.
- If `knowledge-base/plans/{slug}-plan.md` does not exist, this command refuses with "no plan found; run /to-plan first".
