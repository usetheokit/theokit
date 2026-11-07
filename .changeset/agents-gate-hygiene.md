---
"@theokit/agents": patch
---

Internal only, no API change: the scheduled-run preamble constant is no longer exported from its internal module (no public entry re-exported it), and the code-mode source comments stop citing ADR-0041 and ADR-0049, which were never written. (#1101, #1102)
