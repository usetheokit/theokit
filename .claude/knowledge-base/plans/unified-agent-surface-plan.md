---
slug: unified-agent-surface
milestone_id: M2
created_at: 2026-07-04
goal: A top-level agents/<name>.ts file auto-wires an SSE endpoint plus an end-to-end typed client binding, converging the @Agent decorator and the file convention onto one canonical surface
---

# Plan: Unified zero-config agent surface (M2 — Eixo B)

> **Version 1.0** — One file `agents/<name>.ts` (top-level, LOCKED naming) becomes a
> fully-wired agent: SSE route `POST /api/agents/<name>` + a typed client binding, zero
> manual server wiring. Reuses the M0/M1 canonical protocol unchanged
> (`translateToUIMessageStream` + `uiMessageStreamResponse`). Introduces `defineAgent()`
> in `@theokit/agents` as the canonical zero-config surface; `@Agent` stays the advanced
> surface. Grounded in blueprint `unified-agent-surface` + the LOCKED naming decision.

## Goal

> Enable a TheoKit app to ship an agent by creating a single top-level file
> `agents/<name>.ts` (exporting `defineAgent({...})`) with **no server route file and no
> client fetch wiring**: at dev and at build the framework auto-mounts
> `POST /api/agents/<name>` streaming the M0/M1 `UIMessageStream`, and the client gets a
> generated typed binding whose request type is inferred from the agent's `input` schema.
> Measured by (a) an integration test asserting the scan+mount produces a working SSE
> endpoint whose chunks equal the M1 translator output, and (b) a typed-client `.d.ts`
> golden fixture asserting `AppAgents['<name>']['input']` = `z.infer<typeof input>`.

## Context

M2 of `ROADMAP.md` (`theokit-ai-first`), depends on shipped M0 + M1. Today an agent is
wired either via the `@Agent` class decorator (`packages/agents/src/decorators/agent.ts:43`,
DI-heavy, auto-mounted by `agentsPlugin`) or hand-written with `defineAgentEndpoint`
(`packages/theo/src/server/define/define-agent-endpoint.ts:169`, yields the **proprietary
`AgentEvent`**). Neither is a zero-config file convention, and neither wires to the M0/M1
canonical `UIMessageStream`. M2 adds the file convention + `defineAgent()` and wires it to
the canonical protocol; M3 then removes `defineAgentEndpoint`/`AgentEvent`.

## Baseline Context (deep review of current state)

| File | LoC | Role | Callers / consumers |
|---|---|---|---|
| `packages/agents/src/index.ts` | ~16 | `@theokit/agents` barrel — re-exports decorators + bridge; **no imperative define API** (the seam) | app agent files, `theokit` framework |
| `packages/agents/src/bridge/ui-message-stream-translator.ts` | ~90 | M0/M1 `translateToUIMessageStream(events,{textId})` — canonical protocol producer | `uiMessageStreamResponse`, agent routes |
| `packages/agents/src/bridge/sdk-adapter.ts` | ~600 | `createSdkAgentStream(compiled)` — runtime both surfaces compile to | `agentsPlugin`, orchestrator |
| `packages/agents/src/bridge/agent-compiler.ts` | ~160 | `compileAgent(walkResult)` → `CompiledAgentOptions` | decorator path |
| `packages/theo/src/server/define/ui-message-stream-response.ts` | ~40 | `uiMessageStreamResponse(chunks)` → SSE `Response` | agent routes |
| `packages/theo/src/server/scan/scan.ts` | ~156 | `walkSourceFiles` + `scanServerRoutes` | vite-plugin, manifest |
| `packages/theo/src/server/scan/ws-scan.ts` | ~36 | `scanWebSocketRoutes` — closest one-file-one-endpoint analog | `ws-upgrade.ts`, manifest |
| `packages/theo/src/server/scan/action-scan.ts` | ~188 | `scanServerActionsEnriched` — schema-detection pattern to mirror | actions-virtual-module |
| `packages/theo/src/server/scan/manifest.ts` | ~84 | `TheoManifest` + `generateManifest`/`writeManifest` | build, prod server |
| `packages/theo/src/vite-plugin/configure-server-hook.ts` | ~120 | dev middleware wiring (`serverDir`, action+api middleware order) | vite dev server |
| `packages/theo/src/vite-plugin/action-middleware.ts` | ~90 | dev scan-on-request + `ssrLoadModule` pattern to mirror | configure-server-hook |
| `packages/theo/src/vite-plugin/app-typed-client.ts` | ~424 | `generateClientDts` + `@theo/client` virtual module + watcher | typed client |

