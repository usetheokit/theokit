---
'@theokit/agents': minor
---

`RefreshFailure` now extends `TheokitAgentError` (code `oauth_refresh_failed`, `isRetryable` mirrors `.transient`, `cause` is the original error), so `isTransientError` works on a refresh failure. It is exported from `@theokit/agents/auth`.
