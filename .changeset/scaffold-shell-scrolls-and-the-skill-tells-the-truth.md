---
'create-theokit': minor
---

An ordinary page in a scaffolded app scrolls, and the frontend skill stops teaching a `theoFetch` option that does not exist.

**The shell clipped every page after the chat.** `<main>` was `overflow-hidden` and the shell is `h-screen`, so the document could not scroll and neither could the routed page. Measured in a real app built on this template: **2240px of 3090px unreachable — nine of eleven cards**, with nothing on screen to explain it. The layout's own comment described the premise ("the document never scrolls") and never named the consequence.

`<main>` now scrolls, and the chat — the one page that genuinely wants a clipping box, so its log scrolls inside and the composer pins — declares that for itself. The default serves the page a developer is most likely to write next, and that is not another chat.

Both halves shipped together on purpose: a scrolling `<main>` without the chat's own container unpins the composer, and the container without the scrolling `<main>` is the original defect. Verified in a browser on a real app, not only in tests — an ordinary page reaches its last pixel, and on the chat the composer sits exactly at the viewport bottom while the shell does not scroll.

`min-h-0` rides along in both places and is the non-obvious half: a grid or flex child defaults to `min-height: auto` and refuses to shrink below its content, so `overflow-y-auto` alone does nothing at all.

**This changes a template, not a runtime.** Templates are copied at scaffold time, so an existing app owns its own `layout.tsx` and is untouched. Adopting the change means copying the two edits; leaving it alone costs nothing except the original trap.

**The frontend skill taught a call that cannot compile.** It showed `theoFetch('/api/tasks/:id', { params: { id: 1 } })`; `TheoFetchOptions` has no `params`, and had it compiled the request would have gone to the literal `:id`. An agent reading the skill wrote that call. `params` is real — but only on the GENERATED client, which knows the route tree, and that is exactly why the wrong example was plausible.

Both examples are now what the generator actually emits, measured against it: methods are lowercase (`client.tasks.get()`), a dynamic segment loses its colon (`client.tasks.id`, never `client.tasks[':id']`), and `params` values are strings. Regression tests pin all of it, including the `min-h-0` that the CSS silently depends on.
