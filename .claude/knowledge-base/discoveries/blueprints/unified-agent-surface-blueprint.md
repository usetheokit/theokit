# Blueprint: Unified zero-config agent surface (M2 — Eixo B)

> **Exec summary.** M2 turns a single file — `agents/<name>.ts` (top-level, per the
> LOCKED naming decision in
> `.claude/knowledge-base/reference/agent-surface-naming-system-design.md`) — into a
> fully-wired agent: an SSE endpoint at `POST /api/agents/<name>` and a typed client
> binding, with **zero manual server wiring**. It reuses the M0/M1 canonical protocol
> unchanged — `translateToUIMessageStream`
> (`packages/agents/src/bridge/ui-message-stream-translator.ts:36`) +
> `uiMessageStreamResponse`
> (`packages/theo/src/server/define/ui-message-stream-response.ts`) — so what the
> convention emits is the exact `UIMessageStream` wire `useChat` already consumes. The
> file convention is built by mirroring the established file-scan machinery
> (`ws-scan.ts` / `action-scan.ts` for the scan, `app-typed-client.ts` for the
> `.d.ts` codegen, `configure-server-hook.ts` for dev-middleware wiring, `manifest.ts`
> for build-time emission). M2 introduces a new public export `defineAgent()` in
> `@theokit/agents` as the **canonical zero-config surface**; the existing `@Agent`
> class decorator stays as the **advanced/DI surface** — the ADR records that
> convergence. The old proprietary `defineAgentEndpoint` (yields the proprietary
> `AgentEvent`) is **NOT** the target of the convention — it is what M3 removes.
>
> **Verdict: (to be scored by /discover-confidence)**

### Scope + naming reminder (LOCKED)

- **Directory is top-level `agents/`, NOT `server/agents/`.** The ROADMAP.md M2 text
  says `server/agents/*.ts` — that text predates the naming deep-research the user
  drove. The locked decision (top-level `agents/`, keep `server/`) is authoritative;
  the ROADMAP M2 line is corrected in the same milestone (see ADR-B1).
- **In scope:** (1) scan `agents/*.ts` → auto SSE route; (2) end-to-end typed client
  binding; (3) ADR converging `@Agent` decorator ↔ file convention.
- **Out (M3):** removing `defineAgentEndpoint` + the proprietary `AgentEvent`. Out
  (YAGNI): nested agent folders, per-agent middleware config, multi-file agents.

---

## Coverage Corner 1 — Integration Tests

*(How the file-scan conventions + typed-client codegen are tested today — the pattern M2 mirrors.)*

### The scan-convention test pattern (mirror for `agent-scan.ts`)

Existing scanners are unit-tested by pointing the scanner at a fixture directory and
asserting the returned node array (path → route-path derivation, index stripping,
test-file skipping):

- `packages/theo/src/server/scan/ws-scan.ts:17-36` — `scanWebSocketRoutes(serverDir)`
  walks `join(serverDir,'ws')`, returns `{ filePath, wsPath }`. Closest analog: SSE is
  HTTP but the routing is one-file-one-endpoint like WS, not the `[param]` tree of
  `routes/`. **`agent-scan.ts` mirrors this** but roots at `resolve(projectRoot,'agents')`.
- `packages/theo/src/server/scan/action-scan.ts:99-188` — `scanServerActionsEnriched`
  additionally detects the **exported schema** (`hasInput`, `schemaFilePath`). M2 needs
  this enrichment to lift the agent's input Zod schema for the typed client.
- `packages/theo/src/server/scan/scan.ts:102-156` — the shared `walkSourceFiles` walker
  + `.ts|tsx|js|jsx` filter + `*.test|spec.*` skip. Reuse verbatim.

### The typed-client codegen test pattern (mirror for agents)

- `packages/theo/src/vite-plugin/app-typed-client.ts:233-270` — `generateClientDts()`
  walks the manifest, emits `.theokit/client.d.ts` with a declared module `@theo/client`
  where **each route becomes an `import type` alias** feeding `InferResponse<typeof _rN>`.
- Golden fixture: `fixtures/server-routes-basic/.theokit/client.d.ts` (real emitted shape).
  M2 adds an analogous fixture asserting an `agents/support.ts` produces a typed
  `agents.support` binding whose request type = `z.infer<typeof inputSchema>`.

### The M0/M1 E2E already proves the wire

- `fixtures/use-agent-stream-react/` — a real ai-sdk `useChat` consumer over the
  UIMessageStream produced by the M0/M1 translator. M2's convention must produce a
  **byte-identical** stream (same `translateToUIMessageStream` + `uiMessageStreamResponse`),
  so the M2 E2E asserts: `agents/echo.ts` (convention) yields the same chunks the M1
  fixture asserts for the hand-wired route. The convention adds wiring, not protocol.

