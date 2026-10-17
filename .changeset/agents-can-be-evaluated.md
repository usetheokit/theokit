---
'@theokit/agents': minor
---

New subpath `@theokit/agents/evals`. `runAgentEvals({ agent, apiKey, approvals, cases, scorers })` runs each case against your agent definition, on a fresh agent per case, and returns a verdict per case: `pass` or `fail` against `threshold` (default 0.5), or `error`. Each case result carries the output, the scores, the mean score and the duration, and the result counts each verdict. (B-413)

`approvals` is required, as it is on `toAgentFactory`: an eval runs with nobody watching, so you say what a gated tool's approval request gets. A case is `error`, never `fail`, when its run did not finish, a guard blocked the input or the output, the agent could not be built, a scorer threw, or a scorer returned a malformed score or one outside [0, 1]; `error` carries the reason. A scorer's own `reason` text never makes a case an `error`. Options it cannot run (no cases, a case without a string `input`, no scorers, a threshold outside [0, 1]) throw `EvalConfigError` before any agent is built. Unnamed runs get a fresh name, so two runs never collide. The subpath re-exports `Scorers` and `EvalAlreadyRunningError` from `@theokit/sdk/eval`.

The result type of `SdkTurnHandle.wait()` gains two optional fields, `status` and `error`, which the SDK eval runner reads.
