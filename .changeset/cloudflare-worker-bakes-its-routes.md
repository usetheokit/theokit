---
'theokit': minor
---

The generated Cloudflare Worker no longer reaches for a filesystem it does not have.

The emitted worker discovered its routes by calling `scanServerRoutes` — a `readdirSync` — against a
directory that does not exist on Workers, then loaded each module through `import()` of a file path
via `pathToFileURL`. It answered "are there WebSocket routes?" with a second `readdirSync`. Three
calls, none of which can succeed there.

Routes are now scanned on the build machine and baked into the worker: a static `import` per route
module, a literal route table, and a loader that serves only what the build bundled. Static because
Wrangler's bundler follows those imports — `wrangler.toml` uploads `.theokit/client` and has never
uploaded `server/`, so a module not bundled *into* the worker is not on the platform at all.

This is the road the adapter already took for the document shell one function away, for the same
stated reason: a Worker has no filesystem at request time.

The scanner is injected through `AdapterBuildContext.scanRoutes` rather than imported, because
importing it would add an `adapters → server` edge — the layering inversion ADR-0001 v3 removed for
`vite-plugin`. An adapter given no scanner emits a worker with no routes rather than falling back to
a runtime scan: the fallback is the defect.

Route precedence is unchanged — the pattern is recompiled from the same `routePath` the scanner
produced, through the same `compilePattern`, so one function decides precedence on every target.

**Not verified on the platform.** No deploy runs in CI. What is proven is that the emitted worker no
longer calls three APIs that cannot exist there, and that it parses as an ES module.
