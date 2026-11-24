---
'@theokit/agents': patch
---

`@theokit/agents/presets` exports `assistantAgentPreset`, `assistantAgentTools` and `assistantWorkerTools`: a chat assistant's tools (read, list, documents, web, todolist; the shell and writers only with host tools, no writer in `read-only`), its `minimal`/`messaging`/`coding`/`full` tiers as `Toolset` profiles, and every tool left out as an `OffTool` with its reason.
