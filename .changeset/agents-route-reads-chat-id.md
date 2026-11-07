---
"@theokit/agents": patch
---

`generateAgentRoutes` chat route now reads the chat id `HttpTransport` sends as top-level `id` as the session id passed to `createRun`. `sessionId` still works and wins when both are sent; with neither, a session id is generated as before. (#1255)
