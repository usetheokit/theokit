---
"theokit": patch
---

`theokit dev` applies the `storage` block of `theo.config.ts`, as `theokit start` already did. In development every `getStorageManager().usePostgres('main', ...)` threw `Database "main" not configured`, so a Postgres-backed route could only be run after a production build. (#1020)
