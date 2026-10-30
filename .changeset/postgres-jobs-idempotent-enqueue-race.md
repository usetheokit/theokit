---
"theokit": patch
---

Concurrent `PostgresJobBackend.enqueue` calls with the same `idempotencyKey` all resolve to the one job instead of throwing. The key was checked with a SELECT before a plain INSERT, so racing callers both passed the check and the loser got a raw Postgres `23505` unique violation; through the queue client `enqueueWithId` rejected and the outbox logged a flush error for an enqueue that had worked. The INSERT now uses `ON CONFLICT DO NOTHING` and the loser reads the winner's id. `idempotency(key, ttlSeconds, name)` takes an optional job `name` and, given one, matches only that job type, as the `(name, idempotency_key)` unique index does; without it, two job types sharing a key could return each other's id. `InMemoryJobBackend` now also deduplicates on the job name and the key, as Postgres does, where it used to merge two job types that shared a key. (#1015)
