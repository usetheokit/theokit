---
'@theokit/agents': minor
---

`@theokit/agents/bridge` now exports `runAgentTurn`, which runs one cancellable streamed turn on an agent you hold and resolves with a typed outcome (`ok` with optional usage, or `turn_failed` / `turn_cancelled`), and `completeFromTurn`, which adapts it to the `complete` port of `createOpenAICompatibleRoutes`.
