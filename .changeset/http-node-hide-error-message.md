---
'@theokit/http': patch
---

The Node runtime no longer sends a thrown error's message in the 500 body. The client gets `Internal Server Error`; the real error goes to the new optional `onError(err, request)` option of `createServer`, or to `console.error`.
