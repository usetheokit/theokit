---
'theokit': patch
---

`scripts/probe-hydration.mjs` — an oracle for hydration errors that anyone can run.

A hydration mismatch is the server's markup disagreeing with the client's first render, so both
halves have to actually run, in a browser, against a built app. jsdom does not hydrate the way React
hydrates, and asserting on a console string is not the same as asserting that nothing was thrown.

It drives Chrome over the DevTools Protocol using Node's built-in `WebSocket` — no browser driver is
declared anywhere in this monorepo, and adding one for a single script is the rung of the parsimony
ladder this stops at.

```
node scripts/probe-hydration.mjs --url http://127.0.0.1:3000
```

Exit 0 clean · 1 the page threw or logged an error, each printed with its stack · **2 could not
measure**. The third is the point: a probe that reports an unreachable URL as clean is worse than no
probe, and this one did exactly that until a navigation guard was added — Chrome renders its own
connection-error document and fires `load` over it.
