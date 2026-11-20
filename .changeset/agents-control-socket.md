---
'@theokit/agents': minor
---

Add `attachControlSocket` to `@theokit/agents/control`: it serves a session store over an authenticated WebSocket on an existing `node:http` server, with chat, interrupt and steer frames, a bounded frame size, and cancellation of a closed socket's turns. `ws` is an optional peer dependency, loaded only when it is called.
