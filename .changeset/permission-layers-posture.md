---
'@theokit/agents': patch
---

Add `permissionRulesFromLayers` (deny first across settings files), a `toolAliases` option for `permissionRulesFromSettings`, and `approvalPostureFor`, which maps `untrusted`, `on-request` and `never` to an `ApprovalPosture`.

`approvalPostureFor` takes `interactive` as the surface's `emit` and `awaitApproval` callbacks rather than a boolean, because the `interactive` posture cannot exist without them; leaving it out means headless.
