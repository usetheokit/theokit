---
"theokit": patch
---

Declare `@theokit/sdk` as an **optional** `peerDependency` (`>=2.9.0`). Apps using the agent layer (`@theokit/agents`, which theokit depends on) need `@theokit/sdk >=2.9.0`; previously that requirement was only carried transitively via `@theokit/agents@0.8.0`'s peer. Now theokit signals it directly so consumers get a clear install-time message. Optional — apps that don't use the agent layer are unaffected (mirrors the `@theokit/ui` optional-peer pattern).
