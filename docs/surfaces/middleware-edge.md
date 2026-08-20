# Middleware in this framework: what exists, and where it can be better than the field

**Measured 2026-08-20** against `packages/theo/src/server/scan/middleware-scan.ts`,
`packages/theo/src/server/http/middleware-runner.ts`,
`packages/theo/src/server/http/web-middleware-runner.ts`,
`packages/theo/src/server/define/middleware-builder.ts` and the two request pipelines that reach
them (`packages/theo/src/cli/commands/start/request-handler.ts:253`,
`packages/theo/src/vite-plugin/api-middleware.ts:440`).

The previous measurement (2026-08-19) got the **reach** of this layer backwards. That correction is
recorded in [Parity gaps](#parity-gaps) rather than edited away, because the wrong version put a
matcher at the top of the order to solve a cost that is not being paid.

## Contents

1. [What exists](#what-exists)
2. [Parity gaps](#parity-gaps)
3. [Where this framework can be better](#where-this-framework-can-be-better)
4. [The order](#the-order)

---

## What exists

| Capability | Shape | Evidence |
|---|---|---|
| File-based middleware | `server/middleware/*.ts`, one file per concern; `_`- and `.`-prefixed files skipped | `packages/theo/src/server/scan/middleware-scan.ts:20,30` |
| Explicit ordering | Sorted by **code unit**, not by locale collation, so a numeric prefix means the same thing on every machine (usetheokit/theokit#351) | `packages/theo/src/server/scan/middleware-scan.ts:39` |
| Single-file fallback | `server/middleware.ts` still runs; declaring both it and the directory throws a named configuration error | `packages/theo/src/server/http/middleware-runner.ts:84` |
| A builder | `middleware().handle(fn).build()`, with `.build()` a compile error before `.handle()` and a runtime throw for JS callers | `packages/theo/src/server/define/middleware-builder.ts:28,37,46` |
| Context factory | `server/context.ts` runs after the chain, producing the `ctx` the route handler receives | `packages/theo/src/server/http/middleware-runner.ts:117` |
| Dev-request caching | The directory scan is cached per `serverDir`, so it does not re-run per request | `packages/theo/src/server/http/middleware-runner.ts:29,50` |

Two decisions here are already good and worth protecting:

* **One file per concern with a visible order.** A numeric prefix makes the chain readable from a
  directory listing — better than a single file with a hand-maintained array, and far better than a
  decorator order nobody can see.
* **The order is stable, declared, and deliberately not collated.** Sorting by code unit rather than
  by `localeCompare` is the difference between an order that is a contract and one that depends on
  the machine that ran the build.

**Correction to the 2026-08-19 entry.** That table described the order as *"alphabetical by
filename"*. It is code-unit order, chosen against collation on purpose
(`packages/theo/src/server/scan/middleware-scan.ts:36-38`); "alphabetical" is the property the
implementation refused.

---

## Parity gaps

### The correction that reorders this whole file

The 2026-08-19 table opened with:

> **Matchers** — Every middleware runs on every request that reaches the server. There is no way to
> say "pages, not assets", so the cost is paid everywhere and each file must return early by hand.

**That is false, and it is false in the expensive direction.** Middleware is not over-scoped; it is
under-scoped to the point of being unreachable for most of the surface.

`runMiddlewareAndContext` has exactly two production call sites — `executeRoute`
(`packages/theo/src/server/http/execute.ts:141`) and the action executor
(`packages/theo/src/server/http/action-execute.ts:169`). `executeRoute` is reached only after a
route has already matched, and the branch that reaches it requires a `/api/` prefix first
(`packages/theo/src/cli/commands/start/handlers.ts:403,408,447`). In `theokit start` the branch
order is reserved paths, actions, agents, API routes, **static**, custom 404, **SSR streaming**, SSR
sync, CSR fallback (`packages/theo/src/cli/commands/start/request-handler.ts:253-266`). Static assets
(`:258`) and every rendered document (`:261-262`) return before any user middleware exists.

So the real gap is the inverse of the one that was recorded:

| Missing | Consequence |
|---|---|
| **Any middleware at all on the document and asset paths** | Auth, redirects, locale negotiation, headers and CSP cannot be expressed as middleware for a page request — only for `/api/*` and actions. The most common middleware use case in the field is the one this layer cannot serve |
| **A matcher** | Still absent, but as a *scoping* mechanism for a layer that would otherwise be all-or-nothing once the document path is wired — not as a cost reduction on asset traffic that never reaches it |
| Header, cookie and method conditions | Conditions live inside handlers rather than in a declarative matcher |
| Rewrite as a first-class action | No `rewrite` in the middleware action vocabulary. A Web-Standards `proxyFetch` with path rewriting exists (`packages/theo/src/services/runtime/proxy.ts:69,90`) but is a services-layer helper, exported and with no production caller in `packages/theo/src` |
| Loop guards | Nothing detects a redirect or rewrite cycle |
| Per-stage timing | No attribution; "middleware is slow" is unactionable |
| Runtime constraint declaration | Nothing states which middleware can run on a restricted target |
| CSP nonce ownership | The nonce is minted in the render path — `packages/theo/src/cli/commands/start/request-handler.ts:240` in production, `packages/theo/src/vite-plugin/ssr-dev-middleware.ts:115` in dev — and cannot currently be a boundary concern, because middleware never runs on that path at all |

### Three contracts that disagree, which is usetheokit/theokit#345

Confirmed still true on 2026-08-20. The public builder and the two runners each define their own
middleware signature, and no two are compatible:

| Where | Signature | Evidence |
|---|---|---|
| Public builder | `(request: Request, next: (request: Request) => Promise<Response>) => Response` | `packages/theo/src/server/define/define-middleware.ts:1-3` |
| File-scan runner | `(req: IncomingMessage, res: ServerResponse, next: () => void) => void` | `packages/theo/src/server/http/middleware-runner.ts:36-39` |
| Web runner | `(request: Request, context: Record<string, unknown>) => Response \| undefined` | `packages/theo/src/server/http/web-middleware-runner.ts:19-21` |

`middleware()` is public — re-exported through `packages/theo/src/server/define/index.ts:32` and the
`./server` and `./server/define` package entries. A handler it produces, dropped into
`server/middleware/`, is invoked by the file-scan runner as `mw(req, res, callback)`
(`packages/theo/src/server/http/middleware-runner.ts:96`). It therefore receives an `IncomingMessage`
where it expects a `Request`, and a `ServerResponse` where it expects `next`; calling `next(request)`
calls a non-function. The chain aborts. **The published builder produces a handler the published
runner cannot invoke**, exactly as the issue says.

**Correction to the 2026-08-19 entry.** That version described this as *"two runners, one builder"*.
It is three mutually incompatible contracts, and the Web runner's is not a variant of the other two —
it takes a mutable `context` object instead of a `next` continuation
(`packages/theo/src/server/http/web-middleware-runner.ts:36-44`), which is a different composition
model, not a different transport.

### What the authorization ADR did and did not change

ADR 0001 (`docs/adr/0001-authorization-is-transport-independent.md`) is easy to misread as having
unblocked this surface. It did not, and the distinction is exact:

* **Access control is now transport-independent.** `RouteConfig.policy` is evaluated from one
  function (`packages/theo/src/core/contracts/route-policy.ts`) by the Node executor
  (`packages/theo/src/server/http/execute.ts:268`), the Web executor
  (`packages/theo/src/server/web-handler.ts:260`) and the in-process caller
  (`packages/theo/src/server/http/in-process-caller.ts:103`). The sentence *"`callProcedure` runs no
  middleware and no auth"* no longer describes the code.
* **The middleware chain stays on the transport, deliberately.** Both runners remain transport-bound
  — `packages/theo/src/server/http/middleware-runner.ts:7` on `node:http`,
  `packages/theo/src/server/http/web-middleware-runner.ts:20` on `Request` — and the ADR chose that
  (`docs/adr/0001-authorization-is-transport-independent.md:28`): CORS, cookies, CSP and CSRF are
  meaningless in a terminal, and dragging them in-process is the failure the parity rule exists to
  prevent.

The consequence for this surface: authorization is no longer a reason to make the chain
transport-independent. Whatever else the off-web surfaces need from middleware has not been named
yet, and naming it is the prerequisite, not the implementation.

---

## Where this framework can be better

The incumbents converged on a **single middleware file** with a hand-written matcher array and a
regex nobody reviews. That design is the source of most of the defects in this skill: matchers that
match everything, ordering nobody can see, and a chain that cannot be tested without a server. This
framework already rejected the single-file design. Four positions follow from that and are
unclaimed:

### 1. The matcher is a declaration beside the file, not a regex inside it

With one file per concern, each file can declare its own matcher as data:

```ts
export const matcher = { include: ['/**'], exclude: ['/assets/**', '/_health'] }
export default middleware().handle(...).build()
```

Because it is data, the framework can **analyse it at build time**: warn when a matcher matches every
request, report the resolved chain per path, and refuse a matcher that excludes nothing. The
incumbents cannot do this — their matcher is an array in a module that must be evaluated.

The glob machinery for this is already a production dependency and already compiled to predicate
functions: `compileRouteRules` turns a glob into `(path: string) => boolean` via picomatch
(`packages/theo/src/cache/route-rules.ts:12,24-26`). It is exported from
`packages/theo/src/cache/index.ts:43` and has **no production caller** — measured, not assumed. So
this position is a wiring job over an existing primitive rather than a new one.

### 2. `theokit middleware <path>` — the resolved chain, before deploying

The framework knows the files and the order, and with item 1 it would know the matchers. So it can
answer the question that currently requires a deployment:

```text
$ theokit middleware /assets/app.js
(no middleware matches)

$ theokit middleware /dashboard
01-trace.ts      matches
02-headers.ts    matches
03-auth.ts       matches   → may redirect to /login
```

Nothing in the field ships this. Today it would also expose the reach problem above the moment
somebody ran it against a page path, which is an argument for it rather than against it.

### 3. Matchers are unit-testable without a server

A matcher expressed as data is a pure function from URL to boolean. The test table in
`matching-and-ordering.md` becomes a test file the framework can generate a stub for. Today, in every
mainstream framework, that table can only be exercised by starting a server and making requests.

### 4. Per-stage attribution in the dev overlay and in production traces

**Correction to the 2026-08-19 entry.** It read *"The framework already has an observability layer
with spans and trace-context propagation"* and called a span per stage *"a small addition"*. On
2026-08-19 that layer existed but was **unreachable**: `createObservabilityPlugin` had no production
caller and the framework emitted no spans at all.

As of 2026-08-20 it is wired. `packages/theo/src/server/observability-bootstrap.ts:79` resolves the
adapter and `:86` builds the plugin; the boot paths call it
(`packages/theo/src/cli/commands/start/index.ts:94`,
`packages/theo/src/vite-plugin/config-resolve.ts:77`), the plugin now has the `{ name, register }`
shape the loader demands (`packages/theo/src/server/observability/middleware.ts:83-86` against
`packages/theo/src/server/plugins/load-plugins.ts:17-22`), and an `http.request` span is opened per
request (`packages/theo/src/server/observability/middleware.ts:89`).

So the claim is now true, with two conditions the earlier version did not state: telemetry is
**opt-in** — absent an `observability` key in the config (`packages/theo/src/config/schema.ts:198`)
or TheoCloud env vars, the bootstrap returns `undefined`
(`packages/theo/src/server/observability-bootstrap.ts:73-75`) — and the span is per **request**, not
per middleware stage. There is no per-stage span anywhere.

---

## The order

Item 1 changed. The previous ordering put matchers first to remove a per-asset cost that this layer
does not pay; the actual precondition is that the chain reaches something worth matching.

1. **One middleware contract.** usetheokit/theokit#345. Pick the signature the builder already
   publishes or replace the builder, and make the file-scan runner and the Web runner agree with it.
   Everything below is unbuildable while a published builder emits a handler the published runner
   invokes with the wrong arguments.
2. **Reach.** Decide whether middleware runs on the document path
   (`packages/theo/src/cli/commands/start/request-handler.ts:261-262`) and on static
   (`:258`), or whether this layer is documented as API-and-actions-only. Both are defensible; the
   current state is neither, because nothing states it. This is the item that decides whether item 3
   is scoping or dead weight.
3. **Matchers as declarations**, with include and exclude patterns, over the picomatch predicates
   that already exist (`packages/theo/src/cache/route-rules.ts:24-26`).
4. **A default exclusion set** applied unless a middleware opts out: build output, well-known files,
   probes, framework-internal paths, source maps. Cheap, and it prevents the
   health-check-behind-auth failure the day item 2 widens the reach.
5. **Build-time matcher analysis**: warn on a matcher that matches everything, and on one with no
   exclusions.
6. **`theokit middleware <path>`**, printing the resolved chain and the actions each stage may take.
7. **Matcher unit-test support**, with a generated stub table.
8. **`rewrite` in the action vocabulary**, with a depth-based loop guard and the original URL
   preserved in a header for logs, analytics and canonicals. `proxyFetch`
   (`packages/theo/src/services/runtime/proxy.ts:69`) already implements the hop-by-hop and
   path-scope half of this and is currently unreachable from the request path.
9. **A span per middleware stage**, through the now-wired observability layer
   (`packages/theo/src/server/observability/middleware.ts:86`).
10. **A declared failure posture per stage** — fail open or closed — required for any stage that
    performs I/O, and enforced by the type rather than by review.

Items 1 and 2 are the milestone. Item 1 is what usetheokit/theokit#345 tracks and what M13's first
criterion grades; item 2 is a decision nobody has recorded, and every item after it inherits its
answer.

## Not measured

* **Whether the Vite dev pipeline scopes middleware the same way as `theokit start`.** The dev path
  reaches `executeRoute` through `packages/theo/src/vite-plugin/api-middleware.ts:440`, but the full
  branch order of the dev server was not traced. The production ordering above is measured; the dev
  ordering is assumed to match and was not verified.
* **Whether a builder-produced handler throws or silently aborts.** The contract mismatch is proved
  from the signatures and the call site; the failure was not observed at runtime, so "the chain
  aborts" is inference from `packages/theo/src/server/http/middleware-runner.ts:96-99`, not an
  executed repro.
