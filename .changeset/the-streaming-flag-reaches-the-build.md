---
'theokit': minor
---

`ssrStreaming: true` now reaches the build, so a declared streaming config actually streams

A project declaring `ssrStreaming: true` in `theo.config.ts` was served the fully buffered document:
nothing reached the browser until the render finished, so the shell could not paint early and TTFB
tracked the slowest Suspense boundary in the page.

The flag was accepted by the schema and dropped one layer down. `AdapterBuildContext.makeVitePlugins`
declared its options as `{ root, ssr }` with no field for streaming, so the node adapter could not
pass it, and the Vite plugin evaluated `options.ssrStreaming === true` on an `undefined` — emitting
the buffering server entry. That entry exports no streaming renderer, so the production server found
no streaming path to take and used the synchronous one on every request.

Measured on a released build, reading the raw TCP socket on a route with a Suspense boundary that
resolves after 800ms:

| | before | after |
|---|---|---|
| socket arrivals | 1 | 3 |
| time to first byte | 815ms | 12ms |
| first arrival | the whole document | the shell, with `<head>` |

**Behaviour changes for apps that already declared the flag**, which is why this is a minor rather
than a patch: the response now arrives in several chunks instead of one, and the hydration script is
written after the streamed body rather than inside a single buffered write. An app that declared
`ssrStreaming: true` and asserted on a whole-document snapshot will see a different shape — the shape
the flag always promised.

Apps that do not declare the flag are unaffected: the buffering entry remains the default, and a
build that streams when nobody asked is refused by the same tests that cover this fix.
