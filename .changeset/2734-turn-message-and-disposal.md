---
'@theokit/agents': minor
---

`runAgentTurn` and `delegationPortFromAgentFactory` accept a message with image parts (`AgentTurnMessage`), and an agent that has only `send` (`AgentTurnAgent`, `DelegationFactoryAgent`); the factory port disposes through `dispose()` or `Symbol.asyncDispose`. A run the SDK reports as cancelled now ends as `{ ok: true, cancelled: true }` instead of a `turn_cancelled` failure.
