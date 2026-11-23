---
'@theokit/agents': patch
---

`skill_read` in advertised mode checks a skill's required binaries on PATH itself when the installed SDK does not export `binaryOnPath`, instead of hiding every skill that needs one.
