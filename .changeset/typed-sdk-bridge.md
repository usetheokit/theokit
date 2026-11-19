---
'@theokit/agents': minor
---

`translateInteractionUpdate` returns `AgentStreamEvent[]`, and `translateSdkEvent` returns it for a message typed with the new `SdkMessageLike` (`{ readonly type: string }`, no index signature), so an `@theokit/sdk` `SDKMessage` passes without a cast. `SdkSendOptions` types `signal`, `onDelta` and `queueMode`, and `SdkTurnHandle` types `cancel`, `error.code`, `usage.inputTokens`, `usage.outputTokens` and `cost.amountUsd`, so an `@theokit/sdk` agent is assignable to `SdkAgentHandle`. To make that assignment hold, `SdkAgentHandle.generate` is now declared with method syntax and an `any`-valued option index, which loosens the type of its `options` parameter.

`ReturnType<typeof translateSdkEvent>` is still the open `StreamEvent[]`: a message typed with the index-signature `SdkMessage` keeps resolving to it, so existing consumers that derive a type from it compile unchanged. `SdkTurnHandle.stream` is now typed `stream?(): AsyncIterable<SdkMessageLike>`, so its messages feed `translateSdkEvent` without a cast. An existing handle whose stream yields other values needs a cast to `SdkAgentHandle`.
