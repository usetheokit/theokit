---
'@theokit/agents': major
---

`listSessions` in `@theokit/agents/session` is now the SDK listing sorted newest first, and the hand-written first-line id reader is gone. A transcript whose first line is malformed but whose second record carries a `sessionId` is now identified, and a directory named like a transcript is not listed. The listing is async, so `listSessions`, `protectedTranscriptPaths`, `forkBeforeUserTurn` and `planTranscriptGC` now return Promises. `SessionSummary` is now the SDK's `SessionListing`.
