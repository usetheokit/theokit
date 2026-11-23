---
'@theokit/host': patch
---

`@theokit/host` exports `teeOutput` from its root: it mirrors stdout and stderr to a bounded file and returns an uninstall function.
