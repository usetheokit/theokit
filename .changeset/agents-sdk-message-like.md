---
'@theokit/agents': minor
---

`translateSdkEvent` takes any message with a `type` (new `SdkMessageLike`), so the SDK's own message types need no cast; `SdkTimelineEvent.update` is the SDK's `InteractionUpdate`; `toAgentStreamEvent` narrows a framework `StreamEvent` to `AgentStreamEvent`.
