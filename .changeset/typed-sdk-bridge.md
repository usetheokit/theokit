---
'@theokit/agents': minor
---

`translateInteractionUpdate` returns `AgentStreamEvent[]`, and `translateSdkEvent` returns it for a message typed with the new `SdkMessageLike` (`{ readonly type: string }`, no index signature), so an `@theokit/sdk` `SDKMessage` passes without a cast. `SdkSendOptions` types `signal`, `onDelta` and `queueMode`, and `SdkTurnHandle` types `cancel`, `usage.inputTokens`, `usage.outputTokens` and `cost.amountUsd`, so an `@theokit/sdk` agent is assignable to `SdkAgentHandle`. To make that assignment hold, `SdkAgentHandle.generate` is now declared with method syntax and an `any`-valued option index, which loosens the type of its `options` parameter.

Known limit: `ReturnType<typeof translateSdkEvent>` is still the open `StreamEvent[]`, and a message typed with the index-signature `SdkMessage` still gets `StreamEvent[]`, not `AgentStreamEvent[]`, so existing callers and tests compile unchanged. Only an `SdkMessageLike` input gets the typed union. `SdkTurnHandle.stream` is `stream?(): AsyncIterable<any>`: its elements feed `translateSdkEvent` without a cast, and a handle that merely drains the stream still compiles. The resolved `wait()` error stays `{ message: string }`.
