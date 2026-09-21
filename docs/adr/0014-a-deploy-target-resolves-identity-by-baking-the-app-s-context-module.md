# 0014 — A deploy target resolves identity by baking the app's context module

- Status: Accepted
- Date: 2026-09-21
- Deciders: the autonomous chain, under `rules/autonomy-envelope.md § A structural decision the
  contract wants recorded`

## Context

`B-185` requires that a deployed target answer `GET /api/agents/{name}/approvals` with the same
scoping the dev path installed — "an unauthenticated caller refused, an authenticated non-owner
refused, **an owner served**".

The third case is the one that has no mechanism. The framework reads a caller's identity with
`subjectFromContext(ctx)` (`packages/theo/src/core/contracts/route-policy.ts:58`), which returns `ctx.subject`. On the
Node path that key is set by the application's `server/context.ts`, reached through
`createServerContext` (`server/http/middleware-runner.ts`), which does exactly three things: locate
`context.ts` with `existsSync`, load it with `loadModule`, and call its `createContext({request,
response})`.

A Worker has none of the first two. Measured on 2026-09-21: with `serverDir: undefined` —
the only value a Worker could supply — `createAgentSubjectResolver` takes the
`produced = {}` branch (`packages/theo/src/server/http/resolve-agent-subject.ts:86`), never touches `req`, `res` or
`loadModule`, and returns `subjectFromContext({})`, which is `null`. So emitting that resolver into
the deploy fragment would produce a resolver that provably resolves to `null` for every caller,
while the plan claimed an owner was served.

## Decision

**A deploy target without a filesystem** — the Cloudflare Worker — bakes the application's
`server/context.ts` as a static import, exactly as it already bakes routes, agent modules and
plugins, and the emitted fragment calls the baked `createContext` directly rather than going through
`createServerContext`.

**A deploy target with a filesystem** — Bun and Deno — does not bake. It passes the `serverDir` it
already emits into the fragment and uses `createAgentSubjectResolver` unchanged.

### Amended 2026-09-21, before implementation

The first version of this ADR decided baking for all three, and `vera-technical-arbiter` returned
the plan that carried it. The contradiction was five lines above a citation this ADR already used:
`deployed-agents.ts:74-79` states that *"Bun and Deno DO have a filesystem and already scan their
routes at request time; making them bake would couple an agent's existence to a rebuild for no
gain. The split mirrors the one routes already have on exactly these targets."*

Measured after the return, and it also corrects the reviewer's proposed remedy — cutting the scope
to the Worker alone and leaving a filesystem host with no identity at all:

| adapter | what it emits today | what it needs |
|---|---|---|
| `cloudflare.ts:537` | consumes `ctx?.scanRoutes?.(config.serverDir)` — the ONLY call site of that provider | the baked specifier |
| `bun.ts:95` | `const serverDir = resolve(cwd, …)`, already handed to `executeRoute` at `:188` | that expression threaded into the `scan` source |
| `deno-deploy.ts:69` | `const serverDir = cwd + '/server'`, already handed to `executeRoute` at `:140` | the same |

The reviewer read `renderDenoEntry`'s options type, which carries no `DeployedServerDirOptions`; the
renderer's OUTPUT carries the variable. Both readings are about the same file and only one is about
what runs.

## Rationale

The technique is not new here; it is the established answer to "a Worker has no filesystem", applied
to one more module:

| what is baked | where | since |
|---|---|---|
| route modules | `renderBakedRoutes`, cited at `packages/theo/src/adapters/deployed-agents.ts:21` and `:76` | #369 |
| agent modules | `packages/theo/src/adapters/deployed-agents.ts:176` — `import * as __theoAgentN from '../../${filePath}'` | current |
| plugin modules | `packages/theo/src/adapters/deployed-plugins-module.ts:12` — "the road `renderBakedRoutes` already takes" | current |
| **the context module** | **nothing — measured 0 occurrences across `src/adapters/`** | **this ADR** |

`createServerContext`'s non-portable half is the lookup, not the call. Baking removes the lookup and
leaves the call, which is portable by construction.

## Who is affected

Found by searching for importers of the fragment generator rather than recalled:

- `adapters/cloudflare.ts`, `adapters/bun.ts`, `adapters/deno-deploy.ts` — the three adapters that
  import `deployed-agents`, and the same three that already import `planDeployedPlugins`
- `adapters/types.ts` — the shared shape
- Any application deploying to those targets whose `server/context.ts` sets `ctx.subject`

## What would break, and what would not

Bun and Deno are unaffected by the paragraphs below: they keep `createServerContext` and its
`existsSync`/`loadModule` route, so nothing about their contract changes.

**Additive** for a Worker application whose `createContext` reads headers or cookies. That is the
documented and overwhelmingly common case: `packages/theo/src/server/http/resolve-agent-subject.ts:21` states
"**Headers and cookies: yes. The request body: no.**", and both survive the Node→Web request shape.

**Breaking** for an application whose `createContext` reads Node-only members of `req`/`res`. It
receives `{ request, response }`, and on every deploy target those are the `ShimRequest` /
`ShimResponse` that `createWebShim` synthesises over a Web `Request` — not real Node objects.

Measured 2026-09-21, correcting an earlier draft of this paragraph that called them "Web-shaped":
all three adapters already build that shim (`cloudflare.ts:420`, `bun.ts:183`, `deno-deploy.ts:135`),
so this is the contract routes on those targets have been crossing since the baked-routes work. The
boundary is not new; what is new is that the agent surface now crosses it too.

**This also narrows what the decision above rests on.** A Worker is not short of `req`/`res` — the
shim gives it both, exactly as it gives them to Bun and Deno. It is short of a **filesystem on which
to find `context.ts`**, which is `deployed-agents.ts:18`'s fact and ADR-2's. The baked/scan split
follows from that alone.

**Unchanged** on the Node path: `createServerContext` keeps its `existsSync`/`loadModule` route, and
no dev-path caller changes.

## Alternatives rejected

**Pass the `pluginRunner` the adapter already builds.** Strictly smaller — `resolve` already calls
`pluginRunner?.applyDecorations(ctx)`, the three adapters already bake plugins, and only the agent
fragment fails to receive a runner (measured: 0 occurrences of `pluginRunner` in
`adapters/deployed-agents.ts`). Rejected because the shipped default template documents the other
source: `packages/create-theokit/templates/default/src/server/agents/chat.ts:47` — "`subject` is whatever
`server/context.ts` put on `ctx.subject`". Choosing the plugin path would make the test pass without
serving the application the template tells people to write. Worth revisiting as a second source once
the documented one works.

**Refuse the approvals routes on the deploy path.** Fails the item's own second DoD bullet, which
asks for an owner served rather than for everyone refused. A fail-closed refusal is the correct
behaviour *until* this decision ships, and it is not a delivery of the item.

**A deploy-target-specific identity mechanism.** Invents a second notion of identity inside one
product, so an application would answer "who is this caller?" differently depending on where it runs.

## Consequences

`B-185`'s third task grows from "emit a `resolveSubject` into the fragment" to baking a module and
threading its factory. That growth belongs to the item rather than beside it: the item's DoD already
demanded an owner served, and this ADR records what serving one costs. Nothing in the item's recorded
scope widened.
