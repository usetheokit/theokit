---
'@theokit/agents': patch
---

Fix chronological event ordering in `AgentRunner.stream()` (#44). Tool and thinking events now stream through the SDK's real-time `onDelta` callback in true arrival order, interleaved with text — instead of all text first, then all tool cards (a regression from the 0.21.1 streaming work, where tool events were pulled from the post-completion `run.stream()` buffer). The merge queue is consumed concurrently with `send()` for real-time delivery, with per-category/per-callId dedup so the `run.stream()` fallback (for providers that don't drive `onDelta`) never double-emits and never drops a tool result reported only via the stream (e.g. a tool error). No public API change.
