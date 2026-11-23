---
'@theokit/agents': patch
---

`ToolScope.bind` passes the sandbox to a factory as a provider function and accepts factories whose options come from another installed copy of `@theokit/sdk`. A backend built by one SDK copy was called as a provider by the other (`provider is not a function`), and such factories failed to type-check.
