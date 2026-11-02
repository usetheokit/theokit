---
"theokit": patch
---

`theokit start` and `theokit dev` call `migrate()` on the configured `jobs.backend` once at boot, before serving a request or starting the worker. A `PostgresJobBackend` set up as the README shows now creates its `theokit_jobs` table by itself; before, the worker logged `relation "theokit_jobs" does not exist` on every tick and each enqueued job was dropped after the route answered 2xx. If `migrate()` rejects, the boot fails with `JOB_BACKEND_SETUP_FAILED` and names the cause. Remove any `await backend.migrate()` from `theo.config.ts`: `theokit build` loads that file too and needed a database because of it. `migrate()` also retries when another replica creates the table at the same moment. (#1072)
