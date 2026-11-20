---
'@theokit/agents': minor
---

`@theokit/agents/control` gains `createControlClient({ url, authorization })`, a typed client for `attachControlSocket`: `chat(message, session)` yields that turn's frames until `done`, `interrupted` or `error`, and `interrupt`, `steer` and `close` complete it. A non-`ws://` address, a refused upgrade (named by HTTP status) and a closed connection (a 1009 close names the frame limit) reject with the new `ControlConnectionError`, whose message never contains the credential.
