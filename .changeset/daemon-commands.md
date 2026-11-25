---
'@theokit/host': patch
'create-theokit': patch
---

`@theokit/host/service` exports `daemonCommands` (install, uninstall, status, restart and logs over a `ServiceBackend`, with the Linux linger notice and exit code 3 for a service that is not running) and `lingerEnabled`. On Windows `install` moves the target's `env` into the task's arguments through `entryArgs`. The `--preset=daemon` scaffold uses them, so `daemon install` no longer fails on Windows when its config variable is set, and it gains `daemon restart` and `daemon logs`.
