---
"theokit": patch
---

`useDatabase(name, postgresql({ url }))` no longer exits the process when Postgres drops its connection. db0's Postgres connector opens one `pg.Client` with no `error` listener, so a restart, a failover or `pg_terminate_backend` took the process down. For a `postgresql` database `useDatabase` now opens the client and attaches a listener that logs a structured warning (`component: "theokit:storage"`, the database name, the Postgres error code). db0 keeps the closed client, so later queries on that database still fail until restart; use `usePostgres` for a pool that reconnects. (#1051)
