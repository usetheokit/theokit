---
'@theokit/host': patch
---

Add `backend.logs(label, { lines })` to the service backends (the journal on systemd, the log file on launchd and Task Scheduler) and `teeOutput` for a bounded, rotating 0600 output file.
