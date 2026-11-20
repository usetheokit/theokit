---
'theokit': patch
---

`startTestServer` now accepts a server as ready only when this attempt's child answers (a per-attempt token), binds the requested dev port strictly, reports bind conflicts as port substitution so they retry, and on Windows terminates and confirms the whole process tree in `close()`.
