---
'@theokit/agents': minor
---

`projectsRoot(root?)` — one owner for where every project's transcripts live.

`join(root, 'projects', …)` was written in three places: twice inside `project-index.ts`, and once in
the closest consumer, which restated it as `join(transcriptRoot(), 'projects')` to enumerate every
project for a GC sweep.

The failure mode is what makes it worth a function rather than a comment. That consumer guards its
enumeration with `existsSync(root) ? readdir(root) : []`, so a segment that stops matching does not
throw — it returns an empty list. The sweep then finds nothing, deletes nothing, and reports success.
A wrong path that throws is a bug report; a wrong path that returns nothing is a collector that
quietly stopped collecting.
