---
"theokit": patch
---

`jobs: { backend }` in `theo.config.ts` now reaches route handlers: under `theokit start` and `theokit dev`, every file route gets `ctx.queue`, and `ctx.queue.enqueue(name, input)` hands the job to the configured backend when the response succeeds. The setting used to be parsed and then read by nothing, so `ctx.queue` was undefined and the template's `ctx.queue.enqueue(...)` threw. The schema now refuses a `jobs.backend` without `enqueue`, `dequeue`, `ack` and `nack` methods, and `theokit build` for a deploy target other than `node` lists `jobs.backend` among the settings that target does not apply, since a constructed backend cannot travel into a deployed function. (#1009)
