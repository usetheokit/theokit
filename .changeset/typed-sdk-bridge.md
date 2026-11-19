---
'@theokit/agents': minor
---

`translateSdkEvent` and `translateInteractionUpdate` return `AgentStreamEvent[]`, and `translateSdkEvent` takes the new `SdkMessageLike` (`{ readonly type: string }`, no index signature), so an `@theokit/sdk` `SDKMessage` passes without a cast. `SdkSendOptions` types `signal`, `onDelta` and `queueMode`, and `SdkTurnHandle` types `cancel`, `usage.inputTokens`, `usage.outputTokens`, `cost.amountUsd` and `error.code`, so an `@theokit/sdk` agent is assignable to `SdkAgentHandle`.
