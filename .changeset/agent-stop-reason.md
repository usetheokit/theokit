---
'@theokit/agents': minor
'theokit': minor
---

A run that was cut short says so. The terminal `done` frame and the turn metadata a client reads off
`UIMessage.metadata` now carry an optional `stopReason` — `'step_limit'` when the loop ran out of
tool-calling turns while the model still wanted more, `'no_progress'` when the doom-loop guard
stopped it repeating identical tool calls. The observability span `agent.run` records the same value
as `stop.reason`.

Both outcomes reached the caller as an ordinary `done` before this, identical in every field to a run
that finished on its own, so a surface could not tell "the agent answered" from "the agent was cut off
with a tool call still pending". The SDK reported both on its `RunResult`; the adapter's locally-typed
`wait()` declared no field to read them from, so nothing read them.

This is not the rare case it looks like: the SDK's iteration budget defaults to 8, so every served run
needing a ninth tool-calling turn was being truncated and reported as finished — including runs of
agents that never declared a ceiling.

Two reasons rather than a `truncated` flag, because they demand opposite reactions: `step_limit` means
re-sending continues the work, `no_progress` means re-sending repeats the loop that was just cut.
Nothing here re-sends — the SDK owns continuation; this reports the outcome.

A run that finishes on its own is unchanged: the field is absent, not `undefined`, so absence keeps
meaning "the agent finished" and a consumer that has never heard of `stopReason` receives exactly what
it received before.
