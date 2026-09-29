---
'theokit': patch
---

The Bun target renders the document it was already announcing, and the build stops claiming what the
target cannot do.

A project with `ssr: true` built for Bun was answered `.theokit/client/index.html` — an empty
`<div id="root">` — while the build printed `✓ Build complete → bun (SSR)`. Measured on Bun 1.3.14: 531
bytes before, 14732 after, 3546 of them rendered markup with the hydration data inside the root.

Three things were wrong and they are one shape — the build asserting what a target does instead of
deriving it:

- The whole implementation of `ssrStreaming` in the Bun adapter was which comment landed on line 4 of
  the emitted file. The renderer it needed was already built and shipped for this target
  (`.theokit/server/entry-server.js`, 95513 bytes, its own header naming Bun) and nothing imported it.
- The streaming SSR bundle could not be loaded on any Web runtime. It imported `renderToPipeableStream`
  and `renderToReadableStream` from `react-dom/server` by name, and Bun resolves that specifier to
  `server.bun.js`, which exports the second and not the first — a named import of a missing export is a
  link-time error. Deno and workerd are affected by the same mechanism.
- `(SSR)` came from `config.ssr` alone, so `netlify`, `aws-lambda` and `deno-deploy` were announced as
  server-rendering while their own emitted comments say they delegate the document to a static host. And
  the Vercel build told the operator no nonce is minted while its function mints one — advice to work
  around a restriction the deployment did not have.

Found because a backlog item claimed every deploy target needed credentials nobody had. Bun is a local
server and never needed an account: one build and one request found a defect in four targets.
