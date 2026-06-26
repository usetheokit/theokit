---
"@theokit/agents": patch
---

V4-N.1: `createSdkAgentStream` now emits the SDK Run's REAL token usage on the `done` event.

It reads `run.wait()` after the stream and emits one `done` carrying the real `TokenUsage` (`inputTokens`/`outputTokens`/derived `totalTokens`) + `cost`, suppressing the stream's zero-usage `done`. This completes V4-N's split-usage story end-to-end: `DelegationResult.tokens`/`tokensInput`/`tokensOutput` now report real values on the real SDK path (previously hardcoded to 0). An error round skips the `wait()` re-emit (exactly-one-terminal); a `wait()` rejection surfaces as an `error` (fail-loud). Additive; reuses the SDK's documented `run.wait()` (Rule 9); no new dependency.
