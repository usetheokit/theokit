---
'@theokit/agents': patch
---

`@theokit/agents` now declares `@theokit/sdk` `^5.8.0`, the first version whose root exports `ToolContext`, which the A2A client imports. The `^5.3.0` it declared let a package manager resolve 5.3 to 5.7, where building or type-checking `@theokit/agents` fails with `Module '"@theokit/sdk"' has no exported member 'ToolContext'` (#977)
