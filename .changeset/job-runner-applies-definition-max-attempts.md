---
"theokit": patch
---

A job declared with `defineJob(name, { maxAttempts })` is retried up to that many times when it was enqueued through the queue client (`ctx.queue` or `createQueueClient`). The client has no access to the job definitions, so the job was stored with the backend default of one attempt and its first failure was final, with no warning. `createJobRunner` now passes the definition's `maxAttempts` to `nack`, which takes precedence over the stored value; the new `JobNackOptions` type (exported from `theokit/server/jobs`) documents the field. (#1013)
