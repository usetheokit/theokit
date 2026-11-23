---
'theokit': patch
'@theokit/agents': patch
---

`hashedSessionScope` from `theokit/server/http` hashes with Web Crypto and returns a promise, and `createHostedChat` awaits a `sessionScope` that returns one, so `theokit/server` no longer imports `node:crypto`.
