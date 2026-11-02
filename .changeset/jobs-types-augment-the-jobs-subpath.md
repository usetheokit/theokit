---
"create-theokit": patch
---

The scaffold's `types/jobs.d.ts` augments `JobRegistry` on `theokit/server/jobs`, the module `QueueClient` comes from. It augmented the deprecated `theokit/server`, which reaches `QueueClient` only when another file imports that umbrella, so in an app that imports only subpaths every typed enqueue failed with "not assignable to type 'never'". The file also carries a commented block that types `ctx.queue` on `RouteContext`, to uncomment once `theo.config.ts` sets `jobs.backend`. (#1074)
