# Preview in this framework: nothing yet, and the shape it should take

**Measured 2026-08-20** against `packages/theo/src` and `packages/agents/src`.

**Confirmed: nothing exists.** A case-insensitive search for `noindex`, `robots`, `isPreview`,
`draftMode` and `previewMode` across both source trees returns zero hits. The ROADMAP's M15 status
line — *"There is no `robots` or `noindex` field anywhere in `packages/theo/src`"* — is accurate as
written, and the metadata component's prop list confirms it from the other direction: eleven props,
none of them a robots directive (`packages/theo/src/client/metadata.tsx:27-39`).

## Contents

1. [What exists](#what-exists)
2. [Where this framework can be better](#where-this-framework-can-be-better)
3. [The order](#the-order)
4. [Not measured](#not-measured)

---

## What exists

Nothing dedicated. What is present, and — measured this time rather than assumed — whether it is
actually reachable:

| Existing capability | Reachable today? | Relevance | Evidence |
|---|---|---|---|
| Session manager with encrypted cookies, 32-character minimum secret, dual-key rotation | Yes | The preview marker is a short-lived signed cookie — this is exactly the machinery | `packages/theo/src/server/auth/session.ts:17-19,85`; `packages/theo/src/server/auth/crypto.ts` |
| Cache engine, initialized at boot | Yes, **as of 2026-08-20** | Nothing about preview works if the engine is not running | `packages/theo/src/server/cache-bootstrap.ts:28`, called from `packages/theo/src/cli/commands/dev.ts:36` and `packages/theo/src/cli/commands/start/index.ts:67` |
| `skipCacheWhen` | Declared and honoured, but **no caller passes it** | A skip-**write** hook, not a request-scoped bypass — see the correction below | `packages/theo/src/cache/cache-engine.ts:46,249` |
| Tag invalidation (`revalidateTag`, `revalidatePath`, `updateTag`) | Yes, now that the engine boots | Where a preview-affected route is flushed after publish | `packages/theo/src/cache/index.ts:19`; `packages/theo/src/cache/revalidate.ts:27` |
| Route rules with glob matchers | **No production caller** | Would be where a preview bypass is expressed per route — the primitive exists and nothing uses it | `packages/theo/src/cache/route-rules.ts:12,24-26`, exported at `packages/theo/src/cache/index.ts:43` |
| Middleware | Yes, but **only on `/api/*` and actions** | Cannot be where the marker is detected for a page request — the document path never runs middleware | `packages/theo/src/cli/commands/start/request-handler.ts:257-262` |
| Metadata component | Yes | Where a forced `noindex` would land; it has a `children` escape hatch, so an application can already emit a raw robots tag by hand | `packages/theo/src/client/metadata.tsx:42,57` |
| Rate limiting, including per-route | Yes | For the entry endpoint, which is a credential-issuing endpoint | `packages/theo/src/server/rate-limit/rate-limit-per-route.ts` |

The 2026-08-19 version summarised this as: **"the hard parts already exist."** That is still the right
conclusion, but three of the six load-bearing claims under it were wrong, and all three were wrong in
the same direction — treating an exported symbol as a working seam.

### Correction 1: `skipCacheWhen` is a skip-write predicate, not a bypass hook

The previous version described it as *"The bypass hook the poisoning defence needs, already in the
read-through path."* Measured:

* Its signature is `(raw: T) => boolean` — it receives the **computed value**, never the request
  (`packages/theo/src/cache/cache-engine.ts:46`).
* It is consulted inside `runLoader`, after the loader has produced a value, and it short-circuits
  the **write** only; the value is still returned to the caller
  (`packages/theo/src/cache/cache-engine.ts:248-249`).
* It does not affect the read path. `readEntry` never consults it
  (`packages/theo/src/cache/cache-engine.ts:200-231`).
* Its own docstring says it is *"used by route middleware to bypass cache for uncacheable
  responses"* — **that route middleware does not exist.** `skipCacheWhen` has no production caller
  anywhere in `packages/theo/src`.

For the poisoning defence specifically, skip-write is in fact the correct seam: it is what stops a
draft from populating a public entry. But wiring a preview marker into a predicate that only sees the
value requires the marker to travel in the value or in a closure the caller builds — which is a
design decision, not a hook that is waiting to be used. Calling it "the bypass hook" made it sound
like a one-line connection.

### Correction 2: middleware is not where the marker can be detected

The previous version listed middleware as *"Where the marker is detected and the request context is
flagged."* Middleware in this framework runs only for matched `/api/*` routes and for actions
(`packages/theo/src/server/http/execute.ts:141`,
`packages/theo/src/server/http/action-execute.ts:169`). In `theokit start` the branch order is
reserved, actions, agents, API routes, static, custom 404, SSR streaming, SSR sync, CSR fallback
(`packages/theo/src/cli/commands/start/request-handler.ts:253-266`) — a rendered document returns at
`:261` or `:262` without any user middleware having run. Preview is a **document** concern. The layer
the previous version assigned it to cannot see the request that matters.

There is a second obstacle in the same place: the public middleware builder emits a handler the
file-scan runner cannot invoke (usetheokit/theokit#345 — the contracts at
`packages/theo/src/server/define/define-middleware.ts:1-3` and
`packages/theo/src/server/http/middleware-runner.ts:36-39` disagree). So even for an `/api/*` preview
route, the documented authoring path does not work today.

### Correction 3: route rules are exported, not wired

The previous version listed *"Route rules and tag invalidation"* as one capability. They are two,
with different statuses. Tag invalidation is reachable now that the engine boots
(`packages/theo/src/server/cache-bootstrap.ts:28`). Route rules are not: `compileRouteRules` and
`resolveRouteRule` are exported from `packages/theo/src/cache/index.ts:43` and have no production
caller. The glob-to-predicate machinery is real and useful
(`packages/theo/src/cache/route-rules.ts:24-26`); it is just not connected to anything.

---

## Where this framework can be better

Every mainstream implementation of this is a *recipe*: the framework provides a cookie-setting helper
and a flag the application reads, and the application is responsible for bypassing its own caches,
forcing `noindex`, expiring the state and not building an open redirect in the entry handler. The
result is that most implementations get at least one of those wrong, and the failure is silent.

Four positions are available here, and all four are enforcement rather than features:

### 1. The preview flag switches caching off, in the framework

The cache engine already has a skip-write seam and it now boots
(`packages/theo/src/cache/cache-engine.ts:249`;
`packages/theo/src/server/cache-bootstrap.ts:28`). Wiring the preview marker into it means **a draft
cannot populate a public cache entry**, by construction, in every application — not because each
application remembered.

That single decision removes the worst failure in this skill, which is the one nobody notices when it
happens. It is not, however, the one-line connection the previous version implied: `skipCacheWhen`
sees the value and not the request, so the marker has to be carried into the loader's closure by
whatever builds it. Naming that carrier is part of the work.

### 2. Forced `noindex`, not inherited

The metadata layer can override the page's own directive when preview is active
(`packages/theo/src/client/metadata.tsx:42`). In the recipe model, the page most in need of the
directive — a normally-indexable article — is the one that lacks it. Today the component has no
robots prop at all (`packages/theo/src/client/metadata.tsx:27-39`), so adding one is a prerequisite,
not a switch.

### 3. An entry handler the framework provides, not a snippet it documents

The seven steps in `entry-and-scope.md` include two that are routinely got wrong: verifying the
content exists before granting, and deriving the redirect target from the validated reference rather
than from a query parameter. The second is an open redirect on a credential-issuing endpoint.

Shipping the handler — token verification, expiry, single use, revocation lookup, existence check,
safe redirect — turns those from things to remember into things that are done. The session
machinery it would build on is real and already carries the properties the marker needs: encrypted
envelope, 32-character minimum secret, dual-key rotation
(`packages/theo/src/server/auth/session.ts:17-19,85`).

### 4. Non-leakage as a test helper

The three-request test in the SKILL's worked example — published, preview, published from another
client — is mechanical and provable. Shipping it as a test helper means every application can assert
non-leakage in its own suite rather than reasoning about it.

No framework ships this, and it is the only way an application can *know* rather than believe that
its preview does not poison a cache.

---

## The order

1. **Decide where a preview request is inspected on the document path.** New, and first, because
   correction 2 removed the assumption the rest of the order rested on. Middleware does not run for
   a rendered document (`packages/theo/src/cli/commands/start/request-handler.ts:261-262`), so the
   marker has to be read somewhere that does — the SSR entry, a plugin `onRequest` hook, or a widened
   middleware reach. Every item below inherits this answer.
2. **A preview marker with mandatory expiry**, built on the existing session machinery: signed,
   `HttpOnly`, `Secure`, short `Max-Age`, scoped path
   (`packages/theo/src/server/auth/session.ts:17-19`).
3. **Cache bypass wired to the marker**, through the `skipCacheWhen` seam
   (`packages/theo/src/cache/cache-engine.ts:249`), covering the route cache and the data cache,
   including whatever carries the marker into the loader closure. This is the item that removes the
   poisoning failure and it should not ship later than item 2.
4. **A `robots` prop on `Metadata`**, then **forced `noindex`** on any response produced while the
   marker is present, overriding page metadata
   (`packages/theo/src/client/metadata.tsx:27-39`).
5. **The entry handler**, with the seven steps, including the existence check and the derived
   redirect, rate-limited through the per-route limiter
   (`packages/theo/src/server/rate-limit/rate-limit-per-route.ts`).
6. **Per-document scoping** in the token, with an explicit set form for pages that render several
   drafts.
7. **A visible indicator component** with exit, and exit clearing the marker and the client route
   cache.
8. **The leak-test helper**: published, preview, published-from-another-client.
9. **Revocation**, as a list checked at entry — affordable because entry is not on the hot path.

Items 1 through 4 are the safety floor and belong in one milestone: a preview that expires, cannot be
cached and cannot be indexed. Items 5 and 8 are where this becomes better than the field, because
they move two silent failure modes into the framework and into the test suite.

---

## Not measured

* **Whether the Vite dev pipeline reaches the document path the same way as `theokit start`.** The
  production branch order was traced (`packages/theo/src/cli/commands/start/request-handler.ts:253`);
  the dev server's was not, so item 1 above may have two answers rather than one.
* **Whether `@theokit/ui` or the scaffold carries any preview concept.** Only
  `packages/theo/src` and `packages/agents/src` were searched, per the reachability rule. A preview
  helper living in another package would not have been found.
* **Whether the session cookie's `Max-Age` can be set per-issue.** The rotation and encryption
  properties were read; the cookie-attribute surface was not, so "short `Max-Age`, scoped path" in
  item 2 is a requirement, not a confirmed capability.
