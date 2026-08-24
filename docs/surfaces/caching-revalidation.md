# The cache engine this framework ships, and the order to close the gap

**Measured 2026-08-20** against `packages/theo/src/cache/`, `packages/theo/src/server/cache-bootstrap.ts` and
`packages/theo/src/config/schemas/cache.ts`. Re-measure before trusting: the engine is the source of truth,
not this file.

This surface came back the most wrong of the four re-measured today. The 2026-08-19 edition named five
capabilities that do not work the way it said — two listed as missing that exist, three listed as strengths
that are not what it claimed. Every one is corrected in place below, with what the old text said, rather
than rewritten silently.

The rule that produced those errors is worth stating before the tables: **an exported symbol is not a
capability until something calls it.** This file now separates three states — wired into a framework code
path, published for an application to call, and present with no caller at all.

## Contents

1. [What exists](#what-exists)
2. [What is strong](#what-is-strong)
3. [What is missing](#what-is-missing)
4. [The order to close it](#the-order-to-close-it)

---

## What exists

| Capability | Shape | Reachability | File |
|---|---|---|---|
| Read-through with compute | `getOrCompute` returning `hit \| stale \| miss` | Published | `packages/theo/src/cache/cache-engine.ts:114` |
| Fresh + stale windows | `maxAge` + `swr`, compared on read | Wired | `packages/theo/src/cache/cache-engine.ts:223` |
| **Single-flight on compute** | `Map<key, Promise>`, slot claimed before any `await` | Wired — **correction, see below** | `packages/theo/src/cache/cache-engine.ts:110` |
| **Single-flight on stale refresh** | `Set<key>` guard around the background loader | Wired — **correction, see below** | `packages/theo/src/cache/cache-engine.ts:295` |
| Tags per entry | `tags: string[]` on the stored entry | Wired | `packages/theo/src/cache/cache-engine.ts:280` |
| Version stamp, **on the entry, not in the key** | compared on read; mismatch reads as absent | Published — **correction, see below** | `packages/theo/src/cache/cache-engine.ts:201` |
| Tag invalidation | `revalidateTag`, `updateTag` | Published, and **no longer throws since 2026-08-20** | `packages/theo/src/cache/revalidate.ts:15` |
| Path invalidation | `revalidatePath`, sugar over a reserved tag prefix | Published | `packages/theo/src/cache/revalidate.ts:49` |
| Tag validation | `validateTags`, **drops and warns, never refuses** | Wired — **correction, see below** | `packages/theo/src/cache/validation.ts:20` |
| Key derivation from the request | excluded-query list, sorted query, lowercased host | Wired, but **its config key is inert** | `packages/theo/src/cache/key-derivation.ts:60` |
| **Function-level caching** | `defineCachedFunction`, keyed by name + arguments | Published — **correction, see below** | `packages/theo/src/cache/define-cached-function.ts:39` |
| Route-level caching | `defineCachedRoute` wrapping a handler | Published | `packages/theo/src/cache/define-cached-route.ts:77` |
| Per-route rules | first match wins over compiled patterns | **No caller — see below** | `packages/theo/src/cache/route-rules.ts:24` |
| Shared-cache headers | `s-maxage` + `stale-while-revalidate` | Wired | `packages/theo/src/cache/cache-control-header.ts:21` |
| Cache-status header | `X-Theo-Cache`, **now emitted in production too** | Wired — new on 2026-08-20 | `packages/theo/src/cache/define-cached-route.ts:396` |
| Pluggable storage | adapter interface, one in-memory implementation | Wired | `packages/theo/src/cache/in-memory-adapter.ts:24` |
| Engine initialised at boot | `theo dev` and `theo start` both init from `theo.config.ts` | Wired — new on 2026-08-20 | `packages/theo/src/server/cache-bootstrap.ts:28` |
| Cacheability guards | Set-Cookie, SSE, chunked, status, oversized body | Wired — **correction, see below** | `packages/theo/src/cache/define-cached-route.ts:312` |
| Error isolation | `onError` per phase | **Interface only — no production caller passes one** | `packages/theo/src/cache/cache-engine.ts:31` |

`Published` means an application can import it from `theokit/server`: the cache barrel
(`packages/theo/src/cache/index.ts:10`) is re-exported wholesale by the server barrel
(`packages/theo/src/server/index.ts:98`). `Wired` means a framework code path calls it without the
application asking.

### What changed on 2026-08-20

Three defects the previous edition could not have known about were fixed today, and each removes a
consequence this file used to carry:

* **The engine is initialised at boot.** `initCacheEngineFromConfig`
  (`packages/theo/src/server/cache-bootstrap.ts:28`) is called by `theo dev`
  (`packages/theo/src/cli/commands/dev.ts:36`) and by `theo start`
  (`packages/theo/src/cli/commands/start/index.ts:67`). Before that, `initCacheEngine` had no production
  caller and `getCacheEngine` had three, so `revalidateTag`, `updateTag` and `revalidatePath` — all
  published — threw `Cache engine not initialized` in every application. The three states a boot
  legitimately reaches are guarded rather than caught, so a genuine double-init still throws
  (`packages/theo/src/cache/engine-singleton.ts:27`).
* **A configured `defaults` reaches the route that declared none.** The config's `defaults` object is
  passed through the bootstrap (`packages/theo/src/server/cache-bootstrap.ts:45`) into the engine
  (`packages/theo/src/cache/engine-singleton.ts:43`), and `defineCachedRoute` reads `engine.defaults` at
  define time (`packages/theo/src/cache/define-cached-route.ts:90`).
* **`X-Theo-Cache` is emitted unconditionally** (`packages/theo/src/cache/define-cached-route.ts:396`).
  It used to be written only when `NODE_ENV !== 'production'` — so the one signal distinguishing a hit
  from a miss vanished in the only environment where anyone needed to check.

---

## What is strong

Re-measured on 2026-08-20. Two of the four claims in the previous edition were wrong about the mechanism,
and one of those was wrong about the guarantee as well.

1. **The three windows are modelled, and both refresh paths are deduplicated.** `maxAge` and `swr` with a
   `stale` status (`packages/theo/src/cache/cache-engine.ts:223`) is the shape that removes the expiry
   cliff. **Correction:** the previous edition listed single-flight as the headline missing capability,
   saying "the stale window has no deduplication, so concurrent readers each trigger their own refresh".
   That is false for the engine. `getOrCompute` claims an in-flight slot synchronously, before any `await`
   (`packages/theo/src/cache/cache-engine.ts:155`), and a concurrent caller awaits the same promise
   instead of computing (`packages/theo/src/cache/cache-engine.ts:120`). The stale-window refresh has its
   own guard, a separate `Set` checked before the loader is scheduled
   (`packages/theo/src/cache/cache-engine.ts:295`). A rejected computation rejects the shared promise
   rather than poisoning it, and the slot is released in a `finally`
   (`packages/theo/src/cache/cache-engine.ts:178`).
2. **`Set-Cookie` cannot be written to the cache.** The guarantee holds; **the previous edition named the
   wrong mechanism.** It credited `skipCacheWhen`, which no production code passes — the option is
   declared at `packages/theo/src/cache/cache-engine.ts:46` and read at
   `packages/theo/src/cache/cache-engine.ts:249`, and a search of `packages/theo/src` and
   `packages/agents/src` finds no caller supplying one. The real guard is `tryCacheResponse`, which
   refuses a response carrying `set-cookie` and warns once per route
   (`packages/theo/src/cache/define-cached-route.ts:318`), with a defence-in-depth strip when the surviving
   headers are serialised (`packages/theo/src/cache/define-cached-route.ts:357`). Same outcome, different
   code — and the difference matters, because the credited mechanism is the one nobody is protecting.
3. **The excluded-query-parameter list is real and applied by default.** 29 tracking parameters
   (`packages/theo/src/cache/key-derivation.ts:6`) are dropped whenever a caller passes no explicit list
   (`packages/theo/src/cache/key-derivation.ts:83`). Without it, tracking parameters shard the cache into
   single-use entries and the hit rate collapses for reasons nobody attributes to the cache.
4. **The route wrapper caches after middleware, by construction.** It wraps the handler rather than the
   router, so a cache lookup happens after auth and CSRF have run
   (`packages/theo/src/cache/define-cached-route.ts:60`). That is a structural guarantee, not a review
   convention.

**Correction, and this one inverts a claim.** The previous edition said "Tags are validated at the
boundary — a malformed tag fails rather than silently invalidating nothing." The opposite is true.
`validateTags` documents that it never throws (`packages/theo/src/cache/validation.ts:16`), drops each
invalid entry with a `console.warn` (`packages/theo/src/cache/validation.ts:108`), and `revalidateTag`
returns `{ deleted: 0 }` when every tag was dropped (`packages/theo/src/cache/revalidate.ts:26`). A
misspelled tag therefore invalidates nothing and reports success to its caller. Only `maxAge` and `swr`
validation throws (`packages/theo/src/cache/validation.ts:75` and
`packages/theo/src/cache/validation.ts:89`) — those are read at define time, where throwing is safe.

---

## What is missing

| Missing | Consequence |
|---|---|
| **A tag typo that fails** | See the correction above. `revalidateTag('user-42')` against a tag stored as `user_42` and `revalidateTag(reserved_prefix + 'x')` are indistinguishable to the caller: both return `{ deleted: 0 }`. This is the highest-value item on the list and it is a return type, not an engine change. |
| **Single-flight for cached routes** | The engine has it; `defineCachedRoute` deliberately does not use it, because a `Response` body is a single-use stream that cannot be shared across concurrent callers (`packages/theo/src/cache/define-cached-route.ts:73`). The reasoning is sound for the miss path. It is not sound for the stale path: `scheduleRouteRevalidate` (`packages/theo/src/cache/define-cached-route.ts:241`) has no guard, so N concurrent stale readers run N background handler invocations and N writes of the same entry. |
| **`routeRules` reaching the engine** | The config key is declared (`packages/theo/src/config/schemas/cache.ts:40`) and parsed, and the matcher is implemented (`packages/theo/src/cache/route-rules.ts:24`, `packages/theo/src/cache/route-rules.ts:35`). Nothing connects them: the bootstrap forwards only `enabled`, `storage`, `maxEntries` and `defaults` (`packages/theo/src/server/cache-bootstrap.ts:38`), and neither `compileRouteRules` nor `resolveRouteRule` has a production caller. A `routeRules` block in `theo.config.ts` validates and is discarded in silence. |
| **`keyDerivation` reaching the engine** | Same shape, one layer down. The key is declared (`packages/theo/src/config/schemas/cache.ts:33`), but the only production call site passes just `prefix`, `varies` and `getKey` (`packages/theo/src/cache/define-cached-route.ts:141`), so a configured `excludeQuery` or `sortQuery` never applies. `lowercaseHost` is inert twice over: `KeyDerivationOptions` has no such field, and the host is lowercased unconditionally (`packages/theo/src/cache/key-derivation.ts:71`). |
| **An observable cache failure** | `onError` is declared per phase (`packages/theo/src/cache/cache-engine.ts:31`) and invoked on every storage fault (`packages/theo/src/cache/cache-engine.ts:197`, `packages/theo/src/cache/cache-engine.ts:285`, `packages/theo/src/cache/cache-engine.ts:299`), but the boot path passes no hook (`packages/theo/src/server/cache-bootstrap.ts:38`), so in a real application every one of those calls is a no-op. A cache that has stopped working is indistinguishable from a cache that is missing every time. |
| **A safe default key for a cached function** | `defineCachedFunction` derives its key with `JSON.stringify(args)` unless `getKey` is given (`packages/theo/src/cache/define-cached-function.ts:53`). A `Date`, a `Map`, a `Set`, a function or an `undefined` argument all serialise lossily or collide, silently. The rule this needs is the one the previous edition wrote for captured values: represent it in the key, or refuse to cache. |
| **Named lifetime profiles** | Every call site invents its own seconds. The shipped default is `maxAge: 1` (`packages/theo/src/cache/constants.ts:11`, mirrored at `packages/theo/src/config/schemas/cache.ts:28`) — a one-second cache, which is a reasonable floor and a terrible lifetime. Nothing to review, nothing to tune centrally. |
| **`updateTag` distinct from `revalidateTag`** | Still true. Both call `engine.invalidateTag` on the same validated tag and differ in nothing but the name (`packages/theo/src/cache/revalidate.ts:37` against `packages/theo/src/cache/revalidate.ts:15`). The source says so, which is right — but callers reading only the names will assume a guarantee that does not exist. |
| **Jitter on expiry** | Entries written together expire together. No occurrence of the concept in `packages/theo/src/cache/`. |
| **Client router cache** | Navigation refetches; nothing is kept between transitions. Measured on the same day against `packages/theo/src/client/link.tsx`; see the navigation-prefetching skill. |
| **Persisted regeneration** | One adapter ships, and it is in-memory (`packages/theo/src/cache/in-memory-adapter.ts:24`). N instances warm N caches and a restart is a cold start. The config already accepts a caller-supplied adapter instance (`packages/theo/src/config/schemas/cache.ts:24`) and passes it through untouched (`packages/theo/src/cache/engine-singleton.ts:37`), so this is a configuration gap, not an architectural one. |
| **Cache-scope validation at render** | Nothing prevents identity-derived data from being read on a cached route, which is the prerequisite for cached pages with logged-in users. |

**Two rows were removed from this table on 2026-08-20, because the capabilities exist.**

* *"Single-flight"* was listed as the single highest-value missing item. It is implemented for
  `getOrCompute` and for the stale refresh (see the correction above). What is genuinely missing is
  narrower — the stale path of `defineCachedRoute` — and it is now its own row.
* *"Function-level caching — there is no way to cache a data function by identity + arguments"* was
  false. `defineCachedFunction` (`packages/theo/src/cache/define-cached-function.ts:39`) keys on
  `fn:${name}:${args}` (`packages/theo/src/cache/define-cached-function.ts:52`), resolves static or
  dynamic tags per call (`packages/theo/src/cache/define-cached-function.ts:57`), exposes
  `.invalidate(...args)` (`packages/theo/src/cache/define-cached-function.ts:82`), and is exported
  publicly (`packages/theo/src/cache/index.ts:10`). Because it routes through `getOrCompute`
  (`packages/theo/src/cache/define-cached-function.ts:67`) it inherits the single-flight the previous
  edition said the engine lacked. Two honest caveats survive the correction: the caller supplies the
  engine themselves (`packages/theo/src/cache/define-cached-function.ts:40`, with `getCacheEngine`
  exported at `packages/theo/src/cache/index.ts:40` to make that possible), and the default key
  derivation is unsafe for non-JSON arguments — which is why that is now its own row above.

**Not measured:** whether any real application actually calls `defineCachedFunction` or
`defineCachedRoute`. Both are published API with no framework-internal caller, and this repository holds
no consumer to look at. Their tests exercise them, which proves they run — not that anyone uses them.

---

## The order to close it

Step 1 of the 2026-08-19 edition was single-flight around `getOrCompute`. It was already implemented; the
list below starts from what is actually absent.

1. **Make a tag typo fail.** The highest value per line here, and it replaces a claim this file used to
   make on the engine's behalf. `revalidateTag` already computes the dropped list
   (`packages/theo/src/cache/validation.ts:10`) and throws it away
   (`packages/theo/src/cache/revalidate.ts:25`). Surface it: return the dropped tags in
   `RevalidateResult`, or refuse when every tag was dropped. Keep the drop-and-warn behaviour where tags
   arrive from runtime data; the refusal belongs where a literal was written by hand.
2. **Wire `onError`, then `routeRules`, then `keyDerivation`.** Three config keys and one hook that parse
   and go nowhere (`packages/theo/src/server/cache-bootstrap.ts:38`). Each is a few lines in one function,
   and until they land, `theo.config.ts` accepts blocks it silently ignores — which is worse than not
   accepting them. `onError` goes first because it is the one that makes the other two debuggable.
3. **Deduplicate the stale refresh for cached routes.** `scheduleRouteRevalidate`
   (`packages/theo/src/cache/define-cached-route.ts:241`) needs the guard the engine already has at
   `packages/theo/src/cache/cache-engine.ts:295`. The Response-sharing objection
   (`packages/theo/src/cache/define-cached-route.ts:73`) does not apply here: the background refresh
   discards the Response after serialising it, so nothing is shared.
4. **Refuse an unrepresentable cache key.** Give `defineCachedFunction` a key derivation that either
   handles non-JSON arguments explicitly or throws at call time
   (`packages/theo/src/cache/define-cached-function.ts:53`). Silent collision is the worst failure a cache
   can have, because it returns the wrong answer confidently.
5. **Named profiles** over `maxAge`/`swr`, with the raw numbers still available. Pure ergonomics, and the
   thing that makes lifetimes reviewable — starting with the one-second default at
   `packages/theo/src/cache/constants.ts:11`.
6. **Jitter** as an option on the profiles. Small, and it prevents the synchronised-expiry pattern that
   step 5 will otherwise make more common.
7. **Decide `updateTag`.** Either implement the distinct semantics — recompute now, no stale serve — or
   rename it (`packages/theo/src/cache/revalidate.ts:37`). Two names for one behaviour is a promise
   waiting to be broken.
8. **A shared storage adapter** (Redis, or the platform's own). The interface exists
   (`packages/theo/src/cache/storage-adapter.ts:77`) and the config path is already open
   (`packages/theo/src/cache/engine-singleton.ts:37`); what is missing is a shipped implementation and the
   documentation of what changes when instances share a cache.
9. **Cache-scope validation**, once static shells exist: fail the build when identity-derived data is read
   outside a boundary on a cacheable route. This is the item that unlocks cached pages for authenticated
   users, and it belongs to the same milestone as the rendering work — read the rendering-pipeline skill
   before starting it.

Steps 1 through 4 are corrections to things that already exist and currently mislead. Steps 5 through 9
add capability. That ordering is deliberate: a cache that reports success while doing nothing costs more
than a cache that cannot do something yet.
