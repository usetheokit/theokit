---
'@theokit/agents': minor
---

`planTranscriptGC` names each transcript by its real file (the current or the legacy name of a known id, `knownIds`), so a fork is no longer named as its source. Protection also covers the legacy file name, and `isProtected` accepts a predicate, asked at planning and again at apply, as well as the `protectedIds` list.

Without `knownIds`, a transcript is named only by the id inside it when its file is named for that id (current or legacy name). A fork whose rows name its source, found under another file name, now has `id: undefined` instead of its source's id: a dry run lists it under `orphaned`, and removal skips the registry rather than removing the source's entry.
