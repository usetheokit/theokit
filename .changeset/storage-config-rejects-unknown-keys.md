---
"theokit": minor
---

**Behavior change:** an unknown key under `storage` in `theo.config.ts` now fails config loading with an `unrecognized_keys` error naming the key. It used to be dropped without a word, so a typo such as `databasees`, or a `postgres: [{ url }]` block, left the app with no storage and the first `usePostgres` failed with `Database "main" not configured`. (#1023)