- **Git sha at plan time:** `a94e141`.
- **Architecture boundaries:** `@theokit/agents` is the runtime (no vite/theo internals
  imports); `theokit` (the framework) + its `vite-plugin` consume it. Dependency direction
  must stay agents ← theo. Scan roots at `resolve(projectRoot,'agents')` (top-level), NOT
  `serverDir`.
- **Glossary:** *AgentDefinition* = the branded value `defineAgent` returns; *CompiledAgentOptions*
  = the SDK-ready shape both surfaces produce; *AppAgents* = generated typed map of agents.

## Prior Art & Related Work

- **Nuxt/Nitro `server/` + Mastra `agents/`** — the naming decision (agent-surface-naming doc).
- **ai-sdk `useChat` + `DefaultChatTransport`** — the client the generated binding wraps
  (already validated by M0/M1 fixtures).
- **`@theo/client` codegen** (`app-typed-client.ts`) — the `.d.ts` + `import type` alias
  technique the agent typed binding mirrors.
- **`ws-scan` + `action-scan`** — the scan/enrichment techniques the agent scan mirrors.

## Objective

Ship the `agents/*.ts` convention end-to-end (scan → dev+build mount → typed client) wired
to the M0/M1 protocol, plus the ADR converging `@Agent` and the file convention, plus the
ROADMAP M2 directory correction.

## ADRs

### ADR-B1 — `defineAgent` (zero-config file convention) canonical; `@Agent` advanced

- **Decision.** `defineAgent()` in `@theokit/agents` + top-level `agents/*.ts` convention
  is the canonical zero-config surface; `@Agent` class decorator stays the advanced/DI
  surface (a file MAY default-export either — scanner brand-checks and both compile to
  `CompiledAgentOptions`). The convention wires to the M0/M1 protocol, never to
  `defineAgentEndpoint`.
- **Alternatives.** (a) `@Agent`-only → class+decorators for a one-liner (KISS-hostile).
  (b) convention targets `defineAgentEndpoint` → re-entrenches the proprietary `AgentEvent`
  M3 removes. (c) `server/agents/` location → rejected by POLA/naming analysis.
- **Consequence.** `defineAgentEndpoint`/`AgentEvent` become legacy → M3 pure deletion.

### ADR-B2 — ROADMAP M2 directory correction `server/agents/*.ts` → `agents/*.ts`

- **Decision.** Correct the ROADMAP M2 objective + 1st DoD line to top-level `agents/*.ts`.
- **Alternatives.** (a) Keep `server/agents/` → contradicts the LOCKED naming decision the
  user drove. (b) Leave ROADMAP stale + implement `agents/` → silent plan-to-roadmap drift.
- **Consequence.** DoD semantics unchanged (1 file → endpoint + typed client + ADR); only
  the path. Auditable correction, not silent.

## Drawbacks & Risks

1. **Dual default-export shapes** (`defineAgent` value vs `@Agent` class) add scanner
   branching complexity — mitigated by a single brand-check helper + fail-fast on neither
   (EC-1). Risk: a subtle mis-detection routes to the wrong compiler → covered by a
   negative test asserting the typed error.
2. **Dev/build parity** — a convention that works in `dev` (`ssrLoadModule`) but 404s in
   the built server is the historical `ws` failure mode (EC-4). Mitigated by an E2E that
   runs the **built** server, not just dev.
