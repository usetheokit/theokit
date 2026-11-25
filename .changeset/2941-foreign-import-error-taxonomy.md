---
"@theokit/agents": patch
---

`ForeignImportError` extends `TheokitAgentError` with a stable `code` and `isRetryable: false`, so `isTransientError` sees it.
