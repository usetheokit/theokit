---
"theokit": patch
---

A Redis client from `getStorageManager().useRedis(...)` no longer exits the process on a socket error. node-redis re-emits a dropped connection as an `error` event, and Node exits on an `error` event with no listener, so one ECONNRESET took `theokit start` down. When the client the factory returns has no `error` listener, `useRedis` now attaches one that logs a structured warning (`component: "theokit:storage"`, the server name, the error code and message). A listener the factory attached is left as the only one. (#1029)
