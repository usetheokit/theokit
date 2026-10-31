---
"theokit": patch
---

A `pg.Pool` passed to `new PostgresJobBackend({ pool })` or `createPostgresCronLock(pool)` no longer exits the process when Postgres drops one of its idle connections. Neither attached an `error` listener, so with the job worker polling the pool since 0.76.0 a Postgres restart, a failover or `pg_terminate_backend` took `theokit start` down. When the pool has no `error` listener, both now attach one that logs a structured warning (`component: "theokit:jobs"` or `"theokit:cron"`, the table, the Postgres error code), and the next query reconnects. A listener you attached first stays the only one. (#1037)
