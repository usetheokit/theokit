---
"theokit": minor
---

Crons fire once per tick across replicas when the processes share a lock. `theokit start` used to schedule every cron in every process, so two replicas ran each tick twice. The new `cron.lock` config takes a `CronLock`, and `createPostgresCronLock(pool)` from `theokit/server/cron` provides one backed by a `theokit_cron_runs` table. When `jobs.backend` is a `PostgresJobBackend` and `cron.lock` is unset, `start` uses a lock on the backend's pool; `cron.lock: false` opts out. A tick whose lock cannot be acquired is skipped and logged instead of firing unguarded. A single process without a shared backend behaves as before, and the boot log now says whether the crons are guarded. (#1016)
