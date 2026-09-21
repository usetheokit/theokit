# The public surface of `theokit/server/rate-limit`

`packages/theo/src/server/rate-limit/index.ts` is four `export *` lines and `package.json` declares
the subpath, so every exported name reaches a consumer by accident of syntax. This file is where
that stops being an accident: one row per **value** symbol the built module publishes, with a
verdict and the reason for it.

Types are absent on purpose. A module namespace carries values only — types are erased at build —
so a type reaching the subpath is invisible to any consumer at runtime and to the gate that reads
this file. A type named in a published signature is public by construction
(`rules/code-quality-golden-rule.md` § 5) and needs no row.

Enforced by `tests/smoke/rate-limit-subpath-surface-is-decided.test.ts`, which compares this table
against the BUILT module in both directions: a symbol built and not listed fails, and a symbol
listed and not built fails.

**Every row carries a reason, including the two whose verdict is uncontroversial.** The plan this
came from expected those two to be short; they are not, because the two symbols that reached the
decision bucket late in review got there by being called uncontroversial on a number nobody had
checked. A short row is how that happens.

| Symbol | Verdict | Reason |
|---|---|---|
| `RateLimited` | promise | `README.md:278` states this subpath *ships* it and `:283` gives the canonical import; `packages/theo/CHANGELOG.md:227` announced the export. Documented in public, so removing it is a breaking change |
| `createRateLimiterWeb` | promise | Its only consumer is generated code reaching it through `theokit/server`, a DEPRECATED umbrella scheduled for removal at `0.x+2` (`packages/theo/src/server/index.ts:2`); after that removal the generated worker must import through THIS subpath, so the promise is owed either way |
| `createRateLimiter` | internal | Consumed at `packages/theo/src/vite-plugin/api-middleware.ts:332`, which imports through `../server/internal-api.js` — the explicit internal contract, not this subpath. Used, and used internally, which is not the same as promised |
| `createRouteRateLimiter` | internal | Consumed at `packages/theo/src/cli/commands/start/index.ts:134`, this repository's own CLI. Four lines match outside the directory and two of them are comments, so one real call site carries it — ours, not a consumer's |
| `createRouteRateLimiterWeb` | internal | Zero consumers anywhere. `bakeableRateLimit` throws on `routes` because the matched route is decided after the limit runs, so a deployed entry cannot do per-route limiting and this mirror has no path to a caller today |
| `deriveKey` | internal | Zero consumers. Every apparent hit belongs to a different function of the same name — `packages/theo/src/cache/key-derivation.ts:60` or `packages/theo/src/server/auth/crypto.ts:28` — and `packages/theo/src/cache/index.ts:49` re-exports from the first, not from here |
| `deriveKeyFromRequest` | internal | Zero consumers. The generated fragment resolves the address inline as `return <expr> ?? 'unknown'` rather than calling it, so the Web-shaped mirror was superseded by the thing it was built for |
| `matchRoutePattern` | internal | Zero PRODUCTION consumers outside the directory. Beyond `packages/theo/src` it is called nine times, all in one test — `tests/unit/rate-limit-per-route.test.ts:6` imports it and `:151-166` exercise it, and per-route matching is refused on a deployed entry for the reason recorded against `createRouteRateLimiterWeb` |
| `InMemoryStore` | internal | Zero consumers. Its single mention outside the directory is a comment at `packages/theo/src/adapters/deployed-rate-limit.ts:17`; it is the default store the two factories throw for when replaced, which is load-bearing inside the module and unreferenced outside it |

## What this file does NOT decide

Whether each verdict is the RIGHT verdict. A gate can hold the surface still and make a
disagreement possible; it cannot settle one. `internal` here means *nothing consumes it and nothing
documents it as a promise* — it is an invitation to argue with a row, which is what the silence it
replaces could not be.


<!-- CORRECTED 2026-09-20 by the independent audit (loop-code-review, finding LCR0205).

     The `matchRoutePattern` row asserted "its only mention beyond `packages/theo/src` is a
     docblock example". That was FALSE and the tree says so: `matchRoutePattern` is imported at
     `tests/unit/rate-limit-per-route.test.ts:6` and called at :151, :152, :156, :157, :161, :162
     and :166 — nine mentions, every one a real call, none a docblock.

     **The verdict does not change and the reason it does not is the point.** `internal` was
     decided on PRODUCTION consumers, and a test is not one — the same standard
     `rules/code-quality-golden-rule.md` D3 applies when it says a test is not a consumer. What was
     wrong is the sentence that justified the verdict, not the verdict: a reader checking the claim
     would have found it false and had no way to tell whether the verdict was false too.

     **Two seats of the B-203 panel and five REVIEW reviewers read this file and none caught it.**
     It took an independent audit with its own instruments. Recorded because that is what the
     `cycle-review.md` argument for an independent auditor predicts, and this is the instance.

     The sibling `createRouteRateLimiter` row was already correct: it counts the lines, says how
     many are comments, and names the one real call site. This row now does the same.
-->
