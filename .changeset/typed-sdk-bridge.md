---
'@theokit/agents': minor
---

Add `toAgentStreamEvent` and `isAgentStreamEvent` to `@theokit/agents/bridge` to validate untrusted values as typed `AgentStreamEvent`s, plus `isThinking`, `isInputRequested`, `isMessageTimelineEvent` and `isDeltaTimelineEvent` narrowing helpers, so TheoClaw can consume the typed bridge contract without local declarations.
