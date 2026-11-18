---
'@theokit/http': minor
---

Added `readCappedFormData`, which reads a multipart or urlencoded body and refuses it with a 413 once it passes a byte cap. The dispatcher no longer reads form bodies on routes without `@Body`, so a handler's own cap applies before the body is buffered. Routes using `@Body` still get a parsed, validated body.
