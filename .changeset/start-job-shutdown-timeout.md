---
"theokit": minor
---

`jobs.worker.shutdownTimeoutMs` sets how long `theokit start` waits on `SIGTERM` for the job in progress to finish before it closes storage and exits. It was fixed at 20 seconds, so a restart cut any longer job. The default stays 20 seconds. (#1292)
