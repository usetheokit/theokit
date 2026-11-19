---
'@theokit/http': minor
---

Add `createNodeServer` and `BindError` to `@theokit/http/runtime/node`: a Node server whose `Request.signal` aborts when the client disconnects, with an `onUpgrade` hook (404 by default), a memoized `close({ force })` that ends open and upgraded connections, and a `listen` that rejects with a typed `BindError`. `writeResponseToNode` now cancels the response body when the client leaves.