3. **Typed-client codegen coupling** — extending `app-typed-client.ts` risks regressing the
   existing `@theo/client` output. Mitigated by keeping agent codegen in a sibling module
   and asserting the existing client `.d.ts` fixture is byte-unchanged.
4. **Route collision** with a manual `server/routes/api/agents/*` (EC-3) — mitigated by
   reserving the `/api/agents/` prefix + a scan-time collision error.

## Unresolved Questions

(none — the blueprint settled EC-1..EC-5 and both ADRs; naming is LOCKED.)

## Dependencies

| Dependency | Version | Rule 9 (already present?) | CVE gate |
|---|---|---|---|
| `picomatch` | ^4.0.4 | yes — `packages/theo/package.json:122` (scan glob) | n/a (dev-time) |
| `vite` (`ssrLoadModule`, virtual modules) | ^6.4.3 | yes — `packages/theo/package.json:127` | n/a |
| `zod` | ^4 (peer) | yes — input-schema inference | n/a |
| `@theokit/sdk` (via `createSdkAgentStream`) | peer >=2.9.0 | yes | n/a |

No new runtime dependency. All primitives (walker, SSE response, `.d.ts` emitter, SDK
bridge) already exist (Rule 9 — don't reinvent).

## Dependency Graph

```
Phase 1 (defineAgent + agent-scan + manifest)  ─┐
        ↓                                        │
Phase 2 (dev agent-middleware + build mount)  ←──┘  (needs scan + defineAgent)
        ↓
Phase 3 (typed client codegen: AppAgents + useAgent)  (needs scan + input schema)
        ↓
Phase 4 (E2E built-server fixture + ADRs recorded + ROADMAP correction)  (needs 1–3)
```

## Phase 1: `defineAgent()` + agent scan + manifest

#### Objective
Add the imperative `defineAgent()` public API in `@theokit/agents` and the `agent-scan.ts`
scanner (top-level `agents/`), and extend `TheoManifest` with `agents`.

#### Why this step (action + reasoning)
The convention needs a define surface (the seam that does not exist today —
`packages/agents/src/index.ts:1-16`) and a scanner to discover files. Manifest extension is
the build-time contract Phase 2's prod mount reads. Doing define+scan first lets Phases 2–3
consume typed outputs.

#### Evidence
- No imperative define API: `packages/agents/src/index.ts` re-exports decorators+bridge only.
- Scan pattern: `packages/theo/src/server/scan/ws-scan.ts:17-36`, `action-scan.ts:99-188`.
- Manifest: `packages/theo/src/server/scan/manifest.ts:37-76`.

#### Files to edit
- `packages/agents/src/bridge/define-agent.ts` (new) + export in `packages/agents/src/index.ts`
- `packages/theo/src/server/scan/agent-scan.ts` (new)
- `packages/theo/src/server/scan/manifest.ts` (add `agents: AgentNode[]`)

#### Deep file dependency analysis
`define-agent.ts` imports only `zod` types + the compiler input type (no theo/vite).
`agent-scan.ts` imports `walkSourceFiles` from `scan.ts`. `manifest.ts` gains an `agents`
field consumed by build + prod mount (Phase 2).

#### Deep Dives
`defineAgent(config)` is an identity/normalizer (like `defineRoute` `define-route.ts:14-24`)
returning a branded `AgentDefinition<TInput>` carrying the input schema type param. It does
NOT compile at define time — compilation (`compileAgent`) happens at mount so a file import
is cheap. Brand: a non-enumerable `Symbol('theokit.agent')` tag for the scanner brand-check.

#### Pseudo-code / Signatures
```ts
// packages/agents/src/bridge/define-agent.ts
export interface AgentDefinition<TInput extends z.ZodType = z.ZodType> {
  readonly [AGENT_BRAND]: true
  input?: TInput
  model: string
  system?: string
  tools?: AgentTool[]
}
export function defineAgent<TInput extends z.ZodType = z.ZodType>(
  cfg: Omit<AgentDefinition<TInput>, typeof AGENT_BRAND>,
): AgentDefinition<TInput> { return { ...cfg, [AGENT_BRAND]: true } }

// packages/theo/src/server/scan/agent-scan.ts
export interface AgentNode { filePath: string; agentPath: string; name: string }
export function scanAgents(projectRoot: string): AgentNode[] // walks resolve(projectRoot,'agents')
```

#### Tasks
- T1.1 `defineAgent()` + `AgentDefinition` brand + export from `@theokit/agents`.
- T1.2 `scanAgents(projectRoot)` — walk top-level `agents/`, derive `name`/`agentPath`, skip tests.
- T1.3 Extend `TheoManifest` with `agents` + include in `generateManifest`/`writeManifest`.

#### TDD
- T1.1 RED: `test_defineAgent_returns_branded_definition_with_input_schema` — asserts the
  returned value carries the brand + preserves `input`/`model`; `z.infer` of the type param
  compiles (type-level `expectTypeOf`).
- T1.2 RED: `test_scanAgents_maps_file_to_agentPath_and_skips_tests` — fixture dir
  `agents/{support.ts, echo.ts, echo.test.ts}` → `[{name:'support',agentPath:'/api/agents/support'}, {name:'echo',...}]`, `echo.test.ts` excluded.
- T1.3 RED: `test_generateManifest_includes_agents` — manifest JSON has `agents` array
  matching the scan.

#### Concurrency tests (only when applicable)
(none — single-threaded scan + pure normalizer.)

#### Failure scenarios (external I/O)
(none — file-system scan is local; a missing `agents/` dir returns `[]`, asserted in T1.2.)

#### Acceptance Criteria
- `defineAgent` exported from `@theokit/agents`; brand + input type param preserved.
- `scanAgents` returns correct nodes; missing dir → `[]`; test files skipped.
- `TheoManifest.agents` populated at build.

#### DoD
- 3 RED tests green; CHANGELOG `[Unreleased]` updated; no dead exports; agents pkg has no theo import.

## Phase 2: Dev agent-middleware + build/prod mount

#### Objective
Auto-mount `POST /api/agents/<name>` at dev (scan-on-request + `ssrLoadModule`) and in the
built server (manifest-driven), wiring the loaded `AgentDefinition`/`@Agent` to the M0/M1
protocol.

#### Why this step (action + reasoning)
This is the "0 manual server wiring" DoD line. Dev+build parity (EC-4) is the load-bearing
correctness property; both must mount identically or the convention 404s in prod.

#### Evidence
- Dev wiring order + prefix ownership: `configure-server-hook.ts:82-115` (action before api).
- `ssrLoadModule` dev-load: `action-middleware.ts:79`, `ws-upgrade.ts:43`.
- Protocol reuse: `ui-message-stream-translator.ts:36`, `ui-message-stream-response.ts`.
- SDK runtime both surfaces share: `sdk-adapter.ts:439` `createSdkAgentStream`.

#### Files to edit
- `packages/theo/src/vite-plugin/agent-middleware.ts` (new)
- `packages/theo/src/vite-plugin/configure-server-hook.ts` (register agent middleware, `/api/agents/` prefix, before api-middleware)
- `packages/theo/src/server/agent/mount-agent.ts` (new — shared dev+prod: `AgentDefinition|@Agent` → `Response`)
- prod mount in `packages/theo/src/cli/commands/` (read manifest `agents`, mount)

#### Deep file dependency analysis
`mount-agent.ts` is the single wiring point (DRY): brand-check the loaded default export →
`compileAgent` → `createSdkAgentStream` → `translateToUIMessageStream` →
`uiMessageStreamResponse`. Both dev middleware and prod mount call it, guaranteeing parity.

#### Deep Dives
Brand-check helper: default export with `AGENT_CONFIG` metadata (`getMeta`) → decorator path
(`walkAgentMetadata`+`compileAgent`); else `AGENT_BRAND` present → `defineAgent` path
(normalize to `CompiledAgentOptions`); else throw a typed `AgentDefinitionError` naming the
file (EC-1, Rule 8). Collision: if a manual route already claims `/api/agents/<name>`, throw
`AgentRouteCollisionError` with both paths at scan time (EC-3).

#### Pseudo-code / Signatures
```ts
// mount-agent.ts
export async function mountAgent(mod: unknown, req: Request, apiKey: string): Promise<Response> {
  const compiled = compileFromModule(mod)         // brand-check → CompiledAgentOptions | throw
  const { message, sessionId } = await parseAgentRequest(req)
  const events = createSdkAgentStream(compiled, apiKey)(message, sessionId)
  const chunks = translateToUIMessageStream(events, { textId: crypto.randomUUID() })
  return uiMessageStreamResponse(chunks)
}
```

#### Tasks
- T2.1 `mountAgent` shared wiring + brand-check `compileFromModule` + typed errors.
- T2.2 dev `agent-middleware.ts` + register in `configure-server-hook.ts` (prefix, order, collision).
- T2.3 prod mount from manifest `agents` in the built server entry.

#### TDD
- T2.1 RED: `test_mountAgent_streams_uimessagestream_for_defineAgent_module` — a fake
  `AgentDefinition` module + a stubbed `createSdkAgentStream` yielding `[text_delta, done]`
  → response body equals the M1 translator chunks (`start,text-*,finish` + `[DONE]`).
- T2.1 RED (negative): `test_mountAgent_throws_typed_error_on_non_agent_module` — a module
  with neither brand → `AgentDefinitionError` naming the file (assert message, not just throw).
- T2.2 RED: `test_agent_middleware_mounts_and_detects_route_collision` — dev middleware
  serves `/api/agents/support`; a colliding manual route → `AgentRouteCollisionError`.
- T2.3 RED: `test_prod_mount_reads_manifest_agents` — built manifest with one agent → mount
  registers the same path (parity with dev).

#### Concurrency tests (only when applicable)
(none — request handling is per-request; no shared mutable state introduced. The scan cache,
if added, is read-only after build.)

#### Failure scenarios (external I/O)
- SDK stream error mid-run → `createSdkAgentStream` yields an `error` `AgentStreamEvent` →
  M1 translator already maps to a `UIMessageChunk` `error` + `finish`; assert the endpoint
  emits it (no crash). Covered by T2.1 variant with an erroring stub.
- Malformed request body (no `message`) → `parseAgentRequest` returns a 400 typed error, not
  a 500. Asserted in a T2.1 negative case.

#### Acceptance Criteria
- A `agents/support.ts` app serves `POST /api/agents/support` at dev AND build with identical chunks.
- Non-agent module + route collision → typed fail-fast errors naming the file(s).

#### DoD
- 4+ RED tests green; dev+build parity proven; CHANGELOG updated; `mountAgent` is the single wiring point (no duplication).

## Phase 3: End-to-end typed client binding

#### Objective
Generate an `AppAgents` type map + a `useAgent('<name>')` binding whose request type is
`z.infer<typeof input>`, with no manual client wiring.

#### Why this step (action + reasoning)
This is the "typed hook inferred end-to-end" DoD line. Mirrors the proven `@theo/client`
codegen so the type flows from the server `defineAgent({input})` to the client call site.

#### Evidence
- Codegen technique: `app-typed-client.ts:233-270` (`generateClientDts`, `import type` alias).
- Golden fixture shape: `fixtures/server-routes-basic/.theokit/client.d.ts`.
- Client base: `@ai-sdk/react` `useChat` + `DefaultChatTransport` (M0/M1 fixtures).

#### Files to edit
- `packages/theo/src/vite-plugin/agents-typed-client.ts` (new — emit `.theokit/agents.d.ts` + `@theo/agents` virtual module + watcher)
- `packages/theo/src/client/use-agent.ts` (new — thin typed wrapper over `useChat`)
- wire the plugin in `packages/theo/src/vite-plugin/index.ts`

#### Deep file dependency analysis
Agent codegen lives in a sibling module (does NOT touch `app-typed-client.ts`) so the
existing `@theo/client` `.d.ts` stays byte-unchanged (Drawback 3). `use-agent.ts` imports
`useChat` from `@ai-sdk/react` (peer) + `DefaultChatTransport`.

#### Deep Dives
`InferAgentInput<typeof Support>` extracts the `input` Zod type param from the
`AgentDefinition` default export via `import type`. `useAgent('support')` returns `useChat`
pre-bound to `/api/agents/support` with `sendMessage` typed to the inferred input. No new
client runtime — the generated hook only supplies path + request type (KISS).

#### Pseudo-code / Signatures
```ts
// generated .theokit/agents.d.ts
declare module '@theo/agents' {
  import type Support from '../agents/support'
  export interface AppAgents { support: { input: InferAgentInput<typeof Support> } }
}
// packages/theo/src/client/use-agent.ts
export function useAgent<K extends keyof AppAgents>(name: K):
  UseChatHelpers<AppAgents[K]['input']> // useChat bound to /api/agents/<name>
```

#### Tasks
- T3.1 `InferAgentInput` type + `AppAgents` codegen (`generateAgentsDts`).
- T3.2 `agents-typed-client.ts` vite plugin (virtual module `@theo/agents` + `agents/*` watcher) + wire in `index.ts`.
- T3.3 `useAgent` typed wrapper over `useChat`.

#### TDD
- T3.1 RED: `test_generateAgentsDts_maps_input_schema_to_typed_binding` — fixture
  `agents/support.ts` with `input: z.object({message:z.string()})` → emitted `.d.ts`
  contains `support: { input: ... }`; golden compare. Also assert the existing
  `@theo/client` `.d.ts` fixture is byte-unchanged (no regression).
- T3.1 RED: `test_agent_without_input_defaults_to_message_shape` (EC-2) — no `input` →
  binding request type = `{ message: string }`, never `any`.
- T3.3 RED: `test_useAgent_binds_useChat_to_agent_route` — `useAgent('support')` constructs
  a transport with `api:'/api/agents/support'` (assert via a mocked `DefaultChatTransport`).

#### Concurrency tests (only when applicable)
(none — codegen + hook construction are synchronous, no shared state.)

#### Failure scenarios (external I/O)
(none new — the stream failure path is Phase 2; `useChat` surfaces `error` parts already via M1.)

#### Acceptance Criteria
- `.theokit/agents.d.ts` emitted; `AppAgents['support']['input']` = `z.infer<typeof input>`.
- Missing input → `{message:string}` default. Existing `@theo/client` `.d.ts` unchanged.

#### DoD
- 3 RED tests green; no `any` in the typed path; CHANGELOG updated; existing client codegen fixture byte-identical.

## Phase 4: E2E (built server) + ADRs recorded + ROADMAP correction

#### Objective
Prove the whole convention end-to-end on the **built** server via a fixture app, record
ADR-B1 in `docs/adr/`, and apply the ROADMAP M2 directory correction (ADR-B2).

#### Why this step (action + reasoning)
DoD line 3 (documented convergence ADR) + the dev/build parity guarantee (Drawback 2/EC-4).
An E2E on the built server is the only check that catches the historical `ws` prod-404 class.

#### Evidence
- E2E consumer pattern: `fixtures/use-agent-stream-react/` (real `useChat` over the wire).
- ADR location: `docs/adr/` (M1 used `.claude/knowledge-base/adrs/0036-*`; the convergence
  ADR is user-facing → `docs/adr/`).
- ROADMAP M2 text to correct: `ROADMAP.md` M2 objective + 1st DoD line.

#### Files to edit
- `fixtures/unified-agent-surface/` (new — `agents/echo.ts` + a page consuming `useAgent('echo')`)
- `packages/theo/tests/integration/unified-agent-surface.test.ts` (new — build + serve + assert chunks)
- `docs/adr/0037-unified-agent-surface.md` (new — ADR-B1)
- `ROADMAP.md` (M2 objective + DoD line 1: `server/agents/*.ts` → `agents/*.ts`)

#### Deep file dependency analysis
The E2E imports the built manifest + the prod mount (Phase 2) + the generated `@theo/agents`
binding (Phase 3), so it fails if any phase regressed — the integration guard.

#### Deep Dives
The E2E: scaffold `agents/echo.ts` (`defineAgent` echoing input), build the fixture, start
the prod server, POST to `/api/agents/echo`, assert the SSE body parses (via ai-sdk
`readUIMessageStream`) into a `UIMessage` with the echoed text part — no live LLM (stub the
SDK bridge to echo). This mirrors the M1 deterministic E2E discipline.

#### Tasks
- T4.1 `fixtures/unified-agent-surface/` app (`agents/echo.ts` + `useAgent('echo')` page).
- T4.2 built-server integration test asserting parsed `UIMessage` parts.
- T4.3 write `docs/adr/0037-unified-agent-surface.md` (ADR-B1).
- T4.4 apply ROADMAP M2 directory correction (ADR-B2).

#### TDD
- T4.2 RED: `test_e2e_agents_convention_serves_uimessagestream_on_built_server` — build the
  fixture, serve, POST `{message:'hi'}` to `/api/agents/echo`, assert `readUIMessageStream`
  yields a `UIMessage` whose text part = `Echo: hi`. Fails until Phases 1–3 mount correctly.
- T4.3/T4.4 are documentation tasks; their "test" is `check_xrefs.py` resolving the ADR link
  + a grep asserting ROADMAP M2 no longer contains `server/agents`.

#### Concurrency tests (only when applicable)
(none — E2E is a single sequential request.)

#### Failure scenarios (external I/O)
- Built server fails to mount the agent → the E2E gets a 404 → test fails loudly (this IS
  the parity guard, not an unhandled path).

#### Acceptance Criteria
- E2E on the **built** server returns a valid `UIMessageStream` for `agents/echo.ts`.
- ADR-B1 recorded in `docs/adr/`; ROADMAP M2 says `agents/*.ts` (no `server/agents`).

#### DoD
- E2E green on built server; ADR link resolves (`check_xrefs.py`); ROADMAP grep clean; CHANGELOG updated.

## Coverage Matrix

| Goal claim | Task(s) | Test |
|---|---|---|
| `agents/<name>.ts` → auto SSE route, 0 wiring (dev) | T1.2, T2.1, T2.2 | scan + mountAgent + middleware tests |
| Same route works on the **built** server (parity) | T1.3, T2.3, T4.2 | manifest + prod-mount + built-server E2E |
| `defineAgent()` canonical zero-config surface | T1.1, T2.1 | brand test + mount test |
| `@Agent` still accepted (convergence) | T2.1 (brand-check) | `compileFromModule` decorator branch test |
| Client typed binding inferred end-to-end | T3.1, T3.3 | `.d.ts` golden + `useAgent` transport test |
| Agent without input → safe default (EC-2) | T3.1 | default-shape test |
| Route collision fail-fast (EC-3) | T2.2 | collision error test |
| Non-agent module fail-fast (EC-1) | T2.1 | typed-error negative test |
| Convergence ADR recorded | T4.3 | `check_xrefs.py` link resolves |
| ROADMAP directory corrected | T4.4 | grep asserts no `server/agents` in M2 |

## Test Plan

- **Unit:** Phases 1–3 RED tests (scan, defineAgent brand, mountAgent + negatives, codegen,
  useAgent) — pure/deterministic, no live LLM.
- **Integration:** Phase 4 built-server E2E via ai-sdk `readUIMessageStream` (SDK bridge
  stubbed to echo — deterministic).
- **Regression:** assert existing `@theo/client` `.d.ts` fixture byte-unchanged; assert M0/M1
  translator tests still green (protocol unchanged).
- **Oracle:** every emitted chunk validates against `uiMessageChunkSchema()` (reused from M0/M1).
