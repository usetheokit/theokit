# Multi-Surface Architecture — one construction, many surfaces

> **Layer:** DEEP DIVE (full technical precision — `defineRoute`-era API names, file:line, version numbers all belong here). This is not marketing copy.
>
> **Status (2026-07-08):** web + MCP surfaces shipped and secured; the in-process caller (the seam every non-HTTP surface needs) shipped; TUI reuses the core over HTTP today; Tauri is authorized-in-principle but **deferred + gated**. Published in `theokit@0.22.1` + `@theokit/agents@0.34.0`.
>
> **Evidence base:** the design was chosen after a 12-cluster adversarial deep-research pass whose critics **refuted 4 of 5 original recommendations** — this doc describes only the *narrower design that survived*. Full research: [`.claude/knowledge-base/discoveries/blueprints/universal-handler-architecture-blueprint.md`](../../.claude/knowledge-base/discoveries/blueprints/universal-handler-architecture-blueprint.md). Authorizing decision: [ADR-0044](../../.claude/knowledge-base/adrs/0044-m32-multi-surface-transports-framework-core.md).

---

## 1. The promise

TheoKit is the app the agent lives in. The multi-surface extension of that promise: a developer authors application logic **once** and the framework projects it onto every surface an agent app needs — **web** (HTTP/browser), **MCP** (agents), **TUI** (terminal), and (later) **Tauri** (desktop) — with a **typed context** that is correct by construction, and per-surface security that never leaks a web-only mutation onto an unauthenticated tool.

Crucially, TheoKit is *also* a conventional full-stack framework: login, cadastro, sessions, CRUD, forms live on the web surface as first-class citizens. The multi-surface story sits **on top of** that conventional base, not instead of it.

---

## 2. The one decision that shapes everything: bounded hybrid, NOT a universal procedure

The central question was: **what is the authoring unit?** A single transport-independent "procedure" (tRPC/oRPC style), or an HTTP-shaped "route", or a hybrid?

The deep research **refuted full unification**. No studied framework ships an MCP/TUI/Tauri projector from one shared unit — the "universal projector template" does not exist in prior art (oRPC `.callable()` yields a plain in-process fn; `.actionable()` is Next-RSC-specific). Collapsing TheoKit's units is also lossy: `route()` has three input channels (`.query/.body/.params`); `tool()` has one flat `z.object` + a model-visible-string output contract. Merging them fights guardrails G4 (tool capability must be explicit) and G5 (shared guards, distinct pipelines).

**Resolution — a bounded hybrid:**

- **`tool()`** — already transport-independent (name + flat Zod object + handler → JSON Schema via `z.toJSONSchema()`). This is the MCP/agent unit. Unchanged.
- **`route()`** — HTTP-shaped; method/path are file-based sugar, the Zod schemas are the contract.
- **Reuse across surfaces is via a shared plain typed function + an in-process caller** (§5), NOT a single projected unit. This is "shared guards, distinct pipelines" (G5), not "one pipeline, N projections".

Both are authored with the **builder-only API** (M31): `x() → setters → .build()`. See §3.

---

## 3. The authoring surface — builder-only (M31)

The fluent builder is the **single** public authoring API across all 8 define-surfaces. The legacy `define*` functions and `@theokit/agents` decorators were removed from the public API (kept internal — each `.build()` delegates to them, so the runtime/scan/compile is unchanged; ADR-0043).

| Surface | Builder | `.build()` emits | Source |
|---|---|---|---|
| agent | `agent().input(z).model(m).context(c).tool(t).approval(n,{…}).build()` | branded `AgentDefinition` | `packages/agents/src/bridge/agent-builder.ts` |
| tool | `tool('read').describe(d).input(z).execute(fn).build()` | `CustomTool` | `packages/theo/src/server/define/tool-builder.ts` |
| route | `route().query(z).body(z).params(z).handler(fn).build()` | `RouteConfig` | `packages/theo/src/server/define/route-builder.ts` |
| action | `action().input(z).accept('form').handler(fn).build()` | `ActionConfig` | `packages/theo/src/server/define/action-builder.ts` |
| websocket | `websocket().onOpen(fn).onMessage(fn).build()` | `WebSocketHandler` | `packages/theo/src/server/define/websocket-builder.ts` |
| middleware | `middleware().handle(fn).build()` | `MiddlewareHandler` | `packages/theo/src/server/define/middleware-builder.ts` |
| plugin | `plugin('cors').onRequest(fn).build()` | `TheoPlugin` (synthesized `register`) | `packages/theo/src/server/define/plugin-builder.ts` |
| config | `config().serverDir('core').set({…}).build()` | `Partial<TheoConfig>` | `packages/theo/src/config/config-builder.ts` |

