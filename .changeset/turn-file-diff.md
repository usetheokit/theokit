---
'@theokit/agents': patch
---

`@theokit/agents/presets` exports `changedPathsOf`, which lists the files a turn's write tool calls named (including `apply_patch` headers), and `turnDiff`, which prints the git diff of those paths, new files included.
