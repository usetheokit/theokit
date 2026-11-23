---
'@theokit/agents': minor
---

`@theokit/agents/foreign-setup` adds `readForeignSetup(kind, { home, cwd })`, which reads a Claude Code or Hermes setup as data: instructions, skills, MCP servers (in the `.mcp.json` shape) and hooks, plus an `untranslated` list of what could not be carried and why.
