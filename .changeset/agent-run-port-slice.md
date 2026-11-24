---
'@theokit/agents': patch
---

`agentRunPort` takes `ScheduledRunAgent`, the `send` and turn it uses, so an agent without `agentId` or `dispose` fits; `FakeAgent` streams and timeline events are typed as the bridge's `SdkMessage` and `SdkTimelineEvent`.
