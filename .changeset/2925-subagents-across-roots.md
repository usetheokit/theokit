---
'@theokit/agents': minor
---

`discoverSubagentsAcrossRoots` (`@theokit/agents/config`) returns the operator's `~/.theokit/agents/` merged with the project's `.theokit/agents/` as parsed definitions labelled `origin: 'operator' | 'project'`. The project root is read only under a `projectSettings` posture and wins a name clash; roots it did not read come back in `withheld`.
