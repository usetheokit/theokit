---
'@theokit/agents': minor
---

`runAgentTurn` takes `secrets`: every string in an emitted event is masked, and text that could still grow into a secret is held back and released as an extra `text_delta` before the next other event or when the turn ends. `createAgentEventMask` is exported from `@theokit/agents/bridge` for callers that run their own turn.
