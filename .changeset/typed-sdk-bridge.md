---
'@theokit/agents': minor
---

`translateInteractionUpdate` returns `AgentStreamEvent[]`, and `translateSdkEvent` returns it for a message typed with the new `SdkMessageLike` (`{ readonly type: string }`, no index signature), so an `@theokit/sdk` `SDKMessage` passes without a cast. `SdkSendOptions` types `signal`, `onDelta` and `queueMode`, and `SdkTurnHandle` types `cancel`, `error.code`, `usage.inputTokens`, `usage.outputTokens` and `cost.amountUsd`, so an `@theokit/sdk` agent is assignable to `SdkAgentHandle`. To make that assignment hold, `SdkAgentHandle.generate` is now declared with method syntax and an `any`-valued option index, which loosens the type of its `options` parameter.
