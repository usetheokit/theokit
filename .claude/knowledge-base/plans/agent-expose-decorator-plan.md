---
slug: agent-expose-decorator
milestone_id: M47
created_at: 2026-07-14
goal: Ship an `@Expose` decorator + a typed agent handle so exposing an agent is visible in one code review and the frontend binds with no magic string across all 3 surfaces.
---

# Plan — M47: `@Expose` decorator (visible, typed, surface-agnostic agent exposure)

## Goal

Ship an `@Expose(agent, opts?)` controller decorator + a generated typed handle so `useAgent(chat)` binds
an agent with **zero magic strings and zero duplicated input types** across web/TUI/desktop, verified by a
green `.test-d.ts` parity assertion + a passing showcase migration (the `useAgent<{message}>('/api/...')`
anti-pattern deleted).

## Context

From the M47 grill + the SHIPPABLE (99.7) blueprint `knowledge-base/discoveries/blueprints/agent-expose-decorator-blueprint.md`. Dogfooding the
showcase exposed three invisibilities: (1) the agent's route/CSRF/auth live in the scanner convention, far
from `agents/chat.ts`; (2) the frontend link is a magic string; (3) the input type is duplicated. The
blueprint proves the fix: tRPC/Hono type-only handle (`import type` + generic, no codegen for the type),
Fastify/`@Controller` metadata-binding, and TheoKit's OWN `mountAgent` runtime that `@Expose` reuses (one
runtime, new authoring surface — NOT a third path). Grill decisions resolved: `@Expose` is opt-in
(convention stays default); it unifies `@Agent`; surface-agnostic via the handle, not the decorator.

## Baseline Context

### Files that will be touched

