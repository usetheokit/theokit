---
'@theokit/agents': minor
---

Add `toAgentStreamEvent` and `isAgentStreamEvent` to `@theokit/agents/bridge` to validate untrusted values as typed `AgentStreamEvent`s, plus `isThinking`, `isInputRequested`, `isMessageTimelineEvent` and `isDeltaTimelineEvent` narrowing helpers, so TheoClaw can consume the typed bridge contract without local declarations.

`SdkTurnOutcome` now carries `cost` and `error.code`. `SdkTurnHandle` stays lenient, with `stream` and `cancel` optional, so wait-only handles keep compiling. The strict contract is `SdkRun` (required `stream`, `events`, `cancel`, and a `status` that is always set) and `SdkRunAgent` (an agent whose `send` resolves an `SdkRun`). A real SDK `Run` and `SDKAgent` are assignable to them.

`translateInteractionUpdate` returns `AgentStreamEvent[]`, and `translateSdkEvent` returns it for a message typed with the new `SdkMessageLike` (`{ readonly type: string }`, no index signature), so an `@theokit/sdk` `SDKMessage` passes without a cast. `SdkSendOptions` types `signal`, `onDelta` and `queueMode`, and `SdkTurnHandle` types `cancel`, `usage.inputTokens`, `usage.outputTokens` and `cost.amountUsd`, so an `@theokit/sdk` agent is assignable to `SdkAgentHandle`.

Known limit: `ReturnType<typeof translateSdkEvent>` is still the open `StreamEvent[]`, and a message typed with the index-signature `SdkMessage` still gets `StreamEvent[]`, not `AgentStreamEvent[]`, so existing callers and tests compile unchanged. Only an `SdkMessageLike` input gets the typed union. `SdkTurnHandle.stream` is `() => AsyncIterable<SdkMessageLike>`: its elements feed `translateSdkEvent` without a cast, and a handle that merely drains the stream still compiles.
