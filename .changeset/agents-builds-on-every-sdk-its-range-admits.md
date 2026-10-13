---
'@theokit/agents': patch
---

`@theokit/agents` builds and type-checks against every `@theokit/sdk` its `^5.3.0` range admits again. The A2A client imported `ToolContext`, which the SDK root exports only from 5.8.0, so an install resolving 5.3 to 5.7 failed with `Module '"@theokit/sdk"' has no exported member 'ToolContext'`. It now declares the one field it reads, `signal` (#977)
