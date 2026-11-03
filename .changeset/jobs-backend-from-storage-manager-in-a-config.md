---
'theokit': patch
---

`PostgresJobBackend.fromStorageManager` can be called in `theo.config.ts`, where `jobs.backend` is declared. The framework applies the config's `storage` block only after the module has been evaluated, so the call resolved the pool too early and the config failed to load with `Database "main" not configured`. When the manager has no configuration yet, the pool is now resolved on the first query, which `theokit start` and `theokit dev` make when they create the table at boot, and the same errors surface there. A configured manager still resolves it at once. `StorageManager` gains `isConfigured()` (#1133).
