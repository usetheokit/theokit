---
version: 1.0
slug: agent-expose-decorator
owner: paulohenriquevn
created: 2026-07-14
milestone: M47
status: ready-for-edge-cases
---

# Discovery Plan — `@Expose` decorator: visible, typed, surface-agnostic agent exposure

## Context

M47 introduces an `@Expose` decorator so the agent↔exposure↔frontend wire is visible in one code review.
Dogfooding the showcase (2026-07-14) made the pain concrete: the agent's route/CSRF/auth live in the
scanner convention (far from `agents/chat.ts`), the frontend link is a magic string
`useAgent('/api/agents/chat')`, and the input type is DUPLICATED (`useAgent<{message:string}>` repeats
`.input(z.object({message}))`). Before writing `@Expose`, we must learn how SOTA frameworks make the
server→client exposure link EXPLICIT + TYPED + traceable, and how decorator/controller systems bind a
resource to its exposure — so the design ADR (the M47 DoD GATE) rests on prior art, not invention.

This plan complies with `rules/architecture.md` (the exposure is a boundary/adapter concern, not runtime),
`rules/system-design-guardrails.md` G2 (no agent-runtime reimplementation — exposure/wiring only) and G4
(HTTP can be inferred; AI tool capability must be explicit), and `rules/testing.md` (every borrowed
technique must be coverable by unit + integration tests).

## Objective

Produce a blueprint of patterns for: (a) an `@Expose` decorator that binds a separately-built agent to a
controller-style class making route/auth/csrf visible; (b) a client-safe TYPED handle so `useAgent(handle)`
kills the magic string + duplicated input type and cmd-click traces to the agent source; (c) a
surface-agnostic exposure feeding web(HTTP)/TUI(in-process)/desktop(channel) from ONE declaration; (d) how
to reconcile with the existing `@Agent` decorator so there is ONE exposure path.

