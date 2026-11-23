---
'@theokit/agents': patch
---

`AgentBuilder` gains `sendDefaults`, `modelFallback`, `sessionDir` and `thinking` methods, and `skills` accepts an SDK `SkillsSettings` object (or a resolver returning one). The adapter forwards all of them to `Agent.create`.
