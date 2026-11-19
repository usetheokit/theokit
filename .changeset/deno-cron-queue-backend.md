---
'theokit': patch
---

The generated Deno cron entry now imports `theokit/server/jobs` through an `npm:` specifier and loads the `jobs.backend` of `theo.config.ts`, including a `theo.config.<NODE_ENV>.ts` override, so `ctx.queue` works in Deno crons.
