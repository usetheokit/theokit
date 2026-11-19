---
'@theokit/agents': minor
---

Add `createApprovalGate` and `createJsonlLedger` to `@theokit/agents/auth`: a decision chain before a risky tool runs (session waiver, saved approval in `PermissionStore`, optional reviewer, then the person with a timeout that denies) and an append-only receipt ledger. Every failure is reported through `onError(error, stage)`.
