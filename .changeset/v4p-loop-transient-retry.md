---
"@theokit/agents": minor
---

V4-P: per-round transient retry in the reflective loop.

`AgentRunnerRunOptions.retry?: RetryOptions` (and `RunReflectiveLoopConfig.retry`) opt into retrying a transient failure at a round START — the factory creation + first event, before any event is yielded, so a recovered 429/5xx/network blip never re-applies an edit. Reuses the SDK `withRetry` (`@theokit/sdk/retry`, default `isRetryable: isTransientError`), dynamic-imported only when `retry` is set so the loop stays SDK-optional. Once an event is yielded, a throw propagates (exactly-one-terminal + no double-edit preserved). Absent ⇒ single attempt (backward-compatible). Lets a consumer (theocode) keep its per-continuation-round retry safety when it adopts `AgentRunner.stream()`. No new dependency (Rule 9).
