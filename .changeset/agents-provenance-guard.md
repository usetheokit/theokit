---
'@theokit/agents': minor
---

Add `createProvenanceGuard` to `@theokit/agents/bridge`: a plugin that blocks a tool call whose argument is a value copied from untrusted tool output (`web_fetch`, `web_search`, `mcp_*`) unless the person also wrote it. State is per instance, so create one guard per agent or session.
