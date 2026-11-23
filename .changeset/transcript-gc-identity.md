---
'@theokit/agents': minor
---

`planTranscriptGC` names each transcript by its real file (the current or the legacy name of a known id, `knownIds`), so a fork is no longer named as its source. Protection also covers the legacy file name, and `isProtected` accepts a predicate, asked at planning and again at apply, as well as the `protectedIds` list.
