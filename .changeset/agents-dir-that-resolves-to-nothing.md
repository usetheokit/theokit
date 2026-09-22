---
'theokit': patch
---

A configured `agentsDir` that resolves to nothing now says so instead of finding zero agents in
silence. The result was byte-identical to "this app declares no agents" — `[]`, and no output — so
a deployed `/api/agents/<name>` answered 404 with an empty server log and an operator had no reason
to suspect configuration rather than the agent file.

The value is a path relative to the project root, so an absolute one is joined onto it and cannot
resolve; that is the loudest way in, and the warning names it. A typo, a missing nesting level and
a directory a build did not copy reach the same branch and get the same line.

A project that configures nothing stays silent — having no agents is the ordinary case, and a
warning that fires on ordinary work is a warning people learn to ignore. The report is emitted at
most once per resolved path, because the scan runs per request on a scanned deploy target.
