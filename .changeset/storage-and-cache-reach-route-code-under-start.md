---
"theokit": patch
---

The `storage` and `cache` blocks of `theo.config.ts` reach route code under `theokit start`. The CLI build and the library build each carried their own copy of the storage manager and the cache engine, so `start` configured one copy and routes read the other: `getStorageManager().usePostgres('main', ...)` threw `Database "main" not configured` and `revalidateTag` threw `Cache engine not initialized` with `cache.enabled: true`. Both are now held once per process, whatever chunk a caller imports them from. (#1018)
