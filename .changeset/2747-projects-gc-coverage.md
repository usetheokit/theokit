---
'@theokit/agents': minor
---

`planProjectsGC` takes `cwdCoverage: 'transcripts'` (plan a live project from the cwds its transcript headers record, without a declared cwd list) and `pointerPath` (the caller's resumable-pointer location, also read by `runProjectsGC`). `claimCollectorRoot`, `collectorRootOwner` and `runProjectsGC` accept an `existingMarker` format so a marker written under another file name and schema counts as the owner's claim.
