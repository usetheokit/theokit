---
'create-theokit': patch
'theokit': minor
---

Reproducing production locally is one command, and a back navigation returns to where the reader left off.

`theokit preview` builds and then serves, in that order, stopping at the first failure. It replaces
`theokit build && theokit start`, whose failure mode is silent: `start` serves whatever `.theokit/`
already holds, so a skipped or failed build serves the previous one and nothing says so — worst
exactly when the two-step version is being used, which is to check whether a change works. It is not
a third implementation of either step; both stay separately invocable, because CI builds and serves
in different jobs. Scaffolded projects gain a matching `preview` script.

`ScrollRestoration` is mounted once at the root of the generated route manifest. It was mounted
nowhere, so a back navigation landed wherever the browser had left the offset. It sits beside the
application's own root element rather than replacing it, so a layout still receives `<Outlet />` as
its `children`.

Mounting it costs nothing at render time and nothing in the document. In a `createBrowserRouter`
application the component returns early — react-router's Framework Mode context is absent — so it
renders `null` on the server and on the client alike, emits no `<script>` and needs no CSP nonce.
That is what keeps the server tree byte-identical to the client one, the parity the renderer already
protects with `hydrate: false` after a tree mismatch measured CLS 0.39. The restoration itself runs
in `useScrollRestoration`, which needs only the data-router context `RouterProvider` supplies.

One assertion changed shape rather than intent: the manifest imported `Outlet` only when a layout
existed, and now always imports it, because the root's new element renders children through it.
