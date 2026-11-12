---
'@theokit/agents': patch
---

`forkBeforeUserTurn` no longer throws `JsonlParseError` when the last line of the transcript is partly written; it still throws on a corrupt line in the middle.
