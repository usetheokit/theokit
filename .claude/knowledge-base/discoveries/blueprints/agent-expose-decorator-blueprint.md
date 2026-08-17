---
version: 1.0
slug: agent-expose-decorator
milestone: M47
created: 2026-07-14
sources: trpc, hono, ai-sdk, fastify, theokit(own #122 + codegen)
status: ready-for-confidence
---

# Blueprint: `@Expose` decorator — visible, typed, surface-agnostic agent exposure

## Context

M47 makes the agent↔exposure↔frontend wire visible in one code review. Today the exposure is a scanner
convention (`agents/chat.ts` → `POST /api/agents/chat`), the frontend link is a magic string
(`useAgent('/api/agents/chat')`), and the input type is duplicated. This blueprint distills how SOTA
frameworks (tRPC, Hono) make the server→client link typed + traceable + client-safe, how decorator systems
(Fastify, TheoKit's own #122 `@Controller`) bind a capability to a scope, and where a new `@Expose`
decorator hooks into TheoKit's existing seams — reusing one runtime (`mountAgent`), not adding a third path.

## Objective

Blueprint the patterns for (a) an `@Expose` decorator binding a separately-built agent to a controller
class; (b) a client-safe TYPED handle killing the magic string + duplicated type; (c) a surface-agnostic
exposure feeding web/TUI/desktop; (d) reconciliation with the existing `@Agent` decorator into ONE path.

## Coverage Corner 1 — Integration Tests

- **tRPC round-trip (caller == router).** `references/trpc/packages/tests/server/createCaller.test.ts:6-27`
  — `const createCaller = t.createCallerFactory(appRouter); const caller = createCaller(ctx); expect(await
  caller.hello({who:'world'})).toEqual('hello world')`. The caller's typed shape mirrors the router; the
  test proves a typed invocation produces the same result as the route. **Borrow:** an `@Expose` handle test
  asserts `useAgent(chat)` binds to the SAME endpoint `mountAgent` serves — a client↔route parity test.
- **Hono client-vs-route parity.** `references/hono/src/client/client.test.ts:73,131,162-168` — `type
  AppType = typeof route; const client = hc<AppType>('http://localhost'); const res = await
  client.null.$get(); expectTypeOf(data).toMatchTypeOf<null>()`. Pattern: extract type from app → pass to
  client factory → invoke typed method → assert response type parity. **Borrow:** a `.test-d.ts` asserting
  `useAgent(chat)`'s `send` param equals `InferAgentInput<typeof chatAgent>` (no duplication), plus a
  runtime integration test that the `@Expose`-registered route streams `UIMessageStream` like the
  convention route.

## Coverage Corner 2 — Dependencies

- **Client-safe = no server runtime in the client bundle.** `references/trpc/packages/client/package.json:117-135`
  — the tRPC client has NO `dependencies`, only `peerDependencies` (`@trpc/server`); every server import is
  `import type`. `references/hono/src/client/client.ts:1-4` — `import type { Hono } from '../hono'` (only
  `serialize` from cookie utils is a runtime import). **Borrow:** the generated `@theo/agents` handle must
  carry the agent's input/tools types via `import type` (zero server runtime), and only a tiny runtime value
  (the path string) — reusing `readUIMessageStream`/`ai` already in the client (Rule 9, no new dep).
- **No new dependency needed for M47.** The decorator reuses reflect-metadata (already in `@theokit/http`),
  the codegen reuses the existing `agents-typed-client.ts` generator, and streaming reuses `mountAgent`.

## Coverage Corner 3 — Tools

- **Typed handle = pure `tsc` inference, NO codegen for the TYPE.** `references/trpc/packages/client/src/createTRPCClient.ts:40-48,141-158`
  — types come from generics (`TRPCClient<TRouter>` + `DecoratedProcedureRecord`) resolved by tsc; the build
  (`tsdown.config.ts`) only transpiles. Hono is the same (`hc<AppType>`). **Implication:** the agent handle's
  TYPE can be pure inference, but TheoKit needs a small generated value for the runtime PATH, because unlike
  tRPC's single endpoint, an agent has a per-name URL the client must know.
- **TheoKit's existing generator is the tool.** `packages/theo/src/vite-plugin/agents-typed-client.ts:56-99`
  — `generateAgentsDts()` scans `manifest.agents` and emits `import type _agent_<name>` + the `AppAgents`
  map + the `useAgent<K extends keyof AppAgents>(name: K)` overload. **Change for M47:** additionally emit a
  named handle `export const chat` whose type is `AgentHandle<InferAgentInput<_agent_chat>,
  InferAgentToolNames<_agent_chat>>` and whose runtime value is `{ path: '/api/agents/chat' }` — so
  `useAgent(chat)` is typed AND cmd-click on the generated `chat` hops to `import type _agent_chat from
  '../agents/chat'` (one hop to source). The runtime `@theo/agents` module (`load()` at
  `agents-typed-client.ts:195-200`) gains the handle constants alongside the `useAgent` re-export.

## Coverage Corner 4 — Techniques

- **T1 — Type-only handle + generic (tRPC/Hono).** `references/trpc/packages/client/src/createTRPCClient.ts:40-48`
  (`TRPCClient<TRouter>` generic) + `import type { AppRouter } from './server'`; `references/hono/src/client/client.ts:133`
  (`hc<T extends Hono>`). The client is parameterized on the SERVER TYPE via `import type` → full typing,
  zero runtime, cmd-click traces. **This is the anti-magic-string pattern.** ai-sdk is the counter-example:
  `references/ai-sdk/packages/ai/src/ui/http-chat-transport.ts:128` `api = '/api/chat'` — a plain string,
  untyped, no traceability (exactly what M47 kills).
- **T2 — Decorator binds capability to a scope, guarded (Fastify + #122).** `references/fastify/lib/decorate.js:19-34`
  — `decorate(instance,name,fn,deps)` guards duplicates (`Object.hasOwn`), validates deps, binds via
  `Object.defineProperty`/assignment; scoped variants `decorateRequest`/`decorateReply`. TheoKit's own
  seam: metadata via `Symbol.for()` keys (`packages/http/src/metadata/keys.ts:13-22`, SWC-multi-load-safe),
  stored by `@Controller`/`@Post` (`decorators/controller.ts:50-74`, `methods.ts:11-28`), walked by
  `walkControllerMetadata` (`bridge/walk-metadata.ts:89-144`) into `WalkResult[]`, dispatched by
  `createDecoratorHandler` (`bridge/create-server.ts:57-101`). **`@Expose` hooks here:** add an
  `EXPOSE_AGENT` metadata key; a method/prop `@Expose(agent, opts)` stores `{ agent, opts }`;
  `walkControllerMetadata` reads it (~line 118-140) and marks the `WalkResult` agent-serving; the dispatcher,
  on a match, calls `mountAgent(agent, request, apiKey)` (`packages/theo/src/server/agent/mount-agent.ts:72-127`,
  already the full `UIMessageStream` SSE pipeline) instead of the controller method. Guards (`@UseGuards`)
  already compose in `walk-metadata.ts:114-116` (G5 — shared guards, distinct pipeline).
- **T3 — ONE runtime, multiple authoring surfaces (reconciliation).** The existing `@Agent` class decorator
  (`packages/agents/src/decorators/agent.ts:43-53`, `inferAgentMeta` → `/api/agents/<name>`, walked by
  `walk-agent-metadata.ts:226-330`) AND the file convention (`scanAgents`,
  `packages/theo/src/server/scan/agent-scan.ts:52-83`) AND the new `@Expose` all converge at the SAME
  runtime `mountAgent`. So `@Expose` is NOT a third runtime — it's a new authoring surface. **Reconciliation
  choice (ADR):** `@Expose` becomes the explicit surface; `@Agent` either (a) becomes a thin alias that
  registers via the same `EXPOSE_AGENT` path, or (b) is deprecated with a codemod. A grep gate proves no
  parallel runtime path ships.
- **T4 — Surface-agnostic via the handle, not the decorator.** The `@Expose` decorator declares the HTTP
  exposure (route/csrf/guards) — a WEB concern. The typed HANDLE (`chat`) is what the 3 surfaces share:
  web `useAgent(chat)` (HttpTransport to `chat.path`), TUI `useAgent(chat.inProcess(runner))`
  (InProcessTransport), desktop `createAgentClient(chat.channel(src))` (ChannelTransport). HTTP assumptions
  (CSRF/auth) live in the `@Expose`/controller layer; in-process binders carry request-context (M43). The
  M41 `useAgent(path|transport)` overload (`agents-typed-client.ts:88-96`) already supports both a name and
  an `AgentTransport` — the handle unifies them.

## Cross-cutting comparison

| Dimension | tRPC | Hono `hc` | ai-sdk `useChat` | TheoKit target (M47) |
|---|---|---|---|---|
| Link to server | `import type AppRouter` + generic | `hc<AppType>` generic | **magic string `api`** | typed handle `useAgent(chat)` |
| Traceable (cmd-click) | ✅ to router | ✅ to app | ❌ string | ✅ handle → `agents/x.ts` |
| Client-safe (no server runtime) | ✅ type-only + peerDep | ✅ type-only | n/a (string) | ✅ type-only + tiny path value |
| Type produced by | tsc inference (no codegen) | tsc inference | — | tsc inference + generated path value |
| Exposure visible in one read | router file | route chain | ❌ | ✅ `@Expose` controller |
| Multi-transport | ❌ HTTP links | ❌ HTTP | ✅ transport abstraction | ✅ handle.inProcess()/.channel() (M41) |

## Recommendations (feed the M47 plan/ADR)

1. **`@Expose(agent, opts?)` as a controller method/prop decorator** storing `EXPOSE_AGENT` metadata;
   `walkControllerMetadata` marks agent-serving; dispatcher delegates to `mountAgent`. Reuse `@UseGuards`
   (G5). No new runtime. (Techniques T2.)
2. **Typed handle = generated named const** (`export const chat`) with a phantom type from
   `InferAgentInput`/`InferAgentToolNames` (type-only, tRPC/Hono T1) + a small runtime `{ path }` value.
   `useAgent(chat)` overload added next to the existing `useAgent('name')`/`useAgent(transport)` overloads.
   Kills the magic string + duplicated type. (Techniques T1 + Tools.)
3. **Surface-agnostic through the handle, not the decorator** — `@Expose` declares HTTP; the handle exposes
   `.inProcess()`/`.channel(src)` binders reusing the M41 transports. HTTP assumptions never leak into core.
   (Techniques T4.)
4. **Reconcile `@Agent` into the same path** — alias or deprecate-with-codemod; grep gate proves one path.
   (Techniques T3.)
5. **Tests:** `.test-d.ts` parity (handle `send` == `InferAgentInput`) mirroring Hono
   `client.test.ts`; a round-trip integration test that the `@Expose` route streams identically to the
   convention route, mirroring tRPC `createCaller.test.ts`.

## ADRs (candidates for the M47 design GATE)

### D1 — `@Expose` is a NEW authoring surface over the EXISTING `mountAgent` runtime, not a third runtime path
- **Decision:** `@Expose` stores metadata; `walkControllerMetadata` + `createDecoratorHandler` delegate to
  `mountAgent` (the same runtime the convention + `@Agent` use). **Alternative rejected:** a parallel agent
  HTTP handler inside `@theokit/http` — would duplicate `mountAgent` (G2 violation) and re-create the "two
  paths" root problem. **Evidence:** `mount-agent.ts:72-127`, `walk-metadata.ts:89-144`,
  `create-server.ts:57-101`.

### D2 — The typed handle is type-only + a tiny generated path value; NOT full codegen of the client
- **Decision:** follow tRPC/Hono — types via `import type` + generics (no codegen for the type); generate
  only the named handle const (path string) so the client knows the URL. **Alternative rejected:** a fully
  hand-written client per agent (duplication) OR a heavy codegen of the whole client (tRPC/Hono prove pure
  inference suffices for the type). **Evidence:** `createTRPCClient.ts:40-48`, `hono/client.ts:133`,
  `agents-typed-client.ts:56-99`.

### D3 — `@Agent` reconciled by aliasing to the `@Expose` path (grep-gated), NOT kept as a parallel decorator
- **Decision:** `@Agent` registers through the same `EXPOSE_AGENT`/`mountAgent` path (alias) or is deprecated
  with a codemod; a grep proves 0 parallel exposure runtime. **Alternative rejected:** keep both decorators
  independent — reintroduces the roadmap's root "two competing paths" problem. **Evidence:**
  `agents/src/decorators/agent.ts:43-53`, `walk-agent-metadata.ts:226-330`.

## Key evidence citations

- tRPC type-only handle: `references/trpc/packages/client/src/createTRPCClient.ts:40-48,141-158`; client
  package.json no deps `:117-135`; round-trip `references/trpc/packages/tests/server/createCaller.test.ts:6-27`.
- Hono `hc<AppType>`: `references/hono/src/client/client.ts:133,1-4`; parity test
  `references/hono/src/client/client.test.ts:73,131,162-168`.
- ai-sdk magic string (anti-pattern): `references/ai-sdk/packages/ai/src/ui/http-chat-transport.ts:128,62-67`.
- Fastify decorate: `references/fastify/lib/decorate.js:19-34`.
- Own #122 seam: `packages/http/src/metadata/keys.ts:13-22`, `bridge/walk-metadata.ts:89-144`,
  `bridge/create-server.ts:57-101`; mount `packages/theo/src/server/agent/mount-agent.ts:72-127`.
- Codegen: `packages/theo/src/vite-plugin/agents-typed-client.ts:56-99,195-200`; inference
  `packages/agents/src/bridge/define-agent.ts:100-109`.
- Existing `@Agent` + convention: `packages/agents/src/decorators/agent.ts:34-53`,
  `packages/agents/src/bridge/walk-agent-metadata.ts:226-330`, `packages/theo/src/server/scan/agent-scan.ts:52-83`.