---

## Coverage Corner 2 — Dependencies

- **No new runtime dependency.** M2 is wiring over existing primitives: `picomatch`
  (already a `theokit` dep, `packages/theo/package.json:122`) for the scan glob; `vite`
  virtual-module + `ssrLoadModule` (already used by `ws-upgrade.ts:43`); `zod` (peer)
  for input-schema inference. Rule 9 (don't reinvent): the walker, the SSE response, the
  `.d.ts` emitter, and the SDK bridge all already exist.
- **Cross-package:** the `defineAgent()` export lands in `@theokit/agents`
  (`packages/agents/src/index.ts:1-16`, which today re-exports decorators+bridge but has
  **no imperative define API** — the seam). `theokit` (the framework) imports it for the
  runtime; the vite-plugin scans for it. Keep `@theokit/agents` free of vite/theo imports
  (dependency direction: agents ← theo, never theo internals → agents runtime).
- **SDK bridge reuse:** `createSdkAgentStream` (`packages/agents/src/bridge/sdk-adapter.ts:439`)
  + `compileAgent` (`agent-compiler.ts:133`) are the runtime both `@Agent` and
  `defineAgent` compile down to — `defineAgent` produces a `CompiledAgentOptions`-shaped
  value directly, no decorator metadata walk.

---

## Coverage Corner 3 — Tools

- **Scan:** `walkSourceFiles` (`scan.ts`) — shared, no new tool.
- **Dev routing:** register an `agent-middleware.ts` in `configure-server-hook.ts:82-90`
  (BEFORE the generic api-middleware; prefix `/api/agents/`), mirroring how
  `createActionMiddleware` is registered before `createApiMiddleware`
  (`configure-server-hook.ts:84-115`). Dev = scan-on-request + `ssrLoadModule(filePath)`.
- **Build:** extend `TheoManifest` (`manifest.ts:37-76`) with `agents: AgentNode[]`;
  `generateManifest`/`writeManifest` include them. The prod server (`cli/commands/`)
  mounts them the same way it mounts routes.
- **Typed client:** extend `app-typed-client.ts` codegen (or a sibling
  `agents-typed-client.ts`) to emit an `AppAgents` interface + a generated `useAgent`
  binding. Watch `agents/*` for regen (mirror `app-typed-client.ts:355+` watcher).

---

## Coverage Corner 4 — Techniques

### The `defineAgent()` surface (the unification seam)

`packages/agents/src/index.ts` has **no imperative define API** today — that is the gap.
`defineAgent()` is the imperative counterpart to `@Agent`:

```ts
// agents/support.ts  (top-level, zero-config)
import { defineAgent } from '@theokit/agents'
import { z } from 'zod'

export default defineAgent({
  input: z.object({ message: z.string() }),   // lifts to the typed client
  model: 'claude-sonnet-4-6',
  system: 'You are a support agent.',
  tools: [ /* … */ ],
})
```

- `defineAgent(config)` is an **identity/normalizer** (like `defineRoute`
  `define-route.ts:14-24`) that returns a branded `AgentDefinition` carrying the input
  schema type param → the vite-plugin infers `z.infer<typeof input>` for the client, and
  the runtime compiles it to `CompiledAgentOptions` via `compileAgent`.
- The generated route wraps: `createSdkAgentStream(compiled)(message, sessionId)` →
  `AsyncIterable<AgentStreamEvent>` → `translateToUIMessageStream(events,{textId})` →
  `uiMessageStreamResponse(chunks)`. **All M0/M1 code, unchanged.**
- For full escape-hatch parity a file MAY also `export default` a `@Agent`-decorated
  class; the scanner accepts either (detect: default export is a class with
  `AGENT_CONFIG` metadata → decorator path; else `AgentDefinition` brand → define path).
  Both converge on `CompiledAgentOptions`.

### The typed client binding (end-to-end inference)

- Codegen emits `declare module '@theo/agents'` with
  `import type Support from '../agents/support'` and an `AppAgents` map:
  `{ support: { input: InferAgentInput<typeof Support> } }`.
- Generated `useAgent('support')` returns a `useChat` (ai-sdk `@ai-sdk/react`) pre-bound
  to `DefaultChatTransport({ api: '/api/agents/support' })`, with `sendMessage` typed to
  `AppAgents['support']['input']`. The heavy lifting (streaming, parts) is `useChat`
  from M0/M1 — the generated hook only supplies the path + request type. No new client
  runtime, just a thin typed wrapper (KISS).

---

## ADRs

### ADR-B1 — Canonical agent surface: file-convention `defineAgent` (zero-config) + `@Agent` (advanced), top-level `agents/`

- **Context.** Two ways to declare an agent exist today: the `@Agent` class decorator
  (`packages/agents/src/decorators/agent.ts:43`, full DI — toolboxes/guards/memory/skills,
  auto-mounted by `agentsPlugin` `theokit-plugin.ts:41`) and the imperative
  `defineAgentEndpoint` (`packages/theo/src/server/define/define-agent-endpoint.ts:169`,
  yields the **proprietary `AgentEvent`**). Neither is a zero-config file convention.
- **Decision.** (1) Introduce `defineAgent()` in `@theokit/agents` as the **canonical
  zero-config surface**, discovered by a top-level `agents/*.ts` file convention. (2) Keep
  `@Agent` as the **advanced surface** (DI, sub-agents, mainloop) — a `agents/*.ts` file
  MAY default-export a decorated class and the scanner accepts it; both compile to
  `CompiledAgentOptions` and run through `createSdkAgentStream`. (3) The convention wires
  to the **M0/M1 canonical protocol** (`AgentStreamEvent` → `translateToUIMessageStream`
  → `uiMessageStreamResponse`), never to `defineAgentEndpoint`.
- **Alternatives rejected.** (a) Make `@Agent` the only surface → forces class+decorators
  for a one-line agent, hostile to zero-config (KISS). (b) Make `defineAgentEndpoint` the
  convention target → re-entrenches the proprietary `AgentEvent` M3 must remove. (c)
  `server/agents/` location → POLA/naming analysis rejected it (agent-surface-naming doc).
- **Consequence.** `defineAgentEndpoint`/`AgentEvent` become legacy, slated for M3 removal.
  M2 ships the replacement so M3 is a pure deletion + codemod.

### ADR-B2 — ROADMAP M2 directory correction: `server/agents/*.ts` → `agents/*.ts`

- The ROADMAP M2 objective/DoD text (`server/agents/*.ts`) predates the locked naming
  decision. Correct the three DoD lines + objective to top-level `agents/*.ts` in the same
  milestone. Semantics of the DoD (1 file → endpoint + typed client + convergence ADR)
  are unchanged; only the path. Recorded here so the correction is auditable, not silent.

---

## Edge cases (settled)

- **EC-1 — Two default-export shapes.** A file may export a `defineAgent` value OR a
  `@Agent` class. The scanner brand-checks (`AGENT_CONFIG` metadata via `getMeta` vs the
  `AgentDefinition` brand) and routes to the right compiler. A file with neither → a clear
  build-time error naming the file (fail-fast, Rule 8), not a silent skip.
- **EC-2 — Input schema optional.** An agent without an `input` schema → client request
  type defaults to `{ message: string }` (the ai-sdk `UIMessage` shape). No schema must
  not break the typed binding; it degrades to the default, never `any`.
- **EC-3 — Name/route derivation collision.** `agents/support.ts` and
  `server/routes/api/agents/support.ts` would both claim `/api/agents/support`. The
  agent-middleware registers under the reserved `/api/agents/` prefix and MUST detect a
  manual route collision at scan time → fail-fast with both file paths (mirrors how
  action-middleware owns `/api/__actions/`).
- **EC-4 — Dev vs build parity.** Dev scans on request (`ssrLoadModule`); build emits the
  manifest. The prod mount path (`cli/commands/`) must read the same manifest shape or the
  convention works in `dev` and 404s in `build` — the M2 E2E runs the built server, not
  just dev (the failure mode `ws` had historically).
- **EC-5 — Empty `agents/` dir absent.** No `agents/` directory → the plugin emits an
  empty `AppAgents` + registers no middleware (zero cost for non-agent apps), mirroring
  `actions-virtual-module.ts:176-180` emitting `{}` when `server/actions/` is absent.

---

## References

- Naming/System-Design decision: `.claude/knowledge-base/reference/agent-surface-naming-system-design.md`
- M0/M1 protocol: `packages/agents/src/bridge/ui-message-stream-translator.ts`,
  `packages/theo/src/server/define/ui-message-stream-response.ts`
- Scan machinery: `packages/theo/src/server/scan/{scan,ws-scan,action-scan,manifest}.ts`
- Dev wiring: `packages/theo/src/vite-plugin/{configure-server-hook,action-middleware,api-middleware}.ts`
- Typed client codegen: `packages/theo/src/vite-plugin/app-typed-client.ts`
- Dual path: `packages/agents/src/decorators/agent.ts`,
  `packages/agents/src/bridge/{agent-route-generator,agent-compiler,sdk-adapter}.ts`,
  `packages/theo/src/server/define/define-agent-endpoint.ts`
- M1 ADR (canonical protocol): `.claude/knowledge-base/adrs/0036-canonical-protocol-uimessagestream-vs-agui.md`
