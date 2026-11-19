---
'theokit': patch
---

The generated Deno cron entry imports the jobs runtime through an `npm:` specifier and gives each handler `ctx.queue`, wired to the `jobs.backend` of the effective config (base `theo.config.ts` plus the `theo.config.<NODE_ENV>.ts` override). Jobs a handler enqueues flush after it succeeds, are discarded when it throws, and carry the run's trace. Packages a config reaches through a literal `import("pkg")` are mapped too, and an environment override is ignored when `theo.config.ts` is absent, as `loadConfig` does.
