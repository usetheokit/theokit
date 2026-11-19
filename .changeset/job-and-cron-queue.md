---
'theokit': patch
---

`JobContext` and `CronContext` now have `queue`, so a job or cron handler can enqueue jobs. Jobs buffered with `ctx.queue.enqueue` go out after the handler returns and are dropped if it throws; `enqueueInTransaction` writes through your own transaction. A cron without `jobs.backend` gets a `queue` whose calls reject.

The generated Deno cron entry loads the `jobs.backend` of `theo.config.ts` (and the `theo.config.<NODE_ENV>.ts` override selected at run time), so `ctx.queue` works in Deno crons.
