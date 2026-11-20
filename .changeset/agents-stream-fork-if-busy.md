---
'@theokit/agents': minor
---

Added `streamTurnForkingIfBusy` and `ForkedSessionBusyError` to `@theokit/agents/session`: re-run a turn once under a fork id when the session is busy, detecting the `session_busy` code from the `data-error-code` part.
