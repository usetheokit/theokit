---
'@theokit/agents': minor
---

Add `toAgentStreamEvent` and `isAgentStreamEvent` to `@theokit/agents/bridge` to validate untrusted values as typed `AgentStreamEvent`s, plus `isThinking`, `isInputRequested`, `isMessageTimelineEvent` and `isDeltaTimelineEvent` narrowing helpers, so TheoClaw can consume the typed bridge contract without local declarations.

`SdkTurnOutcome` now carries `cost` and `error.code`. `SdkTurnHandle` stays lenient, with `stream` and `cancel` optional, so wait-only handles keep compiling. The strict contract is `SdkRun` (required `stream`, `events`, `cancel`, and a `status` that is always set) and `SdkRunAgent` (an agent whose `send` resolves an `SdkRun`). A real SDK `Run` and `SDKAgent` are assignable to them.