**Technique:** type-state accumulation (tRPC `UnsetMarker`). A terminal `.build()` is a **compile error** when a required setter was skipped — e.g. `route().build()` fails until `.handler()` is set; `agent().build()` fails until `.model()`; `tool()` needs `.input()` + `.execute()`. The runtime is a plain config accumulator; the generics live entirely at the type level and the object is bridged once (`as unknown as XBuilder`) — the documented type-state seam.

`config()` is deliberately **hybrid** (ADR-0043 D3): dedicated setters for the common flat fields + a `.set(partial)` escape for the ~20-field long tail, because a 30-setter chain would be worse DX than the object literal Vite/Nuxt/Astro keep on purpose.

---

## 4. The typed context contract + the reconciliation (M33)

The pre-existing hole: a route handler's `ctx` was typed `TCtx = unknown` while the runtime injected `session`, `requestId`, `queue`, plugin decorations. The type lied about the runtime.

**The subtlety the research verified against our own code:** at runtime (`packages/theo/src/server/http/execute.ts:122-165`) `ctx` is written by **three** sources, only one of which is middleware:

1. the user `context.ts` factory (via `runMiddlewareAndContext`) — the writer the author controls + declares a shape for;
2. plugin decorations (`pluginRunner.applyDecorations`) — arbitrary keys;
3. the jobs backend (`ctx.queue`, when `jobs.backend` is configured).

A naive "infer `TCtx` from everything on `ctx`" would reproduce the exact global-augmentation lie — it cannot see writers (2) and (3). oRPC/tRPC avoid this only because middleware is their **sole** ctx writer; TheoKit is multi-writer.

**The reconciliation** (`packages/theo/src/server/http/ctx-reconciliation.ts`): the typed `TCtx` corresponds to **writer (1) only**. Writers (2)/(3) are explicitly not typed onto the route surface — `ctx.queue` is reached through an opt-in `JobsAugmentedCtx<T>` helper, plugin keys stay `unknown` by design. This keeps the locked 5-arity `RouteConfig` generic (GAP-4) intact and makes the invariant honest: **type ⊆ runtime** (a sound subset, never a lie). Proven by `tests/ctx-reconciliation.test-d.ts`.

---

## 5. The in-process caller — the seam for non-HTTP surfaces (M33)

The one mechanism every non-HTTP surface needs: invoke a route's logic **without** synthesizing an HTTP `Request`. Before M33 the only core seam was `executeWebRequest(Request): Promise<Response>`.

`callProcedure(config, { query?, body?, params? }, ctx?)` (`packages/theo/src/server/http/in-process-caller.ts`):

- validates structured input via the **same** Zod pipeline the HTTP path uses — `validateRouteInput` (`packages/theo/src/server/http/validate-route-input.ts`) is extracted and shared, so there is **one** validation pipeline, no drift;
- invokes the handler with a minimal in-process `Request` (only so handlers that read `request.*` still work — the input itself is never parsed from it);
- returns the raw result; validates the handler output against `config.response` when declared;
- throws **typed** errors off-web (`ProcedureInputError` / `ProcedureOutputError`) instead of a 400/500 Response (Rule 8, fail-fast).

Prior art: tRPC `callProcedure` / `createCallerFactory`. Parity with the HTTP path is proven by `tests/integration/in-process-vs-http-parity.test.ts` — the same `RouteConfig` yields the same result through both `executeWebRequest` and `callProcedure`.

---

## 6. The surfaces + the `build --target` split

```
                 authored ONCE (builder-only)
        route() / action() / tool() / agent() ...
                          │
        ┌─────────────────┼──────────────────────┐
        │                 │                       │
   HTTP transport    in-process caller       (agent runtime = SDK)
 executeWebRequest    callProcedure                │
   (Request→Response) (structured→result)          │
        │                 │                        │
   ┌────┴────┐      ┌─────┴──────┐          @theokit/sdk owns:
  WEB       (deploy) TUI        Tauri        LLM loop, provider I/O,
 browser    adapters  terminal   desktop     tool-dispatch, storage,
 forms      --target  (Ink)      (sidecar,   response streaming
 auth       node/…    over HTTP  deferred)
                                             MCP: server transport = framework;
                                                  client runtime = SDK
```

