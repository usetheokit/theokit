---
'@theokit/agents': minor
---

The in-process turn can be told to retry, and a tool can read the run's real token usage.

**`retry` on the in-process turn (#474).** `streamAgentTurnInProcess` — the entry point an embedded
surface uses, and the one both surfaces of a terminal agent come through — accepts `retry?:
RetryOptions`. A transient provider failure that kills the turn before it produced anything is
recovered instead of ending it. `streamAgentUIMessages` accepts the same field, so the HTTP path
gains it too.

This is not the forwarded field the issue expected, and the difference is the whole fix.
`AgentRunnerRunOptions.retry` belongs to the reflective loop, whose round factory is allowed to
throw; this path runs one SDK turn, and — measured against the shipped `@theokit/sdk@4.52.1` —
the SDK never rejects on a provider failure. `agent.send()` resolves before the model is called, and
the loop's failure comes back as the run's terminal `status: "ERROR"` **event**. A `Retry` wrapper
around the stream's creation, which is what "thread the option through" would have produced, would
have compiled, shipped, and never fired. What ships instead treats that first `error` event as the
throw the SDK declined to make.

The retry window closes on the first event, so nothing has reached the caller and no tool has run —
a recovered failure can never re-apply an edit. Whether a failure is worth retrying is read from the
run's own typed error (`RunResult.error.cause` → `isTransientError`), never from the message text: a
rate limit retries, a bad key does not. Absent ⇒ a single attempt, byte-identical to before.

**`ctx.usage` for tool handlers (#475).** With `exposeUsageToTools: true`, every tool handler
receives the run's provider-reported token usage, read with `readRunUsage(ctx)` from
`@theokit/agents/usage`. This is what a `get_context_remaining` tool needs; before it, the only
figure reachable from inside a handler was a character-count estimate over `ctx.messages`.

The numbers come from the SDK's own `BudgetTracker`, which the agent loop calls after each LLM
completion with the provider's counts — so they are measurements, never projections. Until the first
report arrives the snapshot is `undefined`, not `0`: "not known yet" and "zero tokens used" are
different facts and only one is ever true. The context window travels with it when the model
**declared** one (`ModelSelection.contextWindow`), along with the `remainingTokens` that needs both
halves; for a bare model id both are absent rather than guessed from the model catalog, which
answers an unknown model with a conservative default and no way to tell that apart from a real
entry. A `budgetTracker` the caller already supplied is wrapped, not replaced, so an existing spend
gate keeps gating.

Both options are additive: omitting them leaves the stream, the SDK call, and the tool ctx exactly as
they were.
