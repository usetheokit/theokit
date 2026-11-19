---
'theokit': minor
---

Add `objectToFormData` and `FormDataEncodingError` to `theokit/client`: the encoder that round-trips through the server's `formDataToObject`, so a client can post files to a server action. An array of objects throws `FormDataEncodingError` instead of encoding something the decoder reads back as `[]`.
