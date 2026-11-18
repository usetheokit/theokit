---
'@theokit/presenter': minor
'@theokit/agents': patch
---

`@theokit/presenter` now exports `pendingApprovals`, `readPendingApproval` and `PendingApproval`, the one projection of outstanding approvals off the wire thread. `@theokit/agents` imports it instead of keeping a private copy; `PendingApproval` is still exported from `@theokit/agents/client`.
