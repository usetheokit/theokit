# 0024: Two agent-loop functions keep their complexity until a dedicated refactor

- Status: Accepted
- Date: 2026-10-09
- Deciders: the repository owner, in the S-001 session

## Context

The independent `loop-code-review` audit of sprint S-001 measures cyclomatic complexity with lizard
and blocks on two functions in `@theokit/agents`:

- `delegate()` in `packages/agents/src/bridge/agent-orchestrator.ts`, CCN 24;
- `runReflectiveLoopStream()` in `packages/agents/src/loop/run-reflective-loop.ts`, CCN 12.

The audit also measured both at the merge base `bcddf164` and found the same values: the sprint
did not introduce or grow either number. It reports them because the sprint's fixes touch lines
inside both functions (the run-budget resolution in `delegate()` and one call in the loop).

Splitting either function late in the sprint would change the control flow of the delegation and
loop paths that every agent run goes through, in the same release that already changes their
budget handling.

## Decision

Both functions keep their current shape for this release. Bringing them below CCN 10 is a separate
refactor, done on its own with the delegate, loop, adapter and ACP suites passing unchanged before
and after it.

The audit's findings stay in each report and are read as this recorded decision. A new function
over the threshold, or either of these two growing, still blocks.

<!-- AUDIT-CAP-DISMISSED: loop-code-review: LCR0302@packages/agents/src/bridge/agent-orchestrator.ts#delegate: CCN 24 measured unchanged at the merge base; refactor deferred to its own change (this ADR) -->
<!-- AUDIT-CAP-DISMISSED: loop-code-review: LCR0302@packages/agents/src/loop/run-reflective-loop.ts#runReflectiveLoopStream: CCN 12 measured unchanged at the merge base; refactor deferred to its own change (this ADR) -->

## Considered options

1. **Defer to a dedicated refactor** (chosen). The release ships the budget fixes on code whose
   shape is already tested, and the refactor gets its own review.
2. **Refactor both now.** Rejected: it moves control flow that every run depends on, in the release
   that already changes the budget semantics, and doubles what one review has to verify.
3. **Raise the audit's threshold.** Rejected: moving a threshold to pass a gate is not allowed.

## Who is affected, and what breaks

Nobody outside the package: neither function's signature or behaviour changes. The cost is that
two functions above the threshold stay in the code until the refactor lands.
