---
"theokit": minor
---

A server-rendered route now declares the chunks it needs, so the browser is told up front instead of
discovering them when the entry executes. It holds on all three paths a document can be produced on:
the synchronous SSR document, the streaming one, and the Cloudflare worker — which has no filesystem
and therefore bakes the map in at build time.

The streaming path is worth naming separately, because it was the one the first revision missed. The
injector was wired into `buildSsrHtml`, which serves the synchronous branch only, while a request
with `ssrStreaming: true` is dispatched before it ever gets there — so the feature was off for
exactly the configuration a production app is most likely to run. The exclusion argued beside that
code is about metadata hoisting, which needs the rendered body; a `modulepreload` link needs nothing
from it, so the argument never reached this case.

Also in this release, for a consumer:

- A scaffolded app hydrates again with SSR on. Two module instances of the router reached one
  bundle, so the provider that was filled was not the one `useLocation()` read; `resolve.dedupe` now
  collapses them.
- A route served behind a proxy gets its preloads. The lookup matched the route against the raw
  request target, which a proxy rewrites.
- `theokit/server/http` exports `injectModulePreloads`. It was first added to the `theokit/server`
  umbrella alone, which is deprecated and has no migration path off it.
