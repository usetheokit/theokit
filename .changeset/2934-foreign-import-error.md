---
'@theokit/agents': patch
---

`ForeignImportError` extends `TheokitAgentError` with a stable `code` and a declared `isRetryable` (only `locked` is retryable).
