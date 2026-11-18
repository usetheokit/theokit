---
'theokit': minor
---

Breaking: remove the test-only reset helpers from every published entry. They stay in their source modules for this repository's tests.

- `theokit/server`: `_resetMiddlewareCacheForTests`, `_resetUninvocableWarningsForTests`, `_resetRouteScanCacheForTests`, `_resetKeyCacheForTests`, `_resetWarnOnceForTests`, `_resetCacheEngine`, `_resetEnvCache`
- `theokit/server/auth`: `_resetKeyCacheForTests`
- `theokit/server/http`: `_resetMiddlewareCacheForTests`, `_resetUninvocableWarningsForTests`
- `theokit/server/observability`: `_resetWarnOnceForTests`
- `theokit/server/scan`: `_resetRouteScanCacheForTests`
