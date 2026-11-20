---
'@theokit/agents': minor
---

Added `planProjectsGC` to `@theokit/agents/session`: a read-only plan for reclaiming disk across every project (old transcripts, orphaned locks, interrupted temp files, registry entries whose transcript is gone), with the same retention floors and protections as `planTranscriptGC`.
