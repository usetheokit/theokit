---
'@theokit/agents': patch
---

`protectedTranscriptPaths` no longer reads an unreadable `last-session` pointer as "no pointer": only `ENOENT` does, and any other read failure throws the new `SessionPointerUnreadableError`, so `deleteSession`, `forkSession` and the GC refuse instead of possibly removing the pointed session.
