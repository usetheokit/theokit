---
'@theokit/host': patch
---

`createStorageRegistry` reads the flat registry and `.tcb` archives of the earlier TheoClaw, accepts upper-case location names, and bounds a remote request with `timeoutMs` (60 s); `uploadDirectory` and `downloadDirectory` add the manifest-last HTTPS directory transfer.
