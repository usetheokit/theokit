---
'@theokit/agents': patch
---

`createCodeMode` names JavaScript in its tool description and instructions, and adds `allowedTools` and `maxResultChars` options (an oversized result throws `CodeModeResultTooLongError`).
