---
'@theokit/agents': patch
---

`readCappedBody` no longer waits on, or propagates a failure from, cancelling an oversized body's stream, so it always throws `BodyTooLargeError` (HTTP 413).