**Runtime-vs-home boundary (ADR-0040, reaffirmed by ADR-0044):** framework core owns the *transport/exposure of app logic* (a route/tool projected onto a surface) — that is **home**. The SDK owns the *runtime* — LLM loop, provider calls, tool-dispatch, conversation storage engine, response streaming, and the MCP *client*. A surface exposes app logic; it never runs the agent.

**`build --target` stays emit-only** (ADR-0044 D6). The 9 deploy adapters (node/vercel/cloudflare/static/bun/deno-deploy/netlify/aws-lambda/theo-cloud) emit fetch-handler-shaped artifacts. **TUI/MCP/Tauri are NOT build targets** — they are serve-shaped transport wrappers/sidecars over the one core handler (matching the shipped ADR-0039 TUI + ADR-0042 MCP-stdio). Adding them as `--targets` was rejected as a category error (the cited Astro/Nitro/Next "gold standards" are themselves emit-only + HTTP-bound).

### Surface status

| Surface | Status | How it reaches the core |
|---|---|---|
| **web** | ✅ shipped | `executeWebRequest(Request)` — routes/actions/pages/auth |
| **MCP (server)** | ✅ shipped + hardened (M34) | `POST /api/agents/<name>/mcp` → `handleMcpJsonRpc` → the compiled tools |
| **TUI** | ✅ shipped, **both models (M35)** | Model A (default): `streamAgentTurnInProcess` — single process, no server/port/CSRF, inline HITL. Model B (fallback): HTTP-loopback (`--http`/`THEO_CODE_URL`) for the one-server multi-surface case |
| **Tauri** | ✅ **realized (M36)** | Rust shell + webview + Node **sidecar** that runs the agent via `streamAgentTurnInProcess` (M35). Sidecar streams `UIMessageChunk`s as JSONL over stdout → Rust reads `CommandEvent::Stdout` → pushes each line to the webview via a **`Channel<String>`** (ADR-0045 — the push transport the `Request→Response` waist could not express). HITL is bidirectional: approval-request over stdout, decision back over the sidecar's stdin. Core stays transport-agnostic; all Tauri specifics live in the example. |

---

## 7. Security model (M34)

The multi-surface thesis magnifies the default-expose footgun: a login/mutation authored for the web must not silently become an unauthenticated tool. Three layers, all enforced at the framework boundary:

1. **Default-DENY exposure.** An agent is web-only unless it explicitly opts in with a named `export const mcp = true`. Absent the opt-in, the MCP route falls through to 404 — enforced at the emit layer in `serve-aux-routes.ts`. (This is a breaking change from the M16 auto-mount; documented in the CHANGELOG § Security.)
2. **Route auth (CSRF).** `POST /api/agents/<name>/mcp` drives the agent (spends real LLM tokens), so it enforces `validateCsrfRequest` with parity to the agent-run route — a cross-origin POST in `csrfMode: 'strict'` gets 403. This closed **#97** (the route shipped with zero auth). The MCP spec's real mechanism is transport-bifurcated (remote = RFC 8707 audience-bound OAuth; stdio = env creds) — the current gate is the CSRF parity fix; the full OAuth resource-server validation is the documented next step.
3. **HITL gate is not bypassable over MCP.** A tool gated by `.approval()` / `@HumanInTheLoop` is **refused** on `tools/call` (fail-closed, `isError`) — because the approval gate lives in the SDK run-loop, not the raw tool handler, so executing the handler directly would bypass the human gate the web/TUI surfaces enforce. This closed **#99** (mutating tools `bash`/`write`/`edit` ran unguarded over MCP). Non-gated tools are unaffected. A real over-MCP approval mechanism is a follow-up if demand appears; until then gated tools are simply not MCP-callable — the correct posture for security.

Session identity across surfaces is modeled (design) as a **discriminated union** (`web-cookie | mcp-oauth | ipc | tui-device`), not a flattened uniform type, so a handler can never confuse a full-trust human cookie with a narrowly-scoped MCP client (confused-deputy defense). CSRF is web-cookie-only. Auth providers stay delegated (AUTH-DELEGATION lock: RFC primitives in core, providers via Auth.js/Better Auth).

### 7.1 Durable transport — resumable / reconnectable streams (M37, ADR-0046)

The web SSE surface is request-scoped: a dropped client loses the run and any chunks emitted while disconnected. M37 adds a **durable transport layer** over the *existing* SSE waist — it is transport of app logic (ADR-0040/0044 home), NOT a new agent loop (the loop + suspend/resume stay in `@theokit/sdk`). Three additive pieces:

