# What this framework ships for navigation, and the order to close the gap

**Measured 2026-08-20** against `packages/theo/src/client/link.tsx`, `packages/theo/src/router/generate.ts`
and `packages/theo/src/router/entry.ts`. Re-measure before trusting.

This surface was one of the four that re-measured close to clean on 2026-08-19, and nothing changed it
today: no commit since then touched `packages/theo/src/client/` or `packages/theo/src/router/entry.ts`.
Re-reading it did produce one correction and one addition, both about the same thing — **the prefetcher and
the code-splitting preload map are two disconnected systems**, and the previous edition listed them side by
side as if they cooperated.

## Contents

1. [What exists](#what-exists)
2. [What is strong](#what-is-strong)
3. [What is missing](#what-is-missing)
4. [The order to close it](#the-order-to-close-it)

---

## What exists

| Capability | Shape | Where |
|---|---|---|
| Client transitions | Delegated to react-router's `createBrowserRouter` | `packages/theo/src/router/entry.ts:112` |
| `Link` with prefetch | `intent` (default), `viewport`, `none` | `packages/theo/src/client/link.tsx:15`, default at `packages/theo/src/client/link.tsx:55` |
| Intent trigger | `mouseenter` and `focus`, no delay and no debounce | `packages/theo/src/client/link.tsx:100`, handler at `packages/theo/src/client/link.tsx:63` |
| Viewport trigger | `IntersectionObserver`, `rootMargin: '200px'`, disconnects after the first hit | `packages/theo/src/client/link.tsx:84`, margin at `packages/theo/src/client/link.tsx:91` |
| Deduplication | A module-level `Set`, one prefetch per URL per session, never cleared | `packages/theo/src/client/link.tsx:23` |
| Prefetch mechanism | `<link rel="prefetch">` appended to `<head>`, **for the document URL** | `packages/theo/src/client/link.tsx:31` |
| Route code splitting | Pages are lazy; layout, error, loading and not-found stay static | `packages/theo/src/router/generate.ts:129` against `packages/theo/src/router/generate.ts:121` |
| Lazy toggle per build | Lazy in the browser build, static in the SSR build | `packages/theo/src/vite-plugin/virtual-modules-hook.ts:75` |
| Preload map | Emitted per absolute route path — **consumed at hydration only** | `packages/theo/src/router/generate.ts:144`, consumed at `packages/theo/src/router/entry.ts:83` |
| `Link` reachable by an application | Exported from `theokit/client`, not from the root entry | `packages/theo/src/client/index.ts:69` |
| Used by the scaffold | The generated nav renders `Link` with `prefetch="intent"` | `packages/create-theokit/templates/default/src/app/components/Nav.tsx:21` |

**Correction to the 2026-08-19 edition.** It listed *Prefetch mechanism* as "a `rel="prefetch"` link element
for the route path" and *Preload map* as "emitted per route path, keyed to match the router's own
resolution", one row below the other, with nothing saying they never meet. They do not:

* `injectPrefetch` sets `link.href` to the value of `to` (`packages/theo/src/client/link.tsx:33`, resolved
  by `packages/theo/src/client/link.tsx:37`). For `<Link to="/contacts">` the browser is asked to prefetch
  the **document** `/contacts`. No `as=` attribute is set.
* `__theoPreloadMap` maps a route path to the page's `import()`
  (`packages/theo/src/router/generate.ts:139`) — the chunk react-router actually needs on a transition.
  Nothing in `packages/theo/src/client/` reads it. Its only production consumers are in the generated
  entry, inside the SSR-hydration branch: matched at `packages/theo/src/router/entry.ts:79`, resolved to
  absolute paths at `packages/theo/src/router/entry.ts:83`, awaited against a 1500 ms timeout at
  `packages/theo/src/router/entry.ts:88`. The CSR-only branch does not even import it
  (`packages/theo/src/router/entry.ts:109`).

So the preload map is a **hydration** capability, not a navigation one, and hovering a link warms a
document response rather than the page chunk the transition will block on. Listing it as a navigation
capability overstated what a hover buys.

---

## What is strong

Three decisions here are right, and two of them are the ones most implementations get wrong.

1. **Intent is the default** (`packages/theo/src/client/link.tsx:55`). Hover and focus scale with attention
   rather than with page length — the only default that is safe on both a nav bar and a feed. `focus` being
   wired alongside `mouseenter` (`packages/theo/src/client/link.tsx:100`) means keyboard navigation gets
   the same benefit, which is the half most implementations forget.
2. **Deduplication exists and is unconditional** (`packages/theo/src/client/link.tsx:28`). A hover-heavy nav
   bar cannot produce a request storm. Two bounded caveats, neither of which is a defect at present size:
   the `Set` is never cleared, and the injected `<link>` elements are never removed from `<head>`
   (`packages/theo/src/client/link.tsx:34`), so both grow with the number of distinct URLs a session
   touches.
3. **Only pages are lazy.** Layout, error, loading and not-found are emitted as static imports
   (`packages/theo/src/router/generate.ts:121`) while pages go through `React.lazy`
   (`packages/theo/src/router/generate.ts:129`), so a transition never waits on the chrome it is rendering
   into — the fallback and the error boundary are always present when they are needed most. The SSR build
   turns lazy off entirely (`packages/theo/src/vite-plugin/virtual-modules-hook.ts:75`), which is right for
   a server that has every chunk on local disk.

**Not covered by a test.** `tests/unit/link-prefetch.test.ts` asserts the export and type contract
(`tests/unit/link-prefetch.test.ts:12`) and then re-implements the logic locally rather than calling it:
it builds its own `Set` (`tests/unit/link-prefetch.test.ts:48`) and its own copy of `resolveTo`
(`tests/unit/link-prefetch.test.ts:61`), and the SSR guards are asserted as `typeof …` booleans
(`tests/unit/link-prefetch.test.ts:79`). The file says so in its own header, deferring DOM tests
(`tests/unit/link-prefetch.test.ts:5`). Nothing asserts that a hover appends a `<link>`, that the
`IntersectionObserver` path fires, or that `prefetch="none"` prefetches nothing. Every claim in this
section was read from source rather than from a passing assertion.

---

## What is missing

| Missing | Consequence |
|---|---|
| **Data prefetching** | Only a document URL is prefetched. The generated route config emits no `loader` and no `action` (`packages/theo/src/router/generate.ts:206`), so there is no framework-level data to prefetch and the spinner — the cost users actually report — is untouched. |
| **Chunk prefetching on intent** | The map that names each page's chunk exists (`packages/theo/src/router/generate.ts:144`) and `Link` does not read it. This is the smallest available win on this surface: the data is already emitted. |
| **Prefetch budget** | `viewport` on a long list issues one request per visible row, uncapped (`packages/theo/src/client/link.tsx:87`). No concurrency limit, no per-page total; the dedup `Set` is the only limiter. |
| **Client-constraint checks** | No `saveData`, no `effectiveType`, no `visibilityState`, no `requestIdleCallback`, no `fetchPriority` — searched across `packages/theo/src` and `tests/`, zero occurrences of any of them. Prefetching competes hardest exactly where it hurts most. |
| **Priority** | Prefetches do not explicitly yield to a real navigation, and an in-flight prefetch is never cancelled: the effect cleanup disconnects the observer and nothing else (`packages/theo/src/client/link.tsx:94`). |
| **Navigation cache** | Nothing is kept between transitions, so back refetches. No `routerCache` / `navigationCache` / `bfcache` handling anywhere in `packages/theo/src`. |
| **Mutation-driven client invalidation** | Not applicable yet; **required the day a navigation cache lands**. |
| **Interruption semantics** | No `AbortController` and no generation counter in the client navigation path. The `AbortSignal` uses that do exist are unrelated — RPC (`packages/theo/src/client/theo-fetch.ts:210`), agent streaming (`packages/theo/src/client/create-agent-client.ts:98`), SSR render (`packages/theo/src/router/entry-server.ts:331`). |
| **Scroll restoration** | Not owned by the framework. The generated entry renders no `<ScrollRestoration>` (`packages/theo/src/router/entry.ts:115`) and the manifest imports only `React`, `Suspense` and `Outlet` (`packages/theo/src/router/generate.ts:112`). Each application solves it or does not. |
| **Focus management and route announcement** | Same — no `aria-live`, no `role="status"`, no `.focus()` in `packages/theo/src/client/` or `packages/theo/src/router/`. An accessibility gap, not only an ergonomic one. |
| **Per-link data strategy** | `PrefetchBehavior` has three values and all three concern *when* (`packages/theo/src/client/link.tsx:15`), never *what*. A link cannot say "prefetch the shell, not the record". |
| **A test that exercises the prefetcher** | See the note above. Every guard on this surface is currently protected by reading, not by a failing test. |

The two that change what users feel are **data prefetching** and the **navigation cache**. Everything else
on this list is either a guard on an existing feature or a correctness requirement that arrives with those
two — with one exception now promoted, chunk prefetching, which is a guard on a feature that is already
paid for and not collected.

---

## The order to close it

1. **Point the prefetcher at the chunk, not only at the document.** `__theoPreloadMap` and
   `__theoPreloadPathsFor` are already emitted (`packages/theo/src/router/generate.ts:144` and
   `packages/theo/src/router/generate.ts:155`) and already exported from the virtual manifest that the
   entry imports (`packages/theo/src/router/entry.ts:108`). Have `Link` resolve `to` through the same
   function and call the factory on intent. Small, uses only what exists, and it converts a hover into the
   thing a transition actually blocks on.
2. **Budget the existing prefetch.** Concurrency cap, per-page total, skip on save-data, skip on slow
   connections, skip when the tab is hidden. Self-contained, and it removes the one way the current
   implementation can make a page worse. Do it with step 1, not after: step 1 makes each prefetch heavier.
3. **Cover the prefetcher with a real test.** `tests/unit/link-prefetch.test.ts:5` defers DOM testing for a
   missing dependency; until that lands, steps 1 and 2 ship unverified. Assert that a hover appends exactly
   one `<link>`, that a second hover appends none, and that `prefetch="none"` appends none.
4. **Scroll restoration and focus management**, owned by the framework. Save scroll on leave keyed by
   history entry; restore on pop; move focus to the new content region on forward navigation and announce
   the route. The entry generator (`packages/theo/src/router/entry.ts:115`) is where this lands. This is
   the accessibility floor and it should not be per application.
5. **Interruption semantics.** Abort the in-flight work for a superseded navigation and discard late
   responses with a generation check. Cheap, and it removes the "landed on the wrong page" class.
6. **Data prefetching, shell-first.** Prefetch the destination-independent part of a route on intent; leave
   the record-specific part to the click. This depends on routes having data at all — the generator emits
   no loaders today (`packages/theo/src/router/generate.ts:206`) — and on the boundary structure separating
   the two. Read the rendering-pipeline skill first, because the split is a rendering decision.
7. **Navigation cache**, with all four invalidation triggers defined before it ships: explicit refresh,
   mutation-driven, TTL and full reload. Ship the mutation-driven path in the same change as the cache
   itself — a navigation cache without it produces the "I saved it and the list still shows the old value"
   bug, and that bug is unreachable from every server-side invalidation the framework already has
   (`packages/theo/src/cache/revalidate.ts:15`).
8. **Per-link data strategy**, once 6 and 7 exist: let a link declare code-only, shell, or full-data
   prefetching, widening `PrefetchBehavior` (`packages/theo/src/client/link.tsx:15`) from a *when* to a
   *when and what*.

Step 7 is the one to resist splitting. The cache is the feature; the invalidation is what makes it correct,
and shipping them apart means shipping a period in which the framework can show users stale data with no
way for the server to intervene.
