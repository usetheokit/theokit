---
"@theokit/host": patch
---

`rehomeTranscripts` trims the slashes around `projectsDir` with a plain loop instead of a backtracking-prone regex; the result is unchanged.
