---
'@theokit/presenter': minor
---

`foldTurnLifecycle` takes `messageBoundary: 'tool-call'` to emit the preamble before a tool call as its own message item, and a failed tool result closes its item with `isError`. New `contentChunkFromEvent` and `finalMessageOf` convert canonical events and return the text after the last tool call.
