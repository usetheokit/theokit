---
'@theokit/agents': minor
---

Step-cap force-close: the reflective loop now gates tools OFF on the ceiling round (`round === maxIterations`), forcing the model to emit the closing summary the existing `STEP_LIMIT_HINT` requests instead of spinning on more tool calls. The round factory is called with `disableTools: true`, which the SDK adapter maps to `agent.send(msg, { toolChoice: "none" })` — applied per-send because a cached `getOrCreate` agent's tools cannot be un-registered. Below the ceiling, tools stay enabled; injected stream factories (tests / custom transport) ignore the optional flag (backward-compatible). Mirrors opencode's `MAX_STEPS_PROMPT` + `toolChoice:"none"`. Requires `@theokit/sdk` with `SendOptions.toolChoice`.
