---
'@theokit/http': patch
---

The dispatcher leaves form bodies unread on routes without `@Body`, so `readCappedFormData` can stream and cap multipart and urlencoded uploads. Routes using `@Body` still get a parsed, validated body.
