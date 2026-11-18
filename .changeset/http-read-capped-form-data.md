---
'@theokit/http': minor
---

Add `readCappedFormData(request, { maxBytes })`: reads a multipart or urlencoded body while streaming and refuses it with `PayloadTooLargeException` (413) as soon as it passes `maxBytes`, instead of buffering it with `request.formData()`.
