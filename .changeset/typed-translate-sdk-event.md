---
'@theokit/agents': minor
---

`translateInteractionUpdate` returns `AgentStreamEvent[]`, and `translateSdkEvent` returns it for a message typed with the new `SdkMessageLike` (`{ readonly type: string }`, no index signature), so an `@theokit/sdk` `SDKMessage` passes without a cast. A message typed with the index-signature `SdkMessage` still gets `StreamEvent[]`, so existing callers compile unchanged. `SdkTurnHandle.stream` is `() => AsyncIterable<SdkMessageLike>`, so its messages feed `translateSdkEvent` without a cast.
