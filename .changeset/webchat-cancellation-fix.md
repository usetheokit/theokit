---
'@theokit/agents': patch
---

`readCappedBody` cancels an oversized body without waiting on it, so a cancel that rejects or stalls still ends in `BodyTooLargeError` (HTTP 413 in WebChat).
