---
'@theokit/agents': minor
---

`readThreadHistoryFile(path, { skipMalformed })` reads a transcript by its path and can skip lines that are not JSON objects; `threadToUIMessages` takes `mergeAssistant: false` to keep each assistant record as its own message, and now takes a message's role from the row `type` when the message has no `role` (before, such a row was always a user message).
