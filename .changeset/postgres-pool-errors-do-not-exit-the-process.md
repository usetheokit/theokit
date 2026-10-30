---
"theokit": patch
---

A Postgres pool from `getStorageManager().usePostgres(...)` no longer exits the process when Postgres drops an idle connection. `pg.Pool` emits `error` for an idle client the server disconnects (a restart, a failover, `pg_terminate_backend`, a proxy's idle timeout), and Node exits on an `error` event with no listener, so one terminated connection took `theokit start` down with every request in flight. When the pool the factory returns has no `error` listener, `usePostgres` now attaches one that logs a structured warning (`component: "theokit:storage"`, the database name, the Postgres error code and message), and the next query opens a new connection. A listener the factory attached is left as the only one. The `theokit` README documents the factory pattern. (#1019)
