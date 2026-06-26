# Review — V4-R AgentRunner injectable RoundStreamFactory

**Date:** 2026-06-26 · **Slug:** v4r-runner-stream-factory · **Commit:** 6d02c56 (+ multi-round test)
**Reviewers:** 1 adversarial (minimal additive run-option, mirror of V4-Q). **Verdict: READY_TO_MERGE**

## Severity matrix (after remediation)
| BLOCKER | HIGH | MEDIUM | LOW | INFO |
|---|---|---|---|---|
| 0 | 0 | 0 | 0 (resolved) | 0 |

## Adversarial — READY_TO_MERGE
- Backward-compat HOLDS: `streamFactory?` optional; `opts.streamFactory ?? createSdkAgentStream(...)` resolves to the exact prior expression when absent; `delegate()` untouched; suite 411 green.
- Factory drives the loop PROVEN without an SDK mock: injected factory → `runReflectiveLoopStream` → `startRound` → `factory(prompt, sessionId)`; test asserts response/tokens from the injected stream, zero `@theokit/sdk` mock (the `??` short-circuit means `createSdkAgentStream` is never called).
- Encapsulation HOLDS: barrel exports `type RoundStreamFactory` only; the driver `runReflectiveLoop`/`runReflectiveLoopStream` stays internal (grep-verified).
- JSDoc honest + precisely scoped (SDK-create options unused when injected; loop options still apply).
- Types clean (`import type` modifier; no agent-runner↔run-reflective-loop cycle); G6 ok.

## LOW finding — RESOLVED
- **LOW (test gap):** no case combined `streamFactory` with multi-round loop options. **Fixed:** added `test_injected_factory_drives_multiple_rounds_under_react` (a react agent re-enters the injected factory on a tool-calls round, terminates on the answer round; asserts `round===2`, accumulated `tokens===4`, `response==='final'`). 3/3 green.

## Decision
No BLOCKER/HIGH/MEDIUM; the LOW remediated. **READY_TO_MERGE.** Closes the last adoption seam — an app can adopt `AgentRunner.stream()` while keeping its stream-injection tests (theocode's ~30 mock files need no rewrite, only a reverse-translator wrapper).
