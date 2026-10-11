---
'@theokit/agents': patch
---

`createA2ATool` returns the remote turn's text parts one per line. A remote that speaks before and after a tool call answers with two text parts, and they were joined with nothing, so the calling model read `Let me check.The answer is 4`. They are now joined with a newline, and empty parts are skipped. A turn with a single text part returns the same string as before. (B-407)
