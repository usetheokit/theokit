---
'@theokit/agents': patch
---

`forkBeforeUserTurn` now throws `LiveTranscriptError` when the destination is a protected session, instead of a raw `EEXIST`.