| File | LoC | Role today | Change |
|---|---|---|---|
| `packages/http/src/metadata/keys.ts` | 22 | `Symbol.for()` metadata keys (SWC-safe) | ADD `EXPOSE_AGENT` key |
| `packages/http/src/decorators/expose.ts` | (NEW) | — | NEW `@Expose(agent, opts?)` method/prop decorator |
| `packages/http/src/decorators/index.ts` | ~10 | decorator barrel | export `Expose` |
| `packages/http/src/bridge/walk-metadata.ts` | 144 | `walkControllerMetadata` → `WalkResult[]` | read `EXPOSE_AGENT`, mark `agent` on the result |
| `packages/http/src/bridge/create-server.ts` | 339 | `createDecoratorHandler` dispatch | on agent-marked match, return the exposure descriptor (theo delegates to mountAgent) |
| `packages/theo/src/server/http/controller-dispatch.ts` | (exists, #122) | dispatches controller routes in dev | delegate agent-marked routes to `mountAgent` |
| `packages/theo/src/vite-plugin/agents-typed-client.ts` | 202 | emits `.theokit/agents.d.ts` + `useAgent<K>(name)` | ALSO emit named handle `export const <name>` + `useAgent(handle)` type |
| `packages/theo/src/client/use-agent.ts` | 114 | `useAgent(path|transport)` | ADD `useAgent(handle)` overload + handle→transport binders |
| `apps/showcase/server/agents.controller.ts` | (NEW) | — | demonstrate `@Expose` |
| `apps/showcase/app/hooks/use-transcript.ts` | ~40 | `useAgent<{message}>('/api/agents/chat')` | → `useAgent(chat)` (kill string + dup type) |

### Current callers / dependents

- `mountAgent(mod, request, apiKey)` — `packages/theo/src/server/agent/mount-agent.ts:72-127` — the ONE
  runtime both the convention scanner and `@Agent` already use; `@Expose` reuses it (no new runtime).
- `@Controller`/`@Get` metadata → `walkControllerMetadata` (`walk-metadata.ts:89-144`) →
  `createDecoratorHandler` (`create-server.ts:57-101`). `@Expose` adds a metadata key read in the walker.
- Codegen `generateAgentsDts` (`agents-typed-client.ts:56-99`) already emits `import type _agent_<name>` +
  `InferAgentInput`/`InferAgentToolNames` (`define-agent.ts:100-109`) — extend to emit a named handle.
- Existing `@Agent` decorator (`packages/agents/src/decorators/agent.ts:43-53`) → `walk-agent-metadata.ts`
  → same `mountAgent`. Reconciliation target.

### Domain glossary

- **Exposure** — the HTTP wire of an agent (path, CSRF, guards). A web concern.
- **Handle** — a client-safe value `{ path }` + phantom `{ input, tools }` types; what `useAgent` binds to.
- **Surface-agnostic** — one handle drives web(HTTP)/TUI(in-process)/desktop(channel) via M41 transports.

### Architecture boundaries affected

`@theokit/http` owns the decorator + metadata + walker (G1: http does not import agents/theo). `packages/theo`
owns the dispatch-to-`mountAgent` delegation + the codegen (theo depends on http + agents). G2 intact —
`@Expose` is exposure/wiring, `mountAgent` (SDK-backed) is the only runtime.

## Prior Art & Related Work

Internal blueprint `knowledge-base/discoveries/blueprints/agent-expose-decorator-blueprint.md` (SHIPPABLE
99.7): tRPC `createTRPCClient.ts:40-48` (type-only handle), Hono `client.ts:133` (`hc<AppType>`), Fastify
`decorate.js:19-34` (scope binding), ai-sdk `http-chat-transport.ts:128` (magic-string anti-pattern), own
#122 seams. #122 (`@Controller` infra) is the substrate. M41 (unified client), M46 (thread) are the base.

## ADRs

### ADR-M47-1 — `@Expose` is a new authoring surface over the EXISTING `mountAgent` runtime
`@Expose` stores metadata; the walker + dispatcher delegate to `mountAgent`. **Alternatives rejected:** a
parallel agent handler in `@theokit/http` (duplicates `mountAgent`, G2 breach, recreates "two paths"). Cites
blueprint decision D-one. Rule: architecture.md (adapters implement, no runtime dup), G2.

### ADR-M47-2 — Typed handle = type-only inference + a tiny generated path value
Types via `import type` + generics (tRPC/Hono, no type-codegen); generate only the named handle const
carrying the path string (an agent has a per-name URL the client must know — unlike tRPC's single endpoint).
**Alternatives rejected:** hand-written client per agent (duplication); full client codegen (inference
suffices per tRPC/Hono). Cites blueprint decision D-two.

### ADR-M47-3 — `@Agent` reconciled to the `@Expose` path (grep-gated), not kept parallel
`@Agent` registers via the same metadata/`mountAgent` path (thin alias) OR is deprecated with a warning +
codemod note; a grep gate proves 0 parallel exposure runtime. **Alternative rejected:** keep both
independent (reintroduces the roadmap root "two competing paths"). Cites blueprint decision D-three.

## Dependency Graph

Phase 1 (decorator + walker + dispatch) → Phase 2 (codegen handle + `useAgent(handle)`) → Phase 3
(surface binders + `@Agent` reconciliation) → Phase 4 (showcase + integration validation). Phase 2 depends
on Phase 1's metadata shape; Phase 3 depends on Phase 2's handle; Phase 4 depends on all.

## Phases

### Phase 1 — `@Expose` decorator + metadata + dispatch delegation

**Task 1.1 — `EXPOSE_AGENT` metadata key + `@Expose(agent, opts?)` decorator.**
- **Files to edit:** `packages/http/src/metadata/keys.ts`, `packages/http/src/decorators/expose.ts` (NEW), `packages/http/src/decorators/index.ts`.
- **Why this step:** the blueprint T2 seam — metadata via `Symbol.for()` is how every #122 decorator binds; `@Expose` mirrors `@Post` but stores the agent + options instead of a verb. Reasoning: reuse the exact `setMeta` pattern (`decorators/methods.ts:11-28`) so the walker picks it up with no new machinery (ADR-M47-1).
- **Deep dependency analysis:** `keys.ts` is imported by every decorator + the walker; adding a key is additive. `@Expose` is a NEW export from the `http` barrel — a caller/test must exist (Phase 4 showcase + Task 1.3 test).
- **TDD (RED first):** `packages/http/tests/unit/expose-decorator.test.ts` — `test_expose_stores_agent_and_opts_in_metadata` (apply `@Expose(fakeAgent, {csrf:true})` to a class method; assert `getMeta(EXPOSE_AGENT, target)` returns `{ agent: fakeAgent, opts: {csrf:true}, propertyKey }`). Assertion API: `expect(getMeta(...)).toEqual(...)`.
- **Concurrency tests:** (none — single-threaded metadata).
- **Acceptance:** `@Expose` stores `{agent, opts, propertyKey}` under `EXPOSE_AGENT`; exported from `@theokit/http`.
- **DoD:** `pnpm --filter @theokit/http test` green; `@theokit/http` barrel exports `Expose`; file < 500 LoC.

**Task 1.2 — `walkControllerMetadata` surfaces the agent binding.**
- **Files to edit:** `packages/http/src/bridge/walk-metadata.ts`.
- **Why this step:** the dispatcher only sees what the walker returns; to serve an agent, the `WalkResult` must carry the bound agent. Reasoning: the blueprint's exact hook (`walk-metadata.ts:118-140`) — read `EXPOSE_AGENT` per method alongside `ROUTE_METHODS`, add `agent?: { module, opts }` to the result.
- **Deep dependency analysis:** `WalkResult` is consumed by `createDecoratorHandler` + the theo controller-dispatch; adding an optional field is additive (existing routes get `agent: undefined`).
- **TDD (RED first):** extend `packages/http/tests/unit/walk-metadata.test.ts` (or NEW) — `test_walk_marks_agent_bound_method` (a controller with `@Expose`-marked method → the `WalkResult` has `agent` set; a normal `@Get` method has `agent` undefined). 
- **Concurrency tests:** (none).
- **Acceptance:** `WalkResult.agent` populated iff `@Expose` present; back-compat for non-agent routes.
- **DoD:** http tests green; `walk-metadata.ts` stays < 500 LoC.

**Task 1.3 — Dispatch delegates agent-bound routes to `mountAgent` (dev + the http handler descriptor).**
- **Files to edit:** `packages/http/src/bridge/create-server.ts` (expose the agent descriptor on match), `packages/theo/src/server/http/controller-dispatch.ts` (delegate to `mountAgent`).
- **Why this step:** closes the loop — a matched agent route must stream `UIMessageStream` via the ONE runtime, not call a JSON method (ADR-M47-1). Reasoning: `create-server.ts` (http, no theo import) returns the descriptor incl. `agent`; theo's `controller-dispatch.ts` (which CAN import `mountAgent`) invokes it — respecting G1 (http ⊄ theo).
- **Deep dependency analysis:** `controller-dispatch.ts` already bridges #122 controllers into dev; it imports `mountAgent`. The CSRF/guard pipeline already runs before dispatch (G5 shared guards).
- **TDD (RED first):** `tests/integration/expose-agent-serve.test.ts` — `test_exposed_agent_streams_uimessagestream` (a `@Expose`-bound controller in a temp app → `POST /api/agents/chat` with `X-Theo-Action:1` streams `start/text-delta/finish` from a mock agent, identical shape to the convention route); `test_exposed_agent_enforces_csrf` (no header → 403).
- **Failure scenarios:** see `## Failure scenarios`.
- **Concurrency tests:** (none — request-scoped).
- **Acceptance:** agent route streams via `mountAgent`; CSRF/guards enforced; convention route unchanged.
- **DoD:** integration test green; grep proves the agent path calls `mountAgent` (no duplicated streaming).

### Phase 2 — Typed handle codegen + `useAgent(handle)`

**Task 2.1 — Emit a named client-safe handle + `useAgent(handle)` type.**
- **Files to edit:** `packages/theo/src/vite-plugin/agents-typed-client.ts`, `packages/theo/src/client/use-agent.ts`, `packages/theo/src/client/agent-handle.ts` (NEW — the `AgentHandle<TInput,TTools>` type + `{path}` runtime shape).
- **Why this step:** DoD (3) — kill the magic string + duplicated type. Reasoning: blueprint decision D-two — the generator already emits `import type _agent_<name>`; add `export const <name>: AgentHandle<InferAgentInput<_agent_<name>>, InferAgentToolNames<_agent_<name>>>` (type-only type + `{path}` value) and a `useAgent(handle)` overload typed from the handle. cmd-click on `<name>` hops to `agents/<name>.ts`.
- **Deep dependency analysis:** `agents-typed-client.ts` `generateAgentsDts` + the runtime `load()` (`:195-200`) both change; the runtime module must now EXPORT the handle values (path strings), not just re-export `useAgent`. `use-agent.ts` gains an overload — additive, existing `useAgent(path)`/`useAgent(transport)` untouched (M41).
- **TDD (RED first):** `tests/unit/agents-typed-client.test.ts` — `test_codegen_emits_named_handle` (generated `.d.ts` contains `export const chat: AgentHandle<...>` + `useAgent(handle: AgentHandle...)`); `tests/unit/agent-handle.test-d.ts` — `test_useAgent_handle_send_typed_from_input` (`expectTypeOf(useAgent(chat).send).parameter(0).toEqualTypeOf<{message:string}>()` — NO duplication).
- **Concurrency tests:** (none — codegen + type).
- **Acceptance:** named handle emitted; `useAgent(chat)` typed from the agent's `.input()`; cmd-click traces; `messages`/`thread` (M46) unchanged.
- **DoD:** theo unit + type tests green; `tsc` clean; generated `.d.ts` snapshot updated.

### Phase 3 — Surface binders + `@Agent` reconciliation

**Task 3.1 — Handle surface binders (`.inProcess()`/`.channel(src)`) + reconcile `@Agent`.**
- **Files to edit:** `packages/theo/src/client/agent-handle.ts` (binders), `packages/agents/src/decorators/agent.ts` (alias/deprecate), `packages/theo/src/client/use-agent.ts` (accept handle-derived transport).
- **Why this step:** DoD (2)+(4) — the SAME handle drives 3 surfaces (blueprint T4) and there is ONE exposure path (ADR-M47-3). Reasoning: the handle exposes `.inProcess(runner)` → `InProcessTransport` and `.channel(src)` → `ChannelTransport` (M41/M42), so `useAgent(chat)` (web), `useAgent(chat.inProcess(...))` (TUI), `createAgentClient(chat.channel(src))` (desktop) all share the handle. `@Agent` registers via the `EXPOSE_AGENT` path or emits a deprecation warning.
- **Deep dependency analysis:** binders wrap the existing `InProcessTransport`/`ChannelTransport` (no new transport). `@Agent` change must not break existing `@Agent` users (alias keeps them working).
- **TDD (RED first):** `tests/unit/agent-handle.test.ts` — `test_handle_inProcess_returns_inprocess_transport`, `test_handle_channel_returns_channel_transport`; `tests/unit/agent-reconciliation.test.ts` — `test_Agent_decorator_registers_via_expose_path` + a grep-gate test asserting no parallel agent HTTP handler exists.
- **Concurrency tests:** (none).
- **Acceptance:** one handle → 3 transports; `@Agent` on the single path; grep proves no parallel runtime.
- **DoD:** theo + agents tests green; `grep` gate green.

### Phase 4 — Showcase migration + Integration Validation

**Task 4.1 — Migrate showcase to `@Expose` + typed handle; full validation.**
- **Files to edit:** `apps/showcase/server/agents.controller.ts` (NEW), `apps/showcase/app/hooks/use-transcript.ts` (→ `useAgent(chat)`), `packages/theo/CHANGELOG.md`, `docs/agents/agent-client.md`, `.claude/knowledge-base/adrs/0059-*.md`, changeset.
- **Why this step:** the DoD's living proof — the showcase demonstrates `@Expose` and drops the raw-string+duplicated-type anti-pattern. Reasoning: proves the DX end-to-end (agent built separately + `@Expose` controller + typed `useAgent(chat)`), the exact pattern the milestone sells.
- **TDD:** showcase `tsc` clean + `use-transcript.test.ts` green against the handle; a scaffold/template parity check that the TUI + desktop templates can consume the handle (or documented as a follow-on if the templates don't yet ship handles).
- **Failure scenarios:** malformed stream → mountAgent error path surfaces (Phase 1 already covers).
- **DoD:** full `pnpm --filter theokit test` green; `tsc` clean; `eslint packages/ --max-warnings=0`; showcase `use-transcript.ts` uses `useAgent(chat)` (no string, no dup type); ADR-0059 + CHANGELOG (`minor`) + changeset; docs updated.

## Coverage Matrix

| Goal/DoD claim | Task |
|---|---|
| `@Expose` binds agent → visible exposure (route/auth/csrf) in a controller | 1.1, 1.2, 1.3 |
| Design ADR GATE (opt-in; unifies @Agent; exposure-only; surface-agnostic) | ADR-M47-1/2/3 (this plan) |
| Agent route streams UIMessageStream via mountAgent (one runtime) | 1.3 |
| Typed handle: no magic string, no duplicated type, cmd-click traces | 2.1 |
| Same handle drives web/TUI/desktop | 3.1 |
| @Agent reconciled (0 parallel path, grep-gated) | 3.1 |
| Showcase migrated + ADR + changeset + docs | 4.1 |

## Failure scenarios

- **mountAgent throws (bad input / provider error) on an `@Expose` route** — the stream must surface the
  error like the convention route (not a 500 HTML). Test: mock `mountAgent` to throw → assert the SSE
  error/`error` chunk path, same as the convention route. Reproduced in `expose-agent-serve.test.ts`.
- **`@Expose` on a route whose agent module fails to load** — fail-fast with a typed error naming the
  controller + property (not a silent 404). Test asserts the typed error message.

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| `@Agent` reconciliation reintroduces "two paths" if done additively | HIGH | ADR-M47-3 GATE: alias/deprecate to ONE path; grep-gate test proves no parallel runtime (Task 3.1) | impl |
| Surface-agnostic abstraction leaks HTTP assumptions (CSRF) into in-process TUI/desktop | HIGH | exposure (CSRF/guards) stays in the `@Expose`/controller layer; handle binders carry request-context (M43); per-surface test (Task 3.1) | impl |
| Handle needs a runtime value (path) → not pure type-only like tRPC | MEDIUM | ADR-M47-2: a tiny generated `{path}` const is unavoidable (agents have per-name URLs); still type-only for the TYPE | impl |
| Codegen change breaks the existing `useAgent('name')` overload | MEDIUM | additive overload; back-compat test keeps `useAgent('name')` + `useAgent(path)` + `useAgent(transport)` green | impl |

## Unresolved Questions

- Handle binding form: property (`@Expose(chatAgent) chat!: typeof chatAgent`) vs method — resolved during
  Phase 1 RED (pick the shape the walker reads most cleanly); default: property (matches the DX sketch).
- Path derivation: derived-from-agent-name vs explicit in `@Expose(agent, {path})` — default derive, allow
  override (matches `@Controller` prefix + name convention). Resolved in Task 1.1.

## Global Definition of Done

Every task's DoD met; full `pnpm --filter theokit test` + `@theokit/http` + `@theokit/agents` suites green;
`tsc --noEmit` clean across touched packages; `eslint packages/ --max-warnings=0`; grep-gate proves ONE
exposure path; showcase migrated with `useAgent(chat)`; ADR-0059 + CHANGELOG (`minor`) + changeset; docs
updated. Integration Validation phase (Task 4.1) is the eat-your-own-cooking gate.
