---
'@theokit/http': patch
---

The `AgentRuntime.generateAgentRoutes` input type declares `compiledOptions` optional, matching `@theokit/agents`, which never reads it.
