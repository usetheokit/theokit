---
'@theokit/agents': patch
---

The scheduled-job store now writes its file with the SDK's `atomicWriteJson` instead of a hand-written temp, chmod and rename.
