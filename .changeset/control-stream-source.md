---
'@theokit/agents': minor
---

`@theokit/agents/control` adds `createControlStreamSource(client, session, message, options)`: it turns a control client's frames for one turn into a source for a TUI's `useAgentStream`, with session-bound `interrupt()` and `steer(message)`.
