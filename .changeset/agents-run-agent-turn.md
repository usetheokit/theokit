---
'@theokit/agents': minor
---

Added `runAgentTurn` and `completeFromTurn` to `@theokit/agents/bridge`: one cancellable, streamed turn on an agent you already hold, with a typed `AgentTurnOutcome` (a streamed `error` fails the turn, usage is attached, no duplicate final text) and an adapter for the `complete` port of `createOpenAICompatibleRoutes`.
