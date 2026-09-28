---
'theokit': minor
---

The Vercel target renders the document, so an SSR project stops being served an empty shell

`renderVercelConfigJson` emitted, in order: a header rule on `/(.*)` with `continue: true`;
`/api/(.*) -> /api`; `{ handle: 'filesystem' }`; `/(.*) -> /index.html`. Nothing routed a page request to
the function, so `/` was Vercel's static host serving `index.html` — an empty `<div id="root">` —
whatever the project declared, while the build printed `✓ Build complete → vercel (SSR)`.

The function could not have answered if it had been asked: `renderStreamingWeb`, `htmlHead` and
`injectModulePreloads` each appeared ZERO times in the Vercel adapter, against six, five and one in the
Cloudflare one.

Three things changed. The fallback route reaches the function when the project renders (`{ handle:
'filesystem' }` still precedes it, so every real file is still served by the platform). The emitted entry
grew a document branch that calls the app's own SSR entry — the same module the Cloudflare worker imports,
inlined by the function bundler. And the build now reads the client shell and passes it, which is the step
`B-185`, `B-235`, `B-312` and `B-315` each had to fix one target at a time: the option existing and no
build passing it.

The branch is scoped OUTSIDE `/api/`: a path under that prefix which matches no route is a routing miss
and owes a JSON 404, not a document. A static project emits no branch at all and keeps the shell.

Measured by executing the built function, before and after: `/` went from `404, 9 bytes, text/plain` to
`200, 14827 bytes, text/html` with `<head>`, `<div id="root">` and the CSP; `/dashboard` likewise;
`/api/health` unchanged.
