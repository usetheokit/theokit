---
'@theokit/agents': patch
---

`classifyTurnFailure` also reads a numeric `status` or `statusCode` on the error and its causes, so a provider error with a top-level status 503 or 429 is transient.
