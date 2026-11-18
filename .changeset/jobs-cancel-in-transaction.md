---
'theokit': minor
---

Add an optional `JobBackend.cancelInTransaction(client, { name, idempotencyKey })` and `ctx.queue.cancelInTransaction`. They remove a queued job inside the caller's transaction while no worker ever leased it, and answer whether one was removed. `PostgresJobBackend` implements it.
