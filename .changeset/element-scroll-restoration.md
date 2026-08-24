---
'theokit': minor
'create-theokit': patch
---

Scroll restoration now covers the element your layout scrolls, not only the document.

The router mounted react-router's `<ScrollRestoration>`, which restores `window.scrollY`. A layout
that scrolls an inner element — which is what the default scaffold ships — leaves the document with
no offset to save, so restoration ran and restored nothing.

Mark the element with `data-theo-scroll="<id>"` and its offset is restored on back navigation. The
value is the id, so a page with two scrollers stays unambiguous. Declared rather than detected:
walking the DOM for `overflow: auto` picks a container silently, and a different one as the layout
changes.
