---
"theokit": minor
---

`GET /__theo/ready` answers 503 when the app's dependencies are down. Under `theokit start` and `theokit dev` it pings the configured `jobs.backend` when the backend has `ping()` (`PostgresJobBackend` runs `SELECT 1`; `JobBackend` gains `ping` as an optional method) and calls the `ready` probe an app declares in `theo.config.ts`, a function resolving to a boolean. Before, `start` registered only the liveness route, so readiness answered 200 with Postgres stopped and nothing could register a probe. `theokit dev` now serves `/__theo/health` and `/__theo/ready` too; both used to return the SPA's HTML. (#1071)
