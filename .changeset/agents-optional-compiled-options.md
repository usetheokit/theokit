---
'@theokit/agents': minor
---

`generateAgentRoutes` no longer requires `compiledOptions` in its context. The generator never read it, so an agent built outside the decorator compiler can mount its chat route without inventing one.
