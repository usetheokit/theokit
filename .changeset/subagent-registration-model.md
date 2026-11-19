---
'@theokit/agents': minor
---

`.subagents()` now accepts `model` (a `ModelSelection` or `'inherit'`) and `mcpServers` on a registered subagent, so a discovered definition keeps the model and MCP servers its file declared instead of running on the parent's model.
