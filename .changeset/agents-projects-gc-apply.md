---
'@theokit/agents': minor
---

`@theokit/agents/session` gains `runProjectsGC`, which applies a `planProjectsGC` plan (dry run unless `apply: true`, protection re-checked before each removal, registered transcripts removed through the registry), and `claimCollectorRoot` / `collectorRootOwner`, a marker that says which app owns a `projects/` root. Applying to a root another app owns throws `CollectorRootNotOwnedError`; a marker that cannot be read or written throws `CollectorRootError`.
