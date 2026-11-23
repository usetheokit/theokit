---
'@theokit/host': patch
---

`rehomeTranscripts` trims the slashes of `projectsDir` without a regular expression; the result is the same for a path without a doubled slash.
