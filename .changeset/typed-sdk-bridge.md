---
'@theokit/agents': minor
---

The bridge event flow is typed end to end: `translateSdkEvent`, `translateInteractionUpdate`, `createSdkAgentStream`, `realUsageDone`, the think-tag and tool-dialect stream transforms and the agent endpoint now produce `AgentStreamEvent` and need no casts. The `AgentStreamEvent` variants are type aliases, so they stay assignable to the looser `StreamEvent`. `SdkTurnHandle.stream()` returns the SDK's message union (`SdkTurnMessage`) instead of `AsyncIterable<unknown>`, and `DoneEvent` declares the optional `finishReason` the reflective loop already read.