**Success criterion:** every research question answered with a file:line citation from
`knowledge-base/references/` (or the repo's own `packages/http/src`), and the four coverage corners
populated so `/to-plan` can write the M47 plan without re-investigating.

## In-scope / Out-of-scope

| Project | In scope | Out of scope |
|---|---|---|
| `references/trpc` | `packages/server/src/{index.ts,unstable-core-do-not-import/router.ts}`, `packages/client/src/{createTRPCClient.ts,links.ts}` + one `*.test.ts` | React Query adapter internals; the v10→v11 migration history |
| `references/hono` | `src/client/{client.ts,index.ts,client.test.ts}` | middleware/router internals unrelated to the typed client |
| `references/fastify` | `lib/{decorate.js,plugin-utils.js}` | the full lifecycle/hooks engine |
| `references/ai-sdk` | `packages/react/src/use-chat.ts` | Vue/Svelte ports; provider adapters |
| repo `packages/http/src` (own #122) | `decorators/{controller.ts,methods.ts,set-metadata.ts,params.ts}`, `bridge/{register-controllers.ts,create-server.ts}` | swc-loader internals (already understood in #122) |

## ADRs (how to investigate)

- **ADR-D1 — Reference budget.** trpc: 3h (the load-bearing typed-handle prior art); hono: 1.5h; fastify:
  1h; ai-sdk: 1h; own #122: 1.5h. Halt per-question at the budget; record partials honestly.
- **ADR-D2 — Own code counts as a reference.** The #122 `@Controller` infra in `packages/http/src` is the
  substrate `@Expose` extends; citing it is not fabrication (it exists on disk). It anchors the
  "reconcile, don't reinvent" corner.
- **ADR-D3 — Mastra deferred.** Mastra's agent-server is large and Next-adapter-shaped; ai-sdk `use-chat`
  + our own #122 give a tighter answer for the binding pattern. Defer mastra to a follow-up if the ai-sdk
  answer is thin. (Coverage corners stay full without it.)

## Research questions

### Techniques (3)

1. **[Techniques] tRPC typed handle + traceability.** How does the tRPC client bind to a server procedure
   with a TYPE-ONLY import (client bundle pulls no server runtime) so the call is typed and cmd-click
   traces to the router? What carries the input/output types (`AppRouter` export + `inferRouterInputs`)?
   → **Method:** Read `references/trpc/packages/client/src/createTRPCClient.ts`,
   `references/trpc/packages/server/src/index.ts`; Grep `inferRouterInputs|AppRouter|createCaller` in
   `references/trpc/packages/server/src`. → **Answer shape:** the type-export + proxy pattern with
   file:line, and the "type-only, no runtime" mechanism.

2. **[Techniques] Hono `hc<AppType>` + ai-sdk `useChat` binding.** How does Hono's `hc<AppType>` client bind
   to routes from an exported app TYPE (no magic string), and how does ai-sdk `useChat` bind to an endpoint
   (magic string vs handle; where the transport/URL is set)? → **Method:** Read
   `references/hono/src/client/client.ts`, `references/hono/src/client/index.ts`;
   `references/ai-sdk/packages/react/src/use-chat.ts` (grep `api|transport|fetch`). → **Answer shape:** the
   two binding models side by side (Hono type-app vs ai-sdk string/transport), file:line.

3. **[Techniques] Decorator binding: Fastify `decorate` + our #122 `@Controller`.** How does Fastify bind a
   capability to a scope via `decorate` + encapsulation, and how does our `@Controller` register routes via
   reflect-metadata + `registerControllers`? What is the metadata seam `@Expose` would reuse to bind an
   agent to a controller class? → **Method:** Read `references/fastify/lib/decorate.js`;
   `packages/http/src/decorators/{controller.ts,set-metadata.ts,methods.ts}`,
   `packages/http/src/bridge/register-controllers.ts`. → **Answer shape:** the metadata-registration seam
   with file:line, and where `@Expose` would hook.

### Integration tests (2)

4. **[Integration tests] tRPC caller round-trip.** How does tRPC test that a client/caller invocation
   produces the SAME result as going through the router (proving the typed handle is faithful)? → **Method:**
   Read a `references/trpc/packages/server/src/unstable-core-do-not-import/router.test.ts` (grep
   `createCaller`). → **Answer shape:** the round-trip test pattern to mirror for the `@Expose` handle.

5. **[Integration tests] Hono `hc` client test.** How does Hono test the `hc` typed client against real
   routes (type + runtime)? → **Method:** Read `references/hono/src/client/client.test.ts` (grep `hc(`).
   → **Answer shape:** the client-vs-route parity test shape.

### Dependencies (1)

6. **[Dependencies] Client-safe type-only flow.** What does the trpc/hono CLIENT package depend on at
   runtime, proving the typed handle carries NO server runtime into the client bundle (the constraint for a
   client-safe `@theo/agents` handle)? → **Method:** Read `references/trpc/packages/client/package.json`
   `dependencies`; grep for `import type` usage in `references/hono/src/client/client.ts`. → **Answer
   shape:** dependency list + the `import type` mechanism that keeps the handle client-safe.

### Tools (1)

7. **[Tools] Typed-handle generation.** Is the typed handle produced by pure `tsc` type inference (trpc/hono
   — no codegen step) or by a build/codegen step? How does TheoKit's current `.theokit/agents.d.ts`
   generator (`agents-typed-client.ts`) already emit the `useAgent('name')` typed overload, and what would
   change to emit a named handle? → **Method:** Read
   `references/trpc/packages/client/src/createTRPCClient.ts` (inference, no codegen);
   `packages/theo/src/vite-plugin/agents-typed-client.ts`. → **Answer shape:** codegen-vs-inference verdict
   + the exact generator change for a named handle.

## Coverage Matrix

| # | Corner | Method (file/grep) | Verified path exists |
|---|---|---|---|
| 1 | Techniques | Read trpc client/createTRPCClient.ts + server/index.ts; grep inferRouterInputs | ✅ |
| 2 | Techniques | Read hono client/client.ts, index.ts; ai-sdk react/use-chat.ts | ✅ |
| 3 | Techniques | Read fastify/lib/decorate.js; http/src/decorators/controller.ts + bridge/register-controllers.ts | ✅ |
| 4 | Integration tests | Read trpc …/router.test.ts (grep createCaller) | ✅ |
| 5 | Integration tests | Read hono src/client/client.test.ts | ✅ |
| 6 | Dependencies | Read trpc client/package.json; grep `import type` in hono client.ts | ✅ |
| 7 | Tools | Read trpc createTRPCClient.ts; theo vite-plugin/agents-typed-client.ts | ✅ |

100% of questions map to ≥ 1 method; every cited path verified on disk (Step-3 pre-validation). No corner empty.

## Halt-loop checkpoints (for `/discover-execute`)

A question is DONE when: its method ran (file read / grep executed), the answer is captured with a file:line
citation, and the blueprint corner it feeds has ≥ 1 concrete pattern. A question is BLOCKED (not DONE) if a
cited path 404s at execute time — record the blocker, do not fabricate.

## Acceptance Criteria

- All 7 questions answered with file:line citations from real paths.
- Four blueprint corners (Integration tests / Dependencies / Tools / Techniques) each populated.
- At least 2 ADR candidates surfaced for the M47 design (e.g., "named handle via codegen vs tsc-only",
  "@Agent → alias-of-@Expose vs deprecate").
- No fabricated citation.

## Global Definition of Done

Blueprint scored by `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS per
`rules/discover-blueprint-golden-rule.md` (4 coverage corners populated, no fabricated citation). Feeds
`/to-plan agent-expose-decorator --milestone M47`.
