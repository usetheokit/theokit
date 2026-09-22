---
'theokit': patch
---

Scroll restoration now puts the container back where the user left it, instead of at 0
(usetheokit/theokit#421).

Measured against `theokit@0.70.1` scaffolded from npm with `.ssr(true)`, driving a real Chrome: a
container scrolled to 2400, a client-side navigation, `history.back()` — and the offset read 0. Read
straight out of `sessionStorage` on leaving the route:

```
{"theokit:scroll:default":"{\"main\":0}"}
```

It stored **0**, not 2400. Nothing was lost in transit; the wrong number was written.
`ElementScrollRestoration` saved the outgoing route's offsets from inside a `useLayoutEffect`, and
React runs that AFTER committing the incoming route's DOM — so every element it queried was the new
page's, sitting at the top.

The restorer gained `record()`, which snapshots offsets while the route that owns them is still on
screen, and the shell now calls it on every scroll (capture phase, because `scroll` does not bubble
from an element; passive, because it never calls `preventDefault`). `save()` persists the recorded
snapshot, falling back to reading the live targets when there is none — a route restored from a
previous visit and never scrolled still has exactly one correct offset, and that is it.

The decision lives in `scroll-restoration.ts` rather than the React shell, which is the split that
file already argued for: this package's test environment is `node`, so the testable half is where
the branches belong.

Same journey after the fix: **2400 → navigate → back → 2400**.
