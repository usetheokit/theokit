---
'theokit': patch
---

`theo start` reads `HOST` and `PORT`, so a container built from the documented path is reachable and
listens where its platform put it. Explicit `config.host` still wins, and `host: false` outranks the
environment. The startup line now states the bound address instead of always printing `localhost` —
a server bound to every interface and one bound to the loopback used to log the same thing.
