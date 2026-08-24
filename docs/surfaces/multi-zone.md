# Zones in this framework: closer than the previous measurement said, and deliberately unscheduled

**Measured 2026-08-20** against `packages/theo/src` and `packages/agents/src`.

Two findings, and the second is the one that matters:

1. **There is no TheoKit-to-TheoKit zone concept, and no asset prefix.** Searching both source trees
   for `zone` finds only two unrelated comments; `assetPrefix`, `publicPath` and a Vite `base` return
   nothing. That half of the previous measurement holds.
2. **"No proxy concept exists" was false.** A path-prefix-owning, collision-checked,
   ingress-generating multi-part deployment model already ships and is wired, for polyglot
   *services* rather than for zones. Three of the four "positions available here" in the previous
   version described work this framework has already done once, in the next room.

**M16's status stands, and this file says so plainly.** The ROADMAP records multi-zone as the one
surface where the 2026-08-19 sweep found no blocker, and as deliberately deprioritized. That is
confirmed: nothing here is broken, nothing is dead code, and no criterion is waiting on a fix. A gap
file that manufactured urgency to look useful would be worse than a short one.

## Contents

1. [What exists](#what-exists)
2. [Where this framework can be better](#where-this-framework-can-be-better)
3. [The order](#the-order)
4. [Not measured](#not-measured)

---

## What exists

| Existing capability | Reachable today? | Relevance | Evidence |
|---|---|---|---|
| **A services model with owned path prefixes** | Yes | The nearest thing to a zone map that exists: each service declares a non-root `proxy` prefix, validated by regex | `packages/theo/src/services/schema.ts:51` |
| **Duplicate-prefix rejection** | Yes | Two parts of one deployment cannot claim the same prefix — a build-time refusal, not a runtime surprise | `packages/theo/src/services/schema.ts:122-128` |
| **Duplicate-port and dependency-cycle rejection** | Yes | Same validation pass; `dependsOn` is checked for self-reference, missing targets and cycles | `packages/theo/src/services/schema.ts:112-120,130-146` |
| **Dev-time proxy wiring** | Yes | The Vite dev server's proxy table is generated from the services config | `packages/theo/src/services/adapters-bridge/vite-proxy-builder.ts:42`, called from `packages/theo/src/vite-plugin/config-hook.ts:40` |
| **Production ingress generation** | Yes | A Caddyfile fronting web plus every service, with `reverse_proxy` directives ordered longest-prefix-first | `packages/theo/src/services/generators/caddy-generator.ts:10,23`, called from `packages/theo/src/adapters/node.ts:70` |
| **Cross-boundary cookie policy** | Yes | `passSetCookie` defaults to stripping upstream `Set-Cookie` so a service cannot issue cookies that collide with the encrypted session | `packages/theo/src/services/schema.ts:65`; rationale at `packages/theo/src/services/runtime/proxy.ts:48-53` |
| **Cross-boundary trace continuity** | Yes | The ingress enables Caddy's `tracing` directive and lets `traceparent`, `tracestate` and `baggage` through CORS; the HTTP entry point continues an incoming `traceparent` instead of minting a new id | `packages/theo/src/services/generators/caddy-generator.ts:28,50`; `packages/theo/src/server/http/trace-context.ts:104-108`, used at `packages/theo/src/cli/commands/start/request-handler.ts:233` |
| **A Web-Standards proxy with path scoping** | **Exported, no production caller** | `stripBase` + `isPathInScope` reject out-of-scope paths with a named 400; hop-by-hop headers stripped per RFC 2616 | `packages/theo/src/services/runtime/proxy.ts:69,75-88`, exported at `packages/theo/src/services/index.ts:45` |
| Nine deploy adapters and a registry | Yes | A zone is a deployment; the adapter layer already models targets | `packages/theo/src/adapters/registry.ts:25-34` |
| The route scanner and its manifest | Yes | Each zone could publish its route list — the input to collision detection | `packages/theo/src/server/scan/manifest.ts:66,107` |
| Middleware | Yes, but **only on `/api/*` and actions** | Not where a rewrite to another origin can live today: a rendered document never runs middleware | `packages/theo/src/cli/commands/start/request-handler.ts:257-262` |

**No asset prefix configuration exists** — confirmed, not inherited. Nothing in
`packages/theo/src` or `packages/agents/src` defines `assetPrefix`, `publicPath` or a Vite `base`.
This remains the one item that must be in place **before** a first zone deployment rather than after.

---

## Where this framework can be better

The incumbents treat zones as a documentation pattern: a rewrite rule in a config file, an asset
prefix the reader must remember to set, and no verification of anything. The previous version of this
file said the same of TheoKit and then listed four novel positions. Two of the four were already
half-built and one rested on a false premise. Corrected:

### 1. Zone ownership verified against the route manifests

**Partly already done, for services.** The previous version claimed *"None of this is possible for a
framework that does not own the route table"* and presented all four checks as unclaimed. Measured:

| Check the previous version claimed as unclaimed | Actual status |
|---|---|
| no two zones claim the same path | **Ships**, for exact-duplicate service prefixes (`packages/theo/src/services/schema.ts:122-128`) |
| every route a zone declares falls inside the prefixes it owns | Absent. The route manifest is never compared against the prefix table |
| no path is unclaimed without a declared default | Absent as a check. The generated Caddyfile does give web the catch-all (`packages/theo/src/services/generators/caddy-generator.ts:53`), so there is always a default in practice — it is just never verified |
| no asset prefix overlaps another's | Absent, because no asset prefix exists |

And the check that does ship has a real hole worth naming rather than celebrating: it compares
prefixes for **exact equality** (`new Set(prefixes).size === prefixes.length`), so `/api` and
`/api/v2` both validate and then compete at the ingress, where longest-prefix ordering silently
decides the winner (`packages/theo/src/services/generators/caddy-generator.ts:10`). **Overlap
detection, not duplicate detection, is the unclaimed position.** That is a smaller and much more
credible claim than the one it replaces.

### 2. Asset prefix as a required value, not a remembered one

Unchanged, and confirmed absent. Make the asset prefix a required field when a project declares
itself part of a zone set, and derive it from the zone name by default. The most common multi-zone
defect then cannot be committed — and because it must be set before the first deployment, requiring
it at that moment is exactly right.

This is the only position in this file with no existing counterpart anywhere in the codebase.

### 3. A zone-aware `Link`

**The premise was false.** The previous version asserted *"The framework's `Link` already knows the
route table."* It does not. `Link` wraps react-router's `Link`
(`packages/theo/src/client/link.tsx:13,54`), resolves `to` to a plain string
(`packages/theo/src/client/link.tsx:37-40`) and injects a `<link rel="prefetch">` for it
(`packages/theo/src/client/link.tsx:25-35`). It has no route table, and the docstring says the
prefetch is deliberately `rel="prefetch"` rather than `modulepreload` precisely so that **no manifest
resolution is needed** (`packages/theo/src/client/link.tsx:9-10`).

The position survives, but it costs more than advertised: a zone-aware `Link` needs a zone map handed
to it, which is item 2 of the order below, and it is the reason that item has to exist before this
one.

### 4. The cross-zone contract as a generated artefact

**The nearest precedent is stronger than "a precedent".** The previous version listed the services
manifest as *"A precedent for describing a multi-part deployment"*. It is a working implementation of
one: a validated declaration (`packages/theo/src/services/schema.ts:108-146`) from which the
framework already generates a dev proxy table
(`packages/theo/src/services/adapters-bridge/vite-proxy-builder.ts:42`), a production ingress
configuration (`packages/theo/src/services/generators/caddy-generator.ts:23`) and a local compose
harness (`packages/theo/src/services/generators/compose-generator.ts:66`), and which already encodes
two of the five consistency requirements in `sharing-and-contracts.md` — cookie policy
(`packages/theo/src/services/schema.ts:65`) and trace format
(`packages/theo/src/services/generators/caddy-generator.ts:28,50`).

So the position is not "generate a contract package where none exists". It is: **the zone case is the
services case with a second TheoKit application in place of a Python process**, and the honest
question is whether it needs a second declaration at all or an extension of the one that ships. That
question is cheaper to answer than the artefact the previous version proposed building.

---

## The order

Zones are not an early feature, and this surface is deliberately unscheduled (ROADMAP M16). This
ordering assumes the demand became real — two teams with genuinely conflicting release schedules —
and is not a proxy for slow builds. **Until a second zone exists, item 1 is the only one worth
doing**, and it is worth doing for a reason that has nothing to do with zones.

1. **Asset prefix configuration**, with generated URLs honouring it everywhere: scripts, styles,
   fonts, images, dynamic imports and source maps. Useful on its own for any CDN-hosted deployment,
   the prerequisite for everything else, and the one item here with no partial implementation to
   build on.
2. **Decide whether a zone map is a new artefact or an extension of the services manifest.** New, and
   ahead of everything else, because the services manifest already does most of what a zone map was
   specified to do (`packages/theo/src/services/schema.ts:47-68`). Two overlapping declarations of
   "who owns which prefix" would be the DRY violation this whole surface exists to prevent.
3. **Prefix overlap detection**, extending the exact-duplicate check that ships
   (`packages/theo/src/services/schema.ts:122-128`) to catch `/api` against `/api/v2`. Small, and it
   closes a hole that exists today for services regardless of whether zones are ever built.
4. **Build-time verification** of each zone's route manifest
   (`packages/theo/src/server/scan/manifest.ts:66`) against the prefixes it owns — the check from
   item 1 of the previous section that genuinely does not exist.
5. **Zone-aware `Link`**, emitting document navigation across a boundary. Requires the zone map from
   item 2, because `Link` carries no route knowledge of its own
   (`packages/theo/src/client/link.tsx:37-40`).
6. **A router recipe per adapter**: the same zone map expressed for each deploy target's own routing
   layer, following the Caddyfile generator's shape
   (`packages/theo/src/services/generators/caddy-generator.ts:23`) rather than a hand-written config
   per platform.
7. **The generated contract package**, plus a build assertion on its version — scoped by the answer
   to item 2.
8. **Cross-zone trace continuity verified by a test.** The mechanism already exists on both sides:
   the ingress passes `traceparent` (`packages/theo/src/services/generators/caddy-generator.ts:28`)
   and the entry point continues it rather than minting a new id
   (`packages/theo/src/server/http/trace-context.ts:104-108`). What is missing is the assertion that
   one trace id survives a boundary crossing.

---

## Not measured

* **Whether the services proxy path actually serves traffic in production.** `proxyFetch` is
  exported (`packages/theo/src/services/index.ts:45`) with no caller inside `packages/theo/src`, and
  the production path documented in its own header is the generated Caddyfile rather than this
  function (`packages/theo/src/services/runtime/proxy.ts:4-7`). Whether the function is a
  consumer-facing helper or an orphan was not determined; it is recorded as unreachable-from-here,
  which is the fact, not as dead code, which would be a guess.
* **Whether Vite's own default `base` behaviour is sufficient for a CDN-hosted deployment.** Only
  TheoKit's configuration surface was searched. Vite's built-in `base` may cover part of item 1
  without new framework code, and that was not tested.
* **Session survival across a boundary.** M16's first criterion grades it. The cookie *policy* across
  the services boundary was read (`packages/theo/src/services/schema.ts:65`); no request was made
  across a boundary to observe whether a session survives one.
* **Anything about a second TheoKit zone.** None exists to measure. Every zone-specific statement in
  this file is about machinery built for the services case and reasoned about for the zone case.
