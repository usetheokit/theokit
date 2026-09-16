---
"@theokit/agents": minor
---

`loadPersonalMcpServers` — MCP servers an operator registered for themselves, in `~/.claude.json`,
are now read alongside the project-scope servers from `.mcp.json`.

The surface table recorded this as measuring zero and therefore not worth closing. Re-measured
2026-09-15 on the machine the original number came from: the file carried 2 personal-scope servers.
A measurement that justifies inaction has to stay current, and that one had expired — the gap costs
an operator the servers they registered for themselves.

Never throws: `~/.claude.json` is shared with another tool that writes it, so an unreadable or
surprising file yields no servers rather than failing the run that merely wanted to read them.
