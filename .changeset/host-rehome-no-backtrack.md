---
"@theokit/host": patch
---

`rehomeTranscripts` trims the slashes of `projectsDir` without a backtracking regular expression; the result is unchanged.
