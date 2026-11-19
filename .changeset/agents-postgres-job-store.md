---
'@theokit/agents': minor
---

Add `createPostgresJobStore` and `copyJobs` to `@theokit/agents/tools`: a PostgreSQL-backed scheduler `JobStore` over any pool with `query` (a `pg` `Pool` works), and a routine that copies jobs between stores, refusing a non-empty target unless `force`. Exports the `SqlPool` and `JobCopyError` types.
