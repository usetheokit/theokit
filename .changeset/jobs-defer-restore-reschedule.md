---
'theokit': minor
---

`PostgresJobBackend` has `defer`, `restore` and `reschedule` to hold, release and bring forward pending jobs in the caller's transaction, skipping leased jobs.

`defer` and `reschedule` clear an expired lease on the jobs they move, so a late `ack` or `nack` cannot overwrite the new time. `reschedule` takes `ahead: { name, where }` to place a job one second before the earliest of the other pending jobs. It locks those jobs (skipping leased ones) in the caller's transaction, then updates the job, so a dequeue in between cannot lease them.
