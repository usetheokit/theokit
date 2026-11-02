---
"theokit": minor
---

`ctx.queue.enqueueInTransaction(client, name, input, opts)` writes a job through `client`, a connection inside a transaction the caller opened, so the job commits or rolls back with the caller's own rows. `PostgresJobBackend.enqueueInTransaction(client, input)` is the backend form, and `JobBackend` gains it as an optional method. The per-request outbox hands jobs over after the response on another connection, so a route could commit a row and lose its job; with this, a committed row always has its job. A backend without the method rejects with `TransactionalEnqueueUnsupportedError` (`code: "TRANSACTIONAL_ENQUEUE_UNSUPPORTED"`). (#1077)
