---
'theokit': minor
---

`PostgresJobBackend` has `defer`, `restore` and `reschedule` to hold, release and bring forward pending jobs in the caller's transaction, skipping leased jobs.
