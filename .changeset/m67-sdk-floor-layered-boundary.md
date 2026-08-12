---
'@theokit/agents': minor
'theokit': minor
'@theokit/presenter': minor
---

M67 — the config/trust/wiring family crosses the layered boundary, and the `@theokit/sdk` floor rises
to `^4.49.0` to make that possible.

**Installation-contract change.** `theokit` and `@theokit/presenter` publish `@theokit/sdk` as a
`peerDependency`; raising the floor means a consumer pinned below 4.49.0 will now fail peer
resolution. Sized as a minor rather than a major because the change is additive at the API level —
nothing is removed or renamed — but the peer floor is a real break at install time and is called out
explicitly here rather than left for the consumer to discover.

Six values (`foldLayers`, `verifyLayerOrdering`, `applySecurityFloor`, `resolveTrustPosture`,
`auditEnvReachability`, `recordWiring`) and two types (`WiredEntity`, `ToolResultContentBlock`) now
cross `@theokit/agents`. Four more arrived with the floor: `classifySessionArtifact` +
`SessionArtifact`, `atomicWriteTempTarget`, `writableRootsFor`, `assertSecureModes`.
