---
"theokit": minor
---

A worker whose job lease expired can no longer ack or nack the job after another worker leased it again. `ack` and `nack` filtered on the job id alone, so a slow handler that outlived `lockSeconds` deleted the job when it acked while the second worker was still running it, and the second worker's outcome was lost. Every `JobLease` from `PostgresJobBackend` and `InMemoryJobBackend` now carries a `leaseToken`; `ack(jobId, { leaseToken })` and `nack(jobId, { error, leaseToken })` reject with the new `JobLeaseLostError` (exported from `theokit/server/jobs`, code `JOB_LEASE_LOST`) and leave the job alone when that lease no longer holds it. `createJobRunner` passes the token and logs a lost lease as a structured warning instead of failing the tick. A call without a token behaves as before. `PostgresJobBackend.migrate()` adds the `lease_token` column to a table created by an earlier version. (#1012)
