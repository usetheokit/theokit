---
'theokit': patch
---

Deno Deploy: map literal dynamic `import('pkg')` specifiers reachable from the cron entry configs, and skip the `theo.config.<NODE_ENV>.ts` override when `theo.config.ts` is absent, as `loadConfig` does.
