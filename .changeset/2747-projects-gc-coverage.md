---
'@theokit/agents': minor
---

`planProjectsGC` takes `cwdCoverage: 'transcripts'` (plan a live project from the cwds its transcript headers record, without a declared cwd list), `deadProjects: 'keep-last'` (a dead project gets retention alone). `claimCollectorRoot`, `collectorRootOwner` and `runProjectsGC` accept an `existingMarker` format so a marker written under another file name and schema counts as the owner's claim.
