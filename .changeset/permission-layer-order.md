---
'@theokit/agents': patch
---

The comment in `createPermissionsPlugin` states the engine's evaluation order: the first matching rule wins, so callers order rules deny-first with `permissionRulesFromLayers`.
