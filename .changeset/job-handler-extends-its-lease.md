---
'theokit': minor
---

A job handler can extend its lease with `ctx.extendLease(seconds)`. `lockSeconds` is one value for the whole worker, so a job that may run for 30 minutes forced a one-hour lock on every job, and a worker that crashed left its job unavailable for that hour. A handler that is still making progress now keeps the job, and the deadline of `ctx.signal` moves with the lease. The call rejects with `JobLeaseLostError` (and aborts the signal) when another worker holds the job. `JobBackend` gains an optional `extendLease`, implemented by `PostgresJobBackend` (fenced by the lease token, on the database clock) and `InMemoryJobBackend`; without it the call rejects with `JobLeaseExtensionUnsupportedError` (#1132).
