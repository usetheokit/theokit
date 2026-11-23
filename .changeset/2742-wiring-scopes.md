---
'@theokit/agents': minor
---

Re-export `offCapabilities` and the `WiredEntityScope`, `WiringOffReason` and `OffCapability` types from `@theokit/sdk` 13, so a consumer can read each wired entity's scope and why a capability is off.

Add `recordScopedWiring` (and its `ScopedWiringGroup` and `ScopedWiringCapability` types) to the bridge and root barrels: it records a capability whose entities come from several scopes, gating the project's share by trust and not the operator's own, and keeps one entity row per name and scope.
