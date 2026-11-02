---
"theokit": patch
---

A `route()` handler's `ctx` is typed `RouteContext`, exported from `theokit/server/define`. It was `unknown`, so the documented `ctx.queue.enqueue(...)` failed with TS18046 and apps had to cast `ctx`. `RouteContext` is open to declaration merging: an app that sets `jobs.backend` declares `queue: import('theokit/server/jobs').QueueClient` on it once, and keys nobody declared read as `unknown`. `RouteConfig`'s default context type is `RouteContext` as well, and `callProcedure` hands the handler an empty context when the caller supplies none, as the HTTP path does. The `JobRegistry` JSDoc now shows the augmentation on `theokit/server/jobs`. (#1073, #1074)
