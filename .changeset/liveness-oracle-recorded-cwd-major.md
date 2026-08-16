---
"@theokit/agents": major
---

BREAKING: `classifyProjects` (`@theokit/agents/session`) — `listProjects` renamed to `candidatePaths`, `projectsRoot` now required, and `FsSeam` gained `listEntries` + `firstLine`.

Fixes a defect where live projects were classified `dead` on the path where the caller deletes. Measured against a real `~/.theokit/projects`: 6 of 6 existing project directories came back `dead`.

The module had absorbed the consumer's *fallback* (search a caller-supplied pool) and dropped its *answer*: a transcript records the `cwd` it was written in, and reading that first line resolves the project with no search — the path the consumer measured resolving 91 of 120 sampled projects. A `dead` verdict now requires positive evidence of absence — a recorded `cwd` that is not on disk. Every other outcome is `undetermined`, because the caller deletes and the fail-safe direction is not symmetric.

The rename is part of the fix, not tidying: `listProjects` named two different contracts across the seam — encoded directory names on the consumer side, real absolute paths here — and wiring one to the other is what produced the 6-of-6.

Migration: rename the option to `candidatePaths` (it returns real absolute paths), pass `projectsRoot` (use the exported `projectsRoot()` rather than joining the segment by hand), and add `listEntries`/`firstLine` to your `fs` seam.