1. **Identity + framing.** `mountAgent` mints a transport `runId` (`run-<uuid>`), surfaced in the `x-theokit-run-id` response header; each SSE frame gains a monotonic `id: <seq>` line so the browser's `EventSource` echoes `Last-Event-ID` on reconnect (SSE-native — no invented protocol).
2. **`RunEventCache`.** Each frame is teed into a per-`runId` ordered buffer (in-memory default; a persistent backend — Redis / the SDK's `ConversationStorageAdapter` — plugs in behind the interface, **never a broker in core**). The load-bearing `attach(runId, afterSeq, onFrame, onEnd)` snapshots replay frames AND registers the live listener in ONE synchronous tick, so no frame slips between replay and subscribe and none is duplicated. Bounded: a run is evicted a fixed window after `end()` (parity with the approval-registry).
3. **Reconnect / observe endpoint.** `GET /api/agents/<name>/runs/<runId>/stream` replays frames after `Last-Event-ID`, then follows the live tail; a **second client can observe** a run a first started. Intentionally open (a GET is not CSRF-vulnerable; the `runId` is 122-bit-unguessable; a custom-header CSRF check would break `EventSource`, which sends no custom headers). Unknown `runId` → 404.

This is the transport half of Mastra-style "durable agents"; a shipped persistent cache backend is a named follow-up. The TUI/Tauri in-process path is unchanged (it does not reconnect over HTTP). Code: `packages/theo/src/server/agent/{run-event-cache,durable-ui-message-stream-response,handle-agent-run-reconnect}.ts`.

**HITL continuation over the durable stream (M38, ADR-0047).** Mastra's `untilIdle` keeps the stream open across a `suspend → resume` because a Mastra background task ENDS the turn; the agent must be re-invoked on completion. TheoKit does NOT end the turn: a `@HumanInTheLoop`-gated tool `await`s the approval Promise inside the SDK `pre_tool_call` hook (`hitl-plugin.ts`), so the run PAUSES in-place — the durable stream simply waits, no `[DONE]` is sent, and the SAME run continues on the SAME `runId` when a separate `POST /approve` resolves it. So `untilIdle` (a re-invoke-after-turn-ends feature) has **no gap to fill** for the in-scope HITL trigger — TheoKit already continues on one connection, reconnectably. M38 therefore ships **proof, not a no-op flag**: `tests/integration/hitl-durable-continuation.test.ts` proves the pause + M37 reconnect + resume-continuation combination end-to-end. The re-invoke `untilIdle` becomes relevant only with a background-task DISPATCH engine that ends the turn — reaffirmed out of scope (ROADMAP § Explicitly out of scope). ADR-0047.

---

## 8. How it was implemented — the milestones

Delivered through the project's CYCLE (discover → plan → implement → code-quality → review → release + self-merge), TDD-first, one milestone per release cut.

| Milestone | What shipped | Release |
|---|---|---|
| **M31** | Builder-only authoring API across all 8 surfaces; `define*` + decorators removed from the public API | `theokit@0.21.0`, `@theokit/agents@0.34.0` |
| **M32** | ADR-0044 — TUI/MCP/Tauri authorized as framework-core transport surfaces; G1 dependency-DAG (`@theokit/http ↛ @theokit/agents`) made a tested invariant | (ADR + test; no publish) |
| **M33** | `callProcedure` in-process caller + shared `validateRouteInput` pipeline + ctx reconciliation | `theokit@0.22.0` |
| **M34** | MCP `tools/call` execution + real Zod schema retention + protocol bump (`2025-06-18`) + auth gate (#97) + default-DENY (ADR-0044 D5) | `theokit@0.22.0` |
| **0.22.1** | Security: `tools/call` refuses HITL-gated tools — no approval bypass (#99) | `theokit@0.22.1` |

**Engineering discipline applied throughout:**

- **TDD** — every slice began with a RED test (e.g. the #99 fix: a test asserting a gated tool is refused *and the handler does not run*, confirmed failing first).
- **De-risker** — because each builder `.build()` emits the identical branded/identity shape the runtime already consumed, the migration was authoring-only; scan/compile/runtime stayed untouched (proven by wiring tests through `compileAgentDefinition` and HTTP↔in-process parity).
- **Adversarial verification** — the whole design was routed through 4 independent critics; 4/5 original recommendations were refuted before any code, so the shipped design is the narrow one that survived rather than the enthusiastic one.
- **Live verification** — surfaces were exercised end-to-end in a real dev server (web 200, agent streaming a real model, MCP `tools/list`/`tools/call`, TUI running a tool, default-DENY 404, CSRF 403, HITL refusal). Two security findings (#97, #99) were discovered by that live verification, filed with repro + evidence, fixed, and verified-closed.

---

## 9. Open decisions & honest gaps

The design is deliberately incremental. What is **not** done, and why:

- **Tauri surface** — ✅ **realized (M36, ADR-0045).** A Node sidecar runs the agent via the M35 in-process path; the Rust shell streams its JSONL stdout to the webview via a `Channel<String>` (the push transport). All Tauri specifics live in the example (`theo-code-v2/apps/desktop`), **not** an `adapter-tauri` build target; framework core is untouched. Remaining desktop follow-ups (not blocking): a single-file packaged sidecar (`@yao-pkg/pkg`) instead of a `node` launcher, and automated webview E2E (no `tauri-driver`/`WebKitWebDriver` in the current CI sandbox — the pipeline is proven via the shell compiling + the sidecar streaming a real turn through the exact launcher + the HITL stdin round-trip).
- **TUI in-process (Model A)** — ✅ **shipped (M35).** The framework seam `streamAgentTurnInProcess` (`packages/theo/src/server/agent/stream-agent-turn-in-process.ts`) runs an agent turn in a single process with inline HITL; the `theo-code-v2` Ink TUI defaults to it (no server/port/CSRF), with HTTP-loopback kept as the `--http` fallback. Note: a provider error the SDK does **not** surface (e.g. an unknown model id → 404 that ends the stream `start→finish` with no error chunk) is a separate upstream `@theokit/sdk` gap; the TUI guards it with a "no content" hint until the SDK surfaces it.
- **Full MCP OAuth resource-server auth** — the current MCP gate is the CSRF parity fix (#97). The spec-correct remote-MCP flow (RFC 8707 audience-bound token validation + RFC 9728 PRM discovery) is the next step; stdio uses env creds (no in-request token).
- **Over-MCP approval mechanism** — gated tools are currently *refused* over MCP (fail-closed, #99). A real approval flow over MCP is a follow-up only if demand appears.
- **Per-tool (not per-agent) surface tags** — default-DENY is currently per-agent (`export const mcp = true`). A finer per-tool `surfaces` allowlist (the blueprint's D5 in full) is a future refinement.
- **`ctx.session` discriminated union** — modeled in the design (§7) but not yet the shipped session type; it lands with the auth-per-surface work.
- **File upload / multipart, cross-surface rate-limiting** — conventional-app concerns flagged by the completeness critic, not yet addressed for the non-web surfaces.

---

## 10. Where to look in the code

| Concern | File |
|---|---|
| Builder authoring surface | `packages/theo/src/server/define/*-builder.ts`, `packages/agents/src/bridge/agent-builder.ts` |
| Shared Zod input validation | `packages/theo/src/server/http/validate-route-input.ts` |
| In-process caller (routes) | `packages/theo/src/server/http/in-process-caller.ts` |
| In-process agent turn (Model A, M35) | `packages/theo/src/server/agent/stream-agent-turn-in-process.ts` |
| Ctx reconciliation | `packages/theo/src/server/http/ctx-reconciliation.ts` |
| HTTP execution seam | `packages/theo/src/server/web-handler.ts` (`executeWebRequest`), `.../http/execute.ts` |
| MCP server transport | `packages/theo/src/server/agent/mcp-handler.ts`, `.../serve-aux-routes.ts` |
| Tauri desktop (M36 — sidecar + Channel) | `theo-code-v2/apps/desktop/` (`sidecar-core.ts`, `sidecar.ts`, `src-tauri/src/lib.rs`, `frontend/main.js`) — in the example, not core |
| Boundary invariant test | `tests/unit/g1-dependency-dag-boundary.test.ts` |
| Authorizing decision | `.claude/knowledge-base/adrs/0044-*.md`, `0045-*.md` (Tauri) (+ 0040, 0042, 0043) |
| Research | `.claude/knowledge-base/discoveries/blueprints/universal-handler-architecture-blueprint.md` |

---

*This document is a DEEP DIVE artifact. The public, benefit-first framing of these capabilities belongs in the README HERO/BODY layers per the Voice & Tone rules; this file is the precise, honest engineering record.*
