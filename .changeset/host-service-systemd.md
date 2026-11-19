---
'@theokit/host': minor
---

Add `@theokit/host/service`: install an agent app as a systemd user service (`serviceBackend`, `systemdUnit`) with rollback of the previous unit on a failed start, and restart it through its supervisor (`isSupervised`, `restartSelf`, `restartSelfAsync`, `waitForPredecessor`, `RESTART_EXIT_CODE`).
