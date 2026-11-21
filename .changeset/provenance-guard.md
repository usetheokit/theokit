---
'@theokit/agents': minor
---

Add `createProvenanceGuard` to `@theokit/agents/bridge`: a plugin that blocks a tool call whose argument was copied from untrusted tool output (`web_fetch`, `web_search`, `mcp_*`) and that the person never said. State is per instance; create one per agent or session.
