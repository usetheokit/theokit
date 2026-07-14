# theo

## 0.40.0

### Minor Changes

- f61b77f: Adopt `@theokit/sdk@3.x` (SE36 uniform `X.create()` API).

  SDK v3.0 removed the standalone factory functions in favor of static `X.create()` namespace methods. The `@theokit/agents` bridge now binds the new names — `Tool.create` (was `defineTool`), `SkillReadTool.create` (was `defineSkillReadTool`), `Retry.create` (was `withRetry`) — and the scaffold's code-defined skill uses `Skill.create` (was `createSkill`). While migrating, the tool-handler wrapper (`withRunContext`) was fixed to forward the **full** tool `ctx` — the SE12 `messages` transcript projection was being dropped, which would have silently broken a tool that reads the turn transcript; the handler types now track the SDK's canonical `CustomTool['handler']` instead of a hand-maintained duplicate.

  **Breaking (peer requirement):** `theokit` and `@theokit/agents` now require `@theokit/sdk >= 3.5.0` (and `@theokit/sdk-tools >= 0.9.1`, the SE36-migrated build). Apps on `@theokit/sdk@2.x` must upgrade — run `npx @theokit/codemod-sdk-3-0 --write` to migrate app code that calls the old factories directly.

### Patch Changes

- Updated dependencies [f61b77f]
  - @theokit/agents@0.39.0

## 0.39.1

### Patch Changes

- 083ad1e: Fix `ReferenceError: agentHandle is not defined` in the browser when binding an agent by handle (`import { chat } from '@theo/agents'; useAgent(chat)`).

  The generated runtime `@theo/agents` module re-exported `agentHandle` (`export { useAgent, agentHandle } from 'theokit/client'`) and then called it — but `export { x } from '…'` re-exports the name without creating a local binding, so `agentHandle('/api/agents/chat')` threw at module evaluation and the whole chat surface fell into the error boundary. `agentHandle` is now `import`ed (a local binding) and only `useAgent` is re-exported. Regression-guarded by a unit test over the extracted `generateAgentsRuntimeModule`, and verified end-to-end in a real browser (message → streamed agent reply). Shipped in `theokit@0.39.0` (M47); fixed here.

## 0.39.0

### Minor Changes

- acdf585: `@Expose` decorator — make an agent's exposure visible in one code review (M47, ADR-0059).

  Put a `@Controller('/api/agents')` class with `@Expose(chatAgent, { csrf: true })` (+ `@UseGuards(...)`) next to your other controllers, and a reviewer sees in one file WHAT the agent is (`chatAgent`, built separately in `agents/chat.ts`), WHERE it's served (`POST /api/agents/chat`), and its security. The agent stays built separately; the exposure is explicit and opt-in — the zero-config `agents/*.ts` convention is unchanged.

  On the frontend, `import { chat } from '@theo/agents'; useAgent(chat)` binds with **no magic string and no duplicated input type**: the path comes from the generated typed handle and `send` is inferred from the agent's `.input()` (cmd-click `chat` → `agents/chat.ts`). The same handle drives every surface — web `useAgent(chat)`, terminal `useAgent(chat.inProcess(run))`, desktop `createAgentClient(chat.channel(source))`.

  - `@theokit/http` gains the `Expose` decorator + `ExposeOptions`/`ExposeEntry` types, the `WalkResult.agent` field, a `serveAgent` seam on `createDecoratorHandler` (http stays agent-runtime agnostic), and `@UseGuards` widened to a `PropertyDecorator` (per-agent auth on the `@Expose` property).
  - `theokit` gains `AgentHandle` / `agentHandle` in `theokit/client`, a `useAgent(handle)` overload, and codegen that emits one typed handle per agent.
  - One runtime under it all (`mountAgent`): `@Expose`, `@Agent`, and the file convention are authoring surfaces, not competing paths (a grep gate proves no parallel agent streamer ships).

### Patch Changes

- Updated dependencies [acdf585]
  - @theokit/http@0.7.0

## 0.38.0

### Minor Changes

- c8ceb5e: `useAgent` now exposes the whole conversation as `thread`, not just the current turn (M46, #125, ADR-0058).

  The client store (`theokit/client/core`) accumulates a surface-agnostic `thread: UIMessage[]` — committed turns + the current user message + the in-flight streaming assistant — with stable message ids, committed exactly once, cleared only by `reset()`. Render `const { thread } = useAgent(...)` (or `createAgentClient(...).getState().thread` from the React-free core) instead of hand-rolling a transcript from per-turn `messages`. Same shape on web, desktop (Tauri) and TUI.

  - Per-turn `messages` keeps its exact back-compat semantics — `thread` is purely additive; existing call sites are untouched.
  - The `@theo/agents` codegen types `thread` automatically (it emits the `UseAgentReturn` interface name).
  - An errored or aborted turn is dropped rather than corrupting committed history; stale (aborted) drives never append.
  - **create-theokit:** the scaffolded web, TUI, and desktop apps now render `useAgent().thread` directly — the ~88-line hand-rolled transcript (local history + commit-once effect + inflight-merge) is gone from all three surface templates.

- 55afcec: Decorator controllers now reach parity with file-based `route()` inside a theokit app (#122).

  Put a `@Controller` class in `server/controllers/*.controller.ts` and in `theokit dev` its routes are **served** alongside file-based routes — sharing CSRF, security headers, CORS, rate-limit, and plugins — and **typed** in `@theo/client` as `client.<ns>.<method>()` with the response type inferred from the handler and `:id` params typed from the route pattern. File-based routes take precedence; a controller only answers paths they miss.

  - File-based routes, the deploy manifest, and the routes-only typed client are unchanged (the swc transform is a strict no-op outside `controllers/`; controllers stay out of `generateManifest`).
  - Request `@Body`/`@Query` types are `unknown` for now — parameter decorators are invisible to the type system (#124); runtime `@Body` Zod validation is unaffected.
  - Production `theokit start` serving of controllers is tracked separately (#123).
  - `@theokit/http` gains `transformControllerSource`, `createDecoratorHandler`, `isControllerClass`, `loadControllerWithSwc`, `loadControllersFromGlob` + supporting types so the framework reuses http's swc + dispatch rather than duplicating them.

### Patch Changes

- Updated dependencies [55afcec]
  - @theokit/http@0.6.0

## 0.37.0

### Minor Changes

- a3cf6e8: Plugin hooks now receive a Web `Request` as `ctx.request` in every runtime (#119, ADR-0056). Previously the
  Node server (`theokit dev` / `theokit start`) passed plugin `onRequest` / `preHandler` / `onResponse` /
  `onError` hooks a Node `IncomingMessage`, while the edge adapters passed a Web `Request` — so a hook reading
  `ctx.request.headers.get(...)` worked on the edge but threw on Node (and vice versa for `.headers[...]`).
  `PluginContext.request` is now typed `Request` and built once per request from the `IncomingMessage`
  (headers/URL/method; the body is read by the handler via `ctx.body`). Sibling of the #117 route-handler fix.

  **Migration (breaking type change):** a plugin hook that read `ctx.request` as a Node `IncomingMessage`
  (`.socket`, `.rawHeaders`, `.on('data')`, `.headers[name]`) must switch to the Web `Request` API
  (`ctx.request.headers.get(name)`, `ctx.request.url`, `ctx.request.method`). An audit of the first-party
  plugins found no hooks affected.

## 0.36.1

### Patch Changes

- fc3cc06: Fix (#117): route handlers now receive a Web `Request` as `ctx.request` in the Node server (dev + `theokit start`),
  matching the public `request: Request` handler type and ADR-0028 R3a. Previously the Node executor leaked
  the raw `IncomingMessage`, so any Web-standard use of `ctx.request` — e.g. `ctx.request.headers.get(...)` or
  `createSessionManagerWeb.getSession(ctx.request)` — threw `request.headers.get is not a function` at runtime
  even though it type-checked. This made the framework's own Web session primitive unusable from a handler in
  the Node server. The handler request carries method + URL + headers (the request body remains available via
  the typed `ctx.body`, since the Node stream is already parsed before the handler runs).

## 0.36.0

### Patch Changes

- Bump the `@theokit/agents` floor to `^0.38.0` — the runtime auto-wires the `skill_read` tool for agents
  that declare inline skills via `.skills([...])`. No theokit API change.

## 0.35.0

### Patch Changes

- Bump the `@theokit/agents` floor to `^0.37.0` so the framework compiles agents that declare inline
  `createSkill` skills via `.skills([...])`. theokit's own code is unchanged, but the compile path
  (`compileAgentModule` → `compileAgentDefinition`) must be the version that splits a mixed skills list
  into `skills.enabled` + `skills.inline`; an older `@theokit/agents` would mis-map an inline object into
  `enabled`. No app-facing API change.

## 0.34.0

### Minor Changes

- **`theokit generate schedule` now emits the framework-native `defineCron`, discovered from
  `agents/schedules/`.** The previous template used the SDK's programmatic `Cron.create` (needs a manual
  `Cron.start()`, no deploy integration). The generated schedule is now
  `export default defineCron(name, { schedule, handler })` — auto-discovered by `theokit build` and
  translated to the deploy target's native cron (Vercel/Cloudflare/AWS). The build-time cron scanner now
  walks BOTH `server/crons/` (backend trigger) and `agents/schedules/` (scheduled agent run, kept in the
  agent domain) via the new `scanCronDirs([...])`, with a unified duplicate-name guard across both homes.
  A scheduled agent run stays in the agent domain AND is a first-class framework cron.

## 0.33.0

### Minor Changes

- **Capability generators now live in the agent domain and connect to the agent.** `theokit generate
workflow|eval|sandbox|schedule|memory <name>` emits under `agents/<capability>/` (not the app root) —
  these are facets of the agent domain, not standalone top-level concerns. The folder-semantic scanner
  now also skips `agents/{workflows,evals,memory}` (it already skipped `sandbox`/`schedules`), so none
  become phantom routes. The emitted examples are wired to the agent: `sandbox` is a `tool()` you add
  with `.tool(...)`; `memory` shows `.conversationStorage(...)` (new in `@theokit/agents@0.36.0`);
  `eval`/`schedule` mirror the agent's model + system prompt; `workflow` documents `agentStep`.

## 0.32.0

### Minor Changes

- **Capability generators.** `theokit generate <capability> <name>` now scaffolds a minimal, runnable
  example of five SDK capabilities — `workflow`, `eval`, `sandbox`, `schedule`, `memory` — alongside the
  existing `route`/`action`/`page`/`ws`/`controller`/`agent`/`toolbox`/`resource` kinds. Each emitted file
  type-checks against `@theokit/sdk`; `workflow` and `sandbox` run standalone. Learn the API by reading real
  code (`rails g` style) instead of hunting docs.

## 0.30.0

### Minor Changes

- de88047: **M44 — standalone typed agent client-SDK (no React) over the same store.**

  Consume an agent from a node script, a CLI, a test, or a non-React UI — the same seam, no React in your
  bundle. `createAgentClient(transport, { context? })` (from the new React-FREE entry `theokit/client/core`)
  returns a plain handle over the framework-agnostic `AgentClient` store: `send` / `abort` / `reset` /
  `approve` / `reconnect` / `subscribe` / `getState`, plus an ergonomic `stream(input): AsyncIterable<UIMessage>`
  that yields the assistant message as it streams (the last value is the final result; a failed turn rejects
  the iterator). It drives ANY transport (`HttpTransport` over node fetch, `InProcessTransport`,
  `ChannelTransport`) and supports the M43 per-request `context`. `theokit/client/core` imports no React
  (verified by an import-graph test); `theokit/client` also re-exports `createAgentClient` for React apps'
  convenience. No new store (wraps the existing `AgentClient` — G12), no runtime change (G2). Completes the
  theokit↔sdk DX track (M41 web+TUI, M42 Tauri, M43 context, M44 standalone). ADR-0053.

## 0.29.0

### Minor Changes

- fe62624: **M43 — request-context / auth parity across every transport.**

  Attach per-request context — an auth token, a tenant id, a provider selection — once on `useAgent`, and
  it reaches EVERY transport uniformly. `useAgent(pathOrTransport, { context })` accepts a `RequestContext`
  (`{ headers?, metadata? }`) or a resolver evaluated on every send/reconnect (so a rotating JWT is never
  stale — reuses M41's live-ref pattern). Each transport maps context to its native mechanism:
  `HttpTransport` → `context.headers` become request headers; `InProcessTransport` → `context.metadata` is
  forwarded to the runner as `InProcessRunInput.context`; `ChannelTransport` → `context.metadata` is
  forwarded to the injected `start(turn)` as `turn.context`. Threaded through the seam's existing
  `ChatRequestOptions` (`headers`/`metadata`) — no new channel. Context stops at the transport boundary
  (never enters the SDK runtime — G2). Calls without `context` behave exactly as before (back-compat).
  ADR-0052.

## 0.28.0

### Minor Changes

- 8bdfd8c: **M42 — Tauri desktop on the unified client: `ChannelTransport` (push) + reconnect parity.**

  The Tauri desktop webview now consumes agents through the SAME `useAgent` as web + terminal. Ships
  `ChannelTransport` — a `ChatTransport<UIMessage>` (the M41 seam) over an INJECTED Tauri-`Channel`-shaped
  push source (`{ start(turn, { onLine, onClose, onError }), settle? }`), so core imports no `@tauri-apps/*`
  and the transport is unit-tested with a fake. `sendMessages` bridges pushed JSONL `UIMessageChunk` lines
  into a `ReadableStream` (a malformed line is skipped, never fatal); `abortSignal` tears down the source;
  `reconnectToStream` returns `null` — the honest parity for a single-process push surface (the M36 sidecar
  runs the turn directly; durable `runId` reconnect stays web-only, M37); `approve` routes to the injected
  `settle`. `useAgent(channelTransport)` drives the desktop webview with the same return shape — no bespoke
  `channel.onmessage` reader. The shared `extractLastUserText` helper is factored out (DRY across the
  in-process + channel transports). Runtime/definition/compile untouched (G2). ADR-0051.

## 0.27.0

### Minor Changes

- 069df66: **M41 — Unified typed agent client on the AI SDK `ChatTransport` seam (web + TUI).**

  `useAgent` is now ONE hook over one seam, driving the agent identically on every surface. It adopts the
  AI SDK's `ChatTransport` (already a peer dependency) as the transport interface and ships two
  implementations: `HttpTransport` (web — wraps the existing `POST /api/agents/<name>` UIMessageStream SSE,
  the `x-theokit-run-id` header, and the M37 durable reconnect endpoint, byte-identical to before) and
  `InProcessTransport` (terminal/desktop — wraps `streamAgentTurnInProcess`; `reconnectToStream` → `null`,
  mirroring the AI SDK's `DirectChatTransport`). `useAgent(pathOrTransport)` drives both: pass a path string
  (web, wrapped in `HttpTransport`) or an `AgentTransport` (the TUI passes an `InProcessTransport`). The
  hook's logic lives in a framework-agnostic `AgentClient` store bound via React's native
  `useSyncExternalStore` — no new dependency.

  The return shape gains two additive methods (existing call sites keep working): `approve(id, decision)`
  settles a paused HITL approval via the transport's HITL path (HTTP `POST /approve/<id>` for web; the
  inline callback in-process), and `reconnect()` resumes an interrupted stream (M37 for web; a no-op
  in-process). The generated `@theo/agents` client keeps the name-typed `useAgent<K>(name)` overload and
  adds a `useAgent(transport)` overload. Runtime, agent definition, and compile are untouched (client /
  boundary only — G2). Foundation of the theokit↔sdk integration DX track: M42 (Tauri `ChannelTransport` +
  reconnect parity), M43 (request-context/auth parity), M44 (standalone typed client-SDK) build on the same
  seam. See ADR-0050.

## 0.24.0

### Minor Changes

- **M37 — resumable / reconnectable agent streams (durable transport over SSE).**

  The durable-transport half of Mastra-style durable agents, over the existing `agents/*.ts → SSE` surface. Every agent run now carries a stable transport `runId` in the `x-theokit-run-id` response header, and each SSE frame gains a monotonic `id:` line. A new `GET /api/agents/<name>/runs/<runId>/stream` endpoint replays the frames a dropped client missed (via SSE-native `Last-Event-ID`) then follows the live tail — so a client can reconnect, or a second client observe a run a first started, without missing chunks. Frames are buffered in a per-run `RunEventCache` (in-memory default; a persistent backend plugs in behind the interface — no broker in core); the atomic `attach()` guarantees no gap / no dup across the reconnect boundary. Transport-only (ADR-0046): wraps `streamAgentUIMessages`, never a new loop — the agent loop + suspend/resume stay in `@theokit/sdk`. `untilIdle` + a shipped persistent cache backend are named follow-ups.

## 0.23.1

### Patch Changes

- Republish fix: 0.23.0 was accidentally published with an unresolved `@theokit/agents: workspace:^` dependency (npm publish does not rewrite the pnpm workspace protocol; #92 regression). 0.23.1 is published via `pnpm publish`, which rewrites it to a real version range. 0.23.0 is deprecated on npm.

## 0.23.0

### Minor Changes

- 0e01bc6: M35 — TUI terminal-only in-process surface (Model A).

  - `theokit/server` exports `streamAgentTurnInProcess(mod, apiKey, { message, awaitApproval? })`: run an
    agent turn in a SINGLE process — no HTTP loopback, no port, no CSRF — reusing `compileAgentModule` +
    `streamAgentUIMessages` (zero runtime reimplementation, G2). HITL is resolved INLINE via a caller
    `awaitApproval` callback (the Claude Code / Codex single-process shape); a gated agent run without a
    resolver throws `InProcessApprovalRequiredError` (fail-closed — the #99 lesson). Parity with the HTTP
    mount is by construction: both call the same `streamAgentUIMessages`.
  - `@theokit/agents` now publicly exports the `HitlDecision` type — the settled approval decision an
    `awaitApproval` resolver may return (bare boolean OR `{ approved, reason?, payload? }`).

### Patch Changes

- Updated dependencies [0e01bc6]
  - @theokit/agents@0.35.0

## 0.22.1

### Patch Changes

- Security: MCP `tools/call` no longer bypasses HITL approval (#99). A tool gated by `.approval()` /
  `@HumanInTheLoop` was executed unguarded when invoked via MCP `tools/call`; now `callTool` receives
  `compiled.hitl` and refuses a gated tool with an `isError` result before invoking the handler
  (fail-closed). Non-gated tools are unaffected.

## 0.16.0

### Minor Changes

- eb1b70e: Agent capabilities batch M9–M17.

  - **M9 Guardrails** — `defineAgent({ guardrails })`: input/output guards at the boundary (`promptInjectionDetector`, `piiDetector`, `unicodeNormalizer`, `costGuard`, `outputModeration`), input applied fail-fast, output moderated before reaching the client.
  - **M10 Lifecycle hooks** — `createToolHooksPlugin({ beforeToolCall, afterToolCall, beforeLLMCall, afterLLMCall })` over the SDK's native tool/LLM hooks.
  - **M11 Conversation scoping** — `deriveConversationId`/`parseConversationId` for collision-safe `{resource, thread}` isolation.
  - **M12 Delegation hooks** — `onDelegationStart`/`onDelegationComplete` on `delegate()` (+ abortSignal, docs).
  - **M13 Per-request skills resolver** — `defineAgent({ skills: (ctx) => string[] })` resolved against the run-context at mount.
  - **M14 HITL surface** — `defineAgent({ approvals })`, `GET /api/agents/:name/approvals`, `toolName` forwarded to the registry.
  - **M15 A2A** — `buildAgentCard` + served at `/.well-known/<name>/agent-card.json`; `createA2ATool` client with auth.
  - **M16 MCP** — `buildMcpToolDescriptors`/`mcpServerInfo` + served at `POST /api/agents/<name>/mcp` (JSON-RPC).
  - **M17 ACP** — `AcpMessageDecoder`/`encodeAcpMessage` framing, `AcpClient`, and `createACPTool` + `NodeAcpTransport` (subprocess) with a required `onPermissionRequest` gate.

  Governance: ADR-0040 (runtime-vs-home boundary).

### Patch Changes

- Updated dependencies [eb1b70e]
  - @theokit/agents@0.31.0

## 0.15.2

### Patch Changes

- 3a812f2: Fix: a fresh `npx create-theokit` failed `npm install` with an `@theokit/ui` peer `ERESOLVE`. `theokit`'s optional `@theokit/ui` peer range (`^0.14.0 || ^0.18.0 || ^0.19.0`) did not include the published stable major `@theokit/ui@1.0.0` that the default template pins (`^1.0.0`). npm is strict on optional-peer conflicts (pnpm only warns, which is why the M6 pnpm dogfood missed it). The peer range now includes `^1.0.0`. Proven end-to-end: a fresh scaffold installs (0 vulnerabilities) and `theokit build` succeeds. Regression-guarded by the `@theokit/ui` peer-range tests.

## 0.15.1

### Patch Changes

- 2302dcb: M6 dogfood fixes — two real V1 bugs surfaced by a live `npx create-theokit` run.

  - **Tool calls crashed** (`TypeError: ... reading 'def'`): `buildSdkTools` re-ran `defineAgentTool`'s
    already-lowered JSON-Schema tool through the SDK's `defineTool` (which expects a live Zod schema).
    It now routes by `inputSchema` shape — Zod schema → `defineTool`; already-SDK-ready `CustomTool`
    (JSON-Schema `inputSchema`) → forwarded raw. Regression test + confirmed minimal repro.
  - **Fresh scaffold failed to start** (`ERR_PACKAGE_PATH_NOT_EXPORTED` on `@theokit/sdk/compaction`):
    the default template pinned `@theokit/sdk@^1.1.0`, below the `@theokit/agents@0.30.0` peer floor
    (`>= 2.13.0`). Bumped the template + fixture pins to `^2.13.0`.

- Updated dependencies [2302dcb]
  - @theokit/agents@0.30.1

## 0.15.0

### Minor Changes

- 604bca9: Cohesive agent harness (M4, Eixo C) — make the shipped-but-dead `@HumanInTheLoop` + `@Checkpoint`
  decorators functional as an adapter over `@theokit/sdk`, with no parallel runtime (ADR 0038).

  - **`@HumanInTheLoop`** now pauses the run before a gated tool: the stream emits the ai-sdk-native
    `tool-approval-request` chunk and the run stays paused (the SDK's own awaited `pre_tool_call`
    hook) until `POST /api/agents/<name>/approve/<approvalId>` resolves it — approve runs the tool,
    deny/timeout surfaces the denial and the run continues.
  - **`@Checkpoint({ storage: 'filesystem' })`** emits a transient `data-checkpoint` part and selects
    the SDK's durable `FileSystemConversationStorage`, so a same-session follow-up request resumes.
  - The M2 file convention gathers a class agent's `@Mixin` toolboxes so a gated tool actually gates
    through the endpoint. `@theokit/agents` adds `createHitlPlugin`; `theokit` adds the approve route
    - in-process approval registry. Additive — the M2 surface is unchanged.

- 55d11ca: Terminal harness (M5, Eixo D) — run a local agent in the terminal, reusing the M4 harness with a
  Node-stdlib render surface (no new runtime, no TUI dependency; ADR 0039).

  - `theokit agent <name> "<message>"` scans `agents/<name>.ts`, compiles it via the M4
    `compileAgentModule` (through the framework's own Vite transpile), and runs it through
    `streamAgentUIMessages` — rendering streaming text, tool cards, a checkpoint notice, and errors to
    the terminal.
  - A `@HumanInTheLoop`-gated tool prompts `Approve <tool>? (y/N)` inline and resolves the SAME
    in-process approval registry the web approve-route uses (single-process CLI = the registry
    singleton's exact fit). A non-interactive terminal auto-denies (fail-safe).
  - New: `renderAgentStreamToTerminal` + `promptTerminalApproval` + `runAgentInTerminal` (injectable
    I/O for testability). Additive — the M2/M4 surface is unchanged.
  - `theokit agent` loads `.env` before resolving the provider key (parity with `theokit dev`), exits
    non-zero when the run ends in an error, and the approval prompt shares the gated tool's
    `@HumanInTheLoop` timeout so it can never hang the CLI after the run has settled.

### Patch Changes

- Updated dependencies [604bca9]
  - @theokit/agents@0.30.0

## 0.14.0

### Minor Changes

- 7a03feb: BREAKING — remove the pre-M2 proprietary agent surface (M3 clean break, no compat layer). Pre-1.0 convention: a breaking change rides a MINOR bump (0.13.0 → 0.14.0) until the deliberate 1.0 stability milestone — see the ROADMAP 1.0 stability lock. This is NOT the 1.0 release.

  Deleted: the `AgentEvent` SSE protocol (`theokit/core/contracts` `AgentEvent` + variants), the server producers `defineAgentEndpoint` / `streamAgentRun` / `createConversationHistory` (and the `theokit/server/agent` subpath export, removed entirely), and the client cluster `useAgentStream` / `deriveLiveText` / `deriveError` / `consumeAgentStream` / `parseSSEChunk` / `useAgentToolCards` / `foldAgentToolCards` / `defaultResolveEnvelope` (`theokit/client`).

  Use the M2 surface (shipped in 0.13.0): create a top-level `agents/<name>.ts` that `export default defineAgent({ input, model, system, tools })` (from `@theokit/agents`) — auto-served at `POST /api/agents/<name>` on the ai-sdk `UIMessageStream` wire — and consume it with `useAgent` / `consumeUIMessageStream` (`theokit/client`). `defineAgentTool`, `provider-resolver`, and the `@Agent` decorator are unchanged.

  Migration guide: `docs/migration/0.13-to-0.14-agent-surface.md`.

## 0.13.0

### Minor Changes

- a1182ae: Ship an agent by writing one file — the zero-config `agents/<name>.ts` convention (theokit-ai-first M2, Eixo B).

  Create a top-level `agents/support.ts` that default-exports `defineAgent({ input, model, system, tools })` and TheoKit auto-serves `POST /api/agents/support` at both `theokit dev` and the built server — streaming the M0/M1 canonical `UIMessageStream`. On the client, `import { useAgent } from '@theo/agents'` gives a typed React hook: `useAgent('support').send(input)` where `input` is inferred end-to-end from the agent's Zod schema via the generated `.theokit/agents.d.ts` — zero manual type wiring. The hook reconstructs the streamed assistant messages with the `ai` package's own `readUIMessageStream` (the exact reader `@ai-sdk/react`'s `useChat` runs — no reinvented parser); `theokit/client` also exports the pure `consumeUIMessageStream` and the base `useAgent(path)`.

  `@theokit/agents` gains `defineAgent` — the canonical zero-config surface (ADR 0037) — a pure normalizer to the same SDK-ready shape the `@Agent` class decorator produces, so both surfaces converge on one runtime (`@theokit/sdk` stays the sole agent runtime). New exports: `defineAgent`, `compileAgentModule`, `streamAgentUIMessages`, `AgentDefinitionError`, `InferAgentInput`.

  The build scans a top-level `agents/` directory and records each agent in the manifest; dev and prod mount through a single shared `mountAgent` point so they never drift. The request body accepts both the `useChat` shape (`{ messages }`) and a simple `{ message }`. Agent endpoints enforce CSRF (the `X-Theo-Action` header + Origin match, strict by default) at the same mode as routes/actions — a cross-origin POST that would spend LLM tokens is rejected with 403 before it reaches the SDK. A non-agent file or an unknown route fails fast with a typed error. `/api/agents/` is a reserved prefix (a manual route there is shadowed by design, like `/api/__actions/`).

  Agents live in a top-level `agents/` (sibling of `server/`) per the LOCKED naming decision (ADR 0037). Non-breaking: additive API on both packages; the existing route/action/ws scanners still ignore `agents/`.

### Patch Changes

- Updated dependencies [a1182ae]
  - @theokit/agents@0.29.0

## 0.12.1

### Patch Changes

- 2ddfab9: Fix the coordinated-release frozen-lockfile catch-22 (#64): `packages/theo` now consumes `@theokit/agents` and `@theokit/http` via `workspace:^` instead of published-version ranges. pnpm resolves the local package in dev (the lockfile no longer churns on a same-release version bump) and converts `workspace:^` to the identical `^X.Y.Z` range at publish time — the published manifest is byte-identical, so no consumer-visible change. Matches the existing `@theokit/agents → @theokit/http = workspace:*` pattern.
- Updated dependencies [2ddfab9]
  - @theokit/agents@0.28.0

## 0.12.0

### Minor Changes

- 403fdd7: A theokit agent's text stream now speaks the Vercel AI SDK `UIMessageStream` protocol, so `@ai-sdk/react`'s `useChat` renders it with no custom adapter (theokit-ai-first M0 walking skeleton).

  `@theokit/agents` adds `translateToUIMessageStream(events, { textId })` — a pure mapping of the agent text stream to ai-sdk `UIMessageChunk`s (`start → text-start → text-delta* → text-end → finish`), surfacing an upstream stream error as an ai-sdk `error` chunk before a graceful `finish` (never swallowed, never thrown past the boundary). `theokit/server/define` adds `uiMessageStreamResponse(chunks)`, which serializes them to an SSE `Response` on the exact wire `useChat` parses (`x-vercel-ai-ui-message-stream: v1` header + `data: [DONE]` terminal). `ai` is an optional `peerDependency` (with a devDependency for local build/tests) — zero runtime weight on the agent path; `@theokit/sdk` stays the sole runtime. Additive and backward-compatible: the existing `AgentEvent` SSE path is untouched (its removal is the M3 clean break).

### Patch Changes

- Updated dependencies [8842bc6]
- Updated dependencies [403fdd7]
  - @theokit/agents@0.27.0

## 0.11.7

### Patch Changes

- Updated dependencies [c85145d]
  - @theokit/agents@0.26.0

## 0.11.6

### Patch Changes

- 068fda0: Fix `defineAgentEndpoint` returning an empty (0-byte) SSE stream for every prompt on Node ≥ 23.

  Node 23 added `http.IncomingMessage.prototype.signal` — an `AbortSignal` that fires `abort` the instant the request body is fully received (`req.complete === true`), NOT when the client disconnects. `resolveAbortSignal` duck-typed a Web `Request` as "has `.signal` with `aborted` + `addEventListener`"; on Node 24 the Node `IncomingMessage` also satisfies that shape, so the wrapper returned the request-lifecycle signal — already aborted by the time the handler primes — and closed the stream before the first `yield`. Every agent response (chat, tool calls) came back empty on Node 24.

  The fix discriminates a Node `IncomingMessage` (an `EventEmitter`, `typeof r.on === 'function'`) from a Web `Request` (no `.on`): `r.signal` is trusted directly only when the request is not a Node object. For the Node path, client-disconnect is wired to the underlying socket close (`req.socket.on('close')` — the only event that means "client gone", never fires at request-body-end), with `req`'s own `'close'` guarded by `complete` to ignore Node ≥ 23 body-end noise. Regression covered by `tests/unit/regression-2-define-agent-endpoint-node23-signal.test.ts`.

## 0.11.5

### Patch Changes

- Updated dependencies
  - @theokit/agents@0.25.0

## 0.11.4

### Patch Changes

- f5fa904: Fix `theokit build --target theo-cloud` rejecting the current manifest schema. The manifest builder emits `version: 2` whenever a project name is configured, but the TheoCloud adapter hard-rejected anything other than `version === 1`, so the build failed the version gate before producing any artifact (usetheodev/theokit#9). The adapter now accepts both v1 (deprecated) and v2 manifests and reports the consumed `schemaVersion`; truly unknown versions still throw the forward-compat guard.

## 0.11.3

### Patch Changes

- Updated dependencies [6830737]
  - @theokit/agents@0.24.0

## 0.11.2

### Patch Changes

- Updated dependencies [a4f668f]
  - @theokit/agents@0.23.0

## 0.11.1

### Patch Changes

- Updated dependencies [9c04863]
  - @theokit/agents@0.22.0

## 0.11.0

### Minor Changes

- 2f5513c: Add `AgentThinkingEvent` (`{ type: 'thinking'; content: string }`) as a fifth variant of the `AgentEvent` wire contract, exported from `theokit/client`. Additive and non-breaking — the four existing variants are unchanged and consumers that switch only on the known types are unaffected. It mirrors the `@theokit/agents` stream-layer `ThinkingEvent`, so agent apps can carry the model's reasoning end-to-end instead of dropping it at the consumer's translation boundary. The framework's own SSE producer does not emit the variant yet (documented follow-up); the immediate consumer is theocode via the `@theokit/agents` `AgentRunner.stream()` path.

## 0.10.1

### Patch Changes

- Updated dependencies [20338f5]
  - @theokit/agents@0.21.0

## 0.10.0

### Minor Changes

- 8182aba: Add a `response` Zod slot to `RouteConfig` (runtime output validation in both the Node and Web runtimes) and a `params` schema to `defineAgentEndpoint` (typed, validated path params). The Web runtime now honors `config.status` for plain-object returns, matching the Node runtime.

## 0.9.15

### Patch Changes

- Updated dependencies [45f229a]
  - @theokit/agents@0.20.0

## 0.9.14

### Patch Changes

- Updated dependencies [01e9ea8]
  - @theokit/agents@0.19.0

## 0.9.13

### Patch Changes

- Updated dependencies [6d02c56]
  - @theokit/agents@0.18.0

## 0.9.12

### Patch Changes

- Updated dependencies [6ec6124]
  - @theokit/agents@0.17.0

## 0.9.11

### Patch Changes

- Updated dependencies [208ea7f]
  - @theokit/agents@0.16.0

## 0.9.10

### Patch Changes

- Updated dependencies [d69f7b4]
  - @theokit/agents@0.15.0

## 0.9.9

### Patch Changes

- Updated dependencies [6f1a757]
- Updated dependencies [a4e1c25]
  - @theokit/agents@0.14.0

## 0.9.8

### Patch Changes

- Updated dependencies [8811577]
  - @theokit/agents@0.13.0

## 0.9.7

### Patch Changes

- Updated dependencies [47dd837]
  - @theokit/agents@0.12.0

## 0.9.6

### Patch Changes

- Updated dependencies [b1c6a71]
  - @theokit/agents@0.11.0

## 0.9.5

### Patch Changes

- Updated dependencies [13a4abc]
  - @theokit/agents@0.10.0

## 0.9.4

### Patch Changes

- Updated dependencies [079f725]
  - @theokit/agents@0.9.0

## 0.9.3

### Patch Changes

- 45b1028: Declare `@theokit/sdk` as an **optional** `peerDependency` (`>=2.9.0`). Apps using the agent layer (`@theokit/agents`, which theokit depends on) need `@theokit/sdk >=2.9.0`; previously that requirement was only carried transitively via `@theokit/agents@0.8.0`'s peer. Now theokit signals it directly so consumers get a clear install-time message. Optional — apps that don't use the agent layer are unaffected (mirrors the `@theokit/ui` optional-peer pattern).

## 0.9.2

### Patch Changes

- Updated dependencies [0620275]
- Updated dependencies [0620275]
  - @theokit/agents@0.8.0

## 0.9.1

### Patch Changes

- V3-2 follow-up — extend the `@theokit/ui` peer to also accept `^0.19.0`. The V3-2 valibot security bump shipped as `@theokit/ui@0.19.0` (its `[Unreleased]` carried Added entries → minor), but the peer published in `theokit@0.9.0` only covered `^0.14.0 || ^0.18.0`, which excludes `0.19.0` (`^0.18.0` := `>=0.18.0 <0.19.0`) — re-opening the ERESOLVE the slice set out to fix. Peer is now `^0.14.0 || ^0.18.0 || ^0.19.0`; the loop (`theokit + @theokit/ui@0.19.0`) resolves without `--force`.

## 0.9.0

### Minor Changes

- 65266c1: V3-2 — widen the optional `@theokit/ui` peer from `^0.14.0` to `^0.14.0 || ^0.18.0`. The old range caused an `ERESOLVE` when an app installed `theokit` alongside `@theokit/ui@0.18.x` (`peerOptional @theokit/ui@"^0.14.0" from theokit` conflicting with `@theokit/ui@0.14.4`), pinning consumers to the 0.14.x line — which transitively carried the HIGH-severity `valibot` ReDoS advisory GHSA-vqpr-j7v3-hqw9 (cleared in `@theokit/ui@0.18.x`). Widening the peer is additive: existing 0.14.x consumers are unaffected (guarded by `tests/unit/ui-peer-range.test.ts`), and 0.18.x now resolves without `--force`.

## 0.8.3

### Patch Changes

- Updated dependencies
  - @theokit/agents@0.7.0

## 0.8.2

### Patch Changes

- Updated dependencies [d9012b4]
  - @theokit/agents@0.6.0

## 0.8.1

### Patch Changes

- Updated dependencies [fa1518b]
  - @theokit/agents@0.5.0

## 0.8.0

### Minor Changes

- eeb044a: M7 (Tema F) — HTTP dual-surface consolidation for the convention/filesystem-route server.

  - Typed errors / 404: `theokit/server/http` now exports `TheoError`, `fromUnknown`, `NotFoundError` (throw it for an ergonomic typed 404), `serverErrorToEnvelope`, and `envelopeCodeToStatus`. The legacy Node error path routes typed errors through the same envelope translator the web path uses (untyped errors keep the legacy `INTERNAL_ERROR` 500 + masking).
  - Health/readiness: `theokit/server/define` ships `defineHealthRoute`/`defineReadyRoute`, served on the reserved `/__theo/health` (always 200 `{status:"ok"}`) and `/__theo/ready` (200/503 from your probe — a throwing probe is not-ready, never a 500) before the user catch-all.
  - Programmatic boot: new `theokit/boot` subpath ships `createConventionFetchHandler({ reservedRoutes? })` returning a socketless `{ fetch, close }` handle.

  Zero new runtime dependencies.

## 0.7.0

### Minor Changes

- f0f8270: Agent chat surfaces now have ready-made views over the event stream — no manual reducing in your components.

  - `useAgentStream` returns two new derived fields: `liveText` (the assistant's reply so far, concatenated from every message chunk) and `error` (the last error event, with its `code`/`retriable` flags intact for branching).
  - New `useAgentToolCards` hook (and the pure `foldAgentToolCards` reducer behind it) turns the raw event stream into correlated tool cards — each with `running` / `success` / `error` status — so a tool-call UI is a `.map()` instead of a state machine. Cards correlate by event `id`, with a FIFO-by-name fallback when the transport omits ids; the success/error verdict comes from an injectable `resolveEnvelope` so you can match your own tool result shape.
  - All of the above are also exported as pure functions (`deriveLiveText`, `deriveError`, `foldAgentToolCards`, `defaultResolveEnvelope`) for use outside React.

## 0.6.1

### Patch Changes

- 18d8841: Internal architecture cleanup — no public API or behavior change:

  - The framework now enforces module `_internal/` privacy at the architecture-boundary level (a build-only guard; nothing changes at runtime).
  - `core/` is kept free of Node built-in imports; the public `validateProjectStructure` export is unchanged.
  - The Vite integration no longer depends on the framework server's internal file layout, so internal reorganizations won't ripple into build tooling.

## 0.6.0

### Minor Changes

- Dynamic **page** routing — file-system page routes now support `[param]` and catch-all `[...slug]` segments (parity with API routes).
- Web-Standards request path resolves route params and runs a middleware chain (`executeWebRequest` accepts `opts.params` + `opts.middleware`; middleware may mutate `context` or short-circuit with a `Response`).

### Patch Changes

- `defineAgentTool` now accepts a zod 4 `z.object(...)` input schema (the previous check only recognized the removed zod 3 `_def.typeName`, so every agent tool was rejected under zod 4 with "inputSchema must be a ZodObject"). This unblocks the default chat surface end-to-end.
- Server-action `FormData` → Zod coercion now coerces array elements; OpenAPI emitter migrated to zod 4 internals; `csrf?: false` exposed on `ActionConfig`.
- Native-bindings preflight restored (ABI-mismatch safeguard) and `engines.node >=22.12.0` declared.

## 0.4.0-beta.0

### Major Changes

- **BREAKING — Router convention lockdown.** Scanner rejects dotted route basenames (`auth.[provider].login.ts`) with `RouterConventionError`. Use directory-nested form (`auth/[provider]/login.ts`). Codemod `theokit migrate router` handles the upgrade automatically. See [`docs/migration/0.3-to-0.4-router.md`](../../docs/migration/0.3-to-0.4-router.md).
- **BREAKING — Bundled 0.3.0 security cutover.** CSRF default flips `warn` → `strict`; CSP default flips `report-only` → `enforce`. Apps not previously sending `X-Theo-Action: 1` on POSTs now get 403. Inline `<script>` without per-request nonce now blocks. Opt-out: `security.csrf: 'warn'` and `security.cspMode: 'report-only'` in `theo.config.ts`. See [`docs/migration/0.2-to-0.3.md`](../../docs/migration/0.2-to-0.3.md).
- **Skips 0.3.0 → goes directly to 0.4.0-beta.0** because the 0.3.0 cutover calendar window was abandoned in favor of bundling both breaking surfaces in one release.

### Added

- **`theokit migrate router` CLI subcommand** — dotted-to-nested codemod with `--dry-run`, `--force` (skip EC-2 dev-server pre-flight), idempotent re-run, partial-failure observability, EC-5 case-insensitive collision detection, EC-4 test/spec file filter. Rewrites relative imports inside moved files automatically.
- **`RouterConventionError` class** (`theokit/server/scan` barrel) emitted by `scanServerRoutes` when a dotted basename is encountered.
- **`vite-plugin/server-routes-hmr.ts`** — Vite watcher invalidation for `server/routes/**` with 50 ms debounce (EC-6) so the codemod's rename storm doesn't crash the dev server.

### Fixed

- **23 routes silently transitioned from unreachable to working** in the canonical dogfood-app after migration. Every dotted route was producing either a wrong `paramNames` shape OR a URL pattern with a literal dot that the client code never hit (audit: [`docs/audit/g6-router-dogfood-app-migration-2026-06-04.md`](../../docs/audit/g6-router-dogfood-app-migration-2026-06-04.md)).

## 0.2.1

### Patch Changes

- Align `theokit` version with `create-theokit@0.2.1` per the linked-changeset invariant. `create-theokit` was bumped on 2026-05-30 to ship the stranger-template fix (`openai/` model id prefix for OpenRouter routing); `theokit` was left at 0.2.0 by oversight. No functional changes — this is a version-sync patch only.

## 0.2.0

### Minor Changes

- e761aac: Add cache primitives to `theokit/server` — closes the largest production gap vs Next.js.

  Ships 5 new public primitives:
  - **`defineCachedRoute(engine, config)`** — cache HTTP route responses with SWR + tag invalidation. Set-Cookie auto-bypasses, status `>= 400` not cached by default, GET/HEAD only (override via `cache.methods`).
  - **`defineCachedFunction(engine, fn, opts)`** — memoize server functions. Built-in `.invalidate(...args)` method on the returned wrapper.
  - **`revalidateTag(tag, opts?)`** — fan-out invalidation by tag.
  - **`revalidatePath(path, opts?)`** — sugar over `revalidateTag('_THEO_T_/path')`.
  - **`updateTag(tag)`** — Server-Action-safe immediate invalidation.

  Plus the storage layer:
  - **`CacheStorageAdapter`** interface with 7 methods (`get`, `set`, `delete`, `deleteByTag`, `size`, `clear`, `keys`).
  - **`InMemoryCacheAdapter`** default implementation — LRU + reverse tag index, O(matched-keys) `deleteByTag`.
  - **`createCacheEngine({ storage })`** factory exposing `getOrCompute`, `invalidate`, `invalidateTag`, `revalidatePath`.
  - **`initCacheEngine(config)` / `getCacheEngine()` / `_resetCacheEngine()`** singleton resolver for framework wiring.

  Helpers:
  - **`getCacheControlHeader({ maxAge, swr, isPrivate? })`** — RFC 7234-compliant header builder.
  - **`deriveCacheKey(req, opts?)`** — URL+sorted-query key derivation with `DEFAULT_EXCLUDED_QUERY_PARAMS` (25 tracking params auto-stripped, mirrors Astro list).
  - **`compileRouteRules` / `resolveRouteRule`** — first-match-wins glob matching for `theo.config.ts cache.routeRules`.
  - **`validateCacheTags` / `validateCacheMaxAge` / `validateCacheExpire`** — defensive validators.
  - **Constants**: `CACHE_TAG_MAX_LENGTH = 256`, `CACHE_TAG_MAX_ITEMS = 128`, `THEO_T_PREFIX = '_THEO_T_'`, `CACHE_DEFAULT_MAX_AGE = 1`, `CACHE_DEFAULT_MAX_ENTRY_SIZE = 10 MB`.

  Config schema (`theo.config.ts`):

  ```ts
  cache: {
    enabled: true,
    storage: 'memory',                        // or custom CacheStorageAdapter
    maxEntries: 1000,
    defaults: { maxAge: 1, cacheErrors: false },
    routeRules: { '/api/static/**': { maxAge: 300, swr: 600 } },
  }
  ```

  Edge cases handled (catalogued in `docs/reviews/edge-case-plan/caching-and-revalidation-edge-cases-2026-05-23.md`):
  - **EC-1**: `validateTags` defensive guard for non-array input.
  - **EC-2**: `varies: ['cookie']` auto-filtered + warn-once (Astro `IGNORED_VARY_HEADERS` pattern).
  - **EC-3**: Response body > 10 MB bypasses cache + warn-once (configurable via `cache.maxEntrySize`).
  - **EC-4**: Cache middleware structurally runs AFTER user middleware — auth/session/CSRF always gate first (no data leak vector).
  - **EC-5**: `picomatch` declared as direct production dependency (was relying on Vite transitive — broken in production runtime).
  - **EC-8**: Clock-skew negative-age clamped via `Math.max(0, age)`.
  - **EC-9**: `validate` callback throws → treated as miss + `onError` invoked.
  - **EC-10**: Loader returning `undefined` warn-once + skipped from cache.
  - **EC-11**: `Transfer-Encoding: chunked` responses NOT cached.
  - **EC-19**: `cache.maxEntrySize` validated at config-time.

  New dep: `picomatch ^4.0.0` (direct, production — was transitive via Vite which broke prod).

  Documentation: `docs/concepts/caching.md` (full 5-pattern guide + Redis adapter recipe + comparison vs Next.js / Nitro / Astro / TanStack).

  Reference research: `.claude/knowledge-base/reference/caching-and-revalidation.md` (4 frameworks deep-read, 14 edge cases catalogued).

  Plan: `docs/plans/caching-and-revalidation-plan.md` (13 tasks across 8 phases, 13 ADRs, 138 RED tests, 100% coverage matrix).

  Fixture: `fixtures/cache-basic/` (all 5 primitives exercised + integration test).

  Backward compatibility: 100%. The `cache` config field is optional; existing apps without `cache:` in `theo.config.ts` see zero behavior change.

- ee1b596: **theokit-evolution-ci-and-dx onda — CI gates + template DX + devtools observability.**

  This release ships 6 deliverables from the `theokit-evolution-ci-and-dx-plan.md` v1.1:

  **Templates dogfood primitives 0.5.0 (Phase 2B):**
  - `default` + `dashboard` ship `server/crons/cleanup-conversations.ts` (daily GC of stale `.theokit/agents/*` >30d)
  - `api-only` ships `server/routes/webhooks/echo.ts` (HMAC-SHA256 self-signed pattern)
  - `postgres` ships `server/jobs/log-message.ts` (defineJob enqueue pattern, ADR-0003 transactional outbox compliant)
  - `saas` ships `server/routes/billing/stripe-webhook.ts` (Stripe HMAC verify) + wires `trackAgentRun` in `server/routes/agent.ts`

  **README docs link (Phase 2A):**
  - All 5 templates ship `📚 Full docs: https://docs.theokit.dev` in header

  **Devtools `Agents` tab (Phase 3):**
  - New tab in devtools panel showing per-run telemetry: time, user, model, tokens in/out, cost USD, status
  - `dispatcher.onAgentRun(record)` wired from `trackAgentRun` in dev mode
  - Tree-shaken in prod via universal `__IS_DEV` IIFE guard (Vite OR tsup) — devtools-treeshake test stays GREEN
  - Ring buffer cap RING_BUFFER_CAP (50) for high-throughput resilience
  - Reducer: `AGENT_RUN_ADD` + `RESET_AGENT_RUNS` actions

  **Internals:**
  - `AgentRunRecord` type + `CHANNEL_AGENT_RUN` channel in `devtools/shared.ts`
  - `trackAgentRun` extended with optional `status` field (default 'finished')

  No breaking changes; all wiring is additive + opt-in via dev mode.

- 4b97fee: TheoUI default integration — `npx create-theokit my-app` now scaffolds a working agent surface out of the box.

  **`theokit`** (`0.1.0-alpha.2`)
  - `defineAgentEndpoint({ handler })` (`theokit/server`) — sugar over `defineRoute` that turns an `async *handler(): AsyncGenerator<AgentEvent>` into a Server-Sent Events response. Standards-compliant `text/event-stream` framing; respects `request.signal` for prompt cancellation; emits a final `{ type: 'error', message }` event when the generator throws.
  - `useAgentStream(path, options?)` (`theokit/client`) — React hook returning `{ events, status, send, abort, reset }`. Transport is `fetch + ReadableStream` (not `EventSource` — POST + body required). Cleans up on unmount (StrictMode-safe).
  - `consumeAgentStream(path, options)` + `parseSSEChunk(line)` (`theokit/client`) — the pure primitive the hook glues, exposed for non-React consumers and for tests.
  - Runtime `AgentEvent` discriminated union (`message | tool_call | tool_result | error`) exported from `theokit/server` and `theokit/client`. Server emits, client consumes — no cross-package type coupling with `@theokit/ui`.
  - Auto-injection of `@theokit/ui` in the dev/build pipeline: when the user's project declares `@theokit/ui` as a dependency and the package resolves, the Vite plugin emits `import '@theokit/ui/styles.css'`, `import '@theokit/ui/fonts.css'` (or `fonts-cdn.css` when configured), and wraps `RouterProvider` in `<TheoUIProvider theme={{ defaultTheme }}>`. New optional `ui` field in `theo.config.ts` (`false | { theme, fonts }`) for opt-out and theme selection. Conservative detection: package must be declared in `package.json` AND resolvable — prevents false positives in monorepos.

  **`create-theokit`** (`0.1.0-alpha.2`)
  - Default template now scaffolds an **agent surface**: `app/page.tsx` ships `AgentComposer` + `AgentTimeline` from `@theokit/ui`, `server/routes/chat.ts` is a mock SSE endpoint emitting three `AgentEvent`s. Replace the mock with your real LLM provider.
  - New `--bare` flag — skips the TheoUI defaults for users who want a minimal scaffold. Atomic rollback: if the bare transform fails for any reason (filesystem perms etc.), the entire target directory is removed so no half-scaffolded project is left behind. `--bare` is only valid with `--template=default`.
  - `@theokit/ui ^0.1.0-next.0` is now a direct dependency of the default template.

- ee1b596: **0.2.0 — Exit alpha + enforcement cutover (CSRF strict + CSP enforce).**

  This release ends the `0.1.0-alpha.*` series and ships TheoKit's first `minor` on the `latest` npm tag. It combines the maturity work consolidated under the macro-roadmap convergence list (items #1-#6 done: scaffold + agent surface + canonical chat via `@theokit/sdk` + `defineAgentTool` + `streamAgentRun` + `createConversationHistory` + example `full-stack-agent`) with the security defaults flip previously planned as 0.3.0 (commit `3ee9dac`).

  **BREAKING (per pre-1.0 semver — `minor` = breaking until 1.0):**
  - `config.security.csrf` default flipped from `'warn'` → **`'strict'`**. Every non-GET request without the `X-Theo-Action: 1` header now returns 403 `CSRF_INVALID`. The framework's own `useAgentStream` already attaches this header (`packages/theo/src/client/agent-stream-core.ts:75`); custom fetchers, raw `<form>` posts, third-party clients, and curl-based integrations must attach the header explicitly or set `csrf: 'warn'` / `csrf: 'off'` in `defineConfig` during migration.
  - `config.security.headers.cspMode` default flipped from `'report-only'` → **`'enforce'`**. Inline scripts without a per-request nonce are blocked. The SSR hydration data script the framework emits carries the nonce automatically (T7.4 wiring verified by `tests/e2e/ssr-nonce.spec.ts` 3/3 GREEN). Third-party widgets (gtag, intercom, sentry, Plausible) and any user-authored inline `<script>` must either use the nonce mechanism or set `cspMode: 'report-only'` during migration.

  **Migration path:**
  - See `docs/migration/0.2-to-0.3.md` for the audit-grep recipes (`grep '"event":"csrf.warn"' logs.json | jq '.path'` to enumerate affected endpoints).
  - Run `theokit check --upgrade-readiness 0.3` (CLI command shipped) for a static analysis of inline scripts in your `app/**` tree.
  - If you cannot fix immediately: opt out in `theo.config.ts` via `defineConfig({ security: { csrf: 'warn', headers: { cspMode: 'report-only' } } })` and migrate at your pace.

  **Also in this release:**
  - All maturity-hardening primitives (jobs / crons / webhooks / cost tracking / transactional outbox / W3C trace context).
  - TheoCloud adapter Wave 2 stub registered (Wave 3 K8s manifest emission ships in 0.6.0).
  - Devtools overlay (auto-injected dev-only floating chip + 5-tab panel).
  - Argon2id password hashing in `examples/agent-saas` via `hash-wasm`.
  - Playwright coverage for all 5 templates (`default`, `dashboard`, `api-only`, `postgres`, `saas`).
  - Native bindings preflight (`scripts/preflight-native-bindings.mjs`) detects + auto-rebuilds `better-sqlite3` ABI mismatch on test setup. See CLAUDE.md > "Native bindings discipline".

  **Honest residual:**

  The 4-6 week warn-mode telemetry window from the original 0.3.0 plan is collapsed into a single 0.2.0 release for shipping pragmatism. Consumers who need a true warn-mode interim should pin `0.1.0-alpha.17` (last alpha) and use the migration guide to transition deliberately.

### Patch Changes

- ee1b596: **FAANG-grade provider routing — Strategy + Registry pattern.**

  Provider resolution moved from per-template conditionals into a centralized Strategy + Registry inside `theokit/server`. Consumers (template `chat.ts`, fixtures) now ship **zero conditionals on provider** — the framework resolves `apiKey` + `baseUrl` automatically from the highest-priority env var present (`OPENROUTER_API_KEY` > `OPENAI_API_KEY` > `ANTHROPIC_API_KEY`).

  Inspired by Dapr Conversation Registry (`dapr/pkg/components/conversation/registry.go`) and Encore Manager provider array (`encore/runtimes/go/pubsub/manager_internal.go`).

  **New public API in `theokit/server`:**
  - `resolveProvider(): ResolvedProvider` — throws actionable error if no env var present
  - `tryResolveProvider(): ResolvedProvider | null` — graceful degradation
  - `registerProvider(descriptor: ProviderDescriptor): void` — runtime extension point (idempotent by name)
  - `resetProviderRegistry(): void` — test-only / dev escape hatch
  - `listProviders(): readonly ProviderDescriptor[]` — sorted by priority

  **`createConversationHistory` upgrade:** auto-injects `apiKey` + `providers.routes[0]` (capability=chat) into SDK options when consumer omits `options.apiKey`. Explicit `options.apiKey` always wins (escape hatch preserved).

  **Template `chat.ts` is now FAANG-clean** — pure `model: { id: 'gpt-4o-mini' }`, no `process.env.*` reads, no provider conditionals, no manual error yields.

  **Wire protocol:** OpenAI Chat Completions (universal — every provider implements it). Anthropic uses native Messages API behind the same Strategy abstraction.

- ee1b596: **Chaos helper `chaos-providers.sh` invalid-key scenario: env injection fix.**

  Previously the helper edited the sandbox `.env` to set an invalid OPENROUTER_API_KEY,
  but the parent shell's exported `OPENROUTER_API_KEY` (valid) won the precedence
  contest (process.env > .env file). The chaos test never exercised the actual
  auth-failure code path → false-negative "no error surfaced" finding.

  Fix: helper now passes invalid key via explicit `env "OPENROUTER_API_KEY=..."`
  before `theokit dev`, overriding parent shell. Now confirmed end-to-end:
  - OpenRouter returns HTTP 401
  - SDK surfaces error
  - Template `chat.ts` try/catch yields `{type:'error',message:'...auth_failed (HTTP 401)...'}`
  - Helper detects error in SSE response → PASS

  Vendored copy at `theokit/scripts/dogfood/chaos-providers.sh` byte-identical
  to meta-repo source (parity test `dogfood-helpers-vendor-parity.test.ts`
  enforces).

  Phase 5 dogfood QA final state: **100/100** (4/4 chaos PASS + 4/4 multi-template
  PASS + 6/7 lifecycle PASS — the 1 remaining lifecycle SKIP is INTERACTIVE_ONLY
  phases per plan design).

- 57cc1e4: Consolidate `theokit/react-query` as a subpath of the canonical `theokit` package.

  Previously the React Query bridge lived in two places:
  - `theokit/client` (canonical implementation)
  - A separate `packages/theokit-react-query/` package that was set to publish as `@theokit/react-query@0.2.0` but never made it to the registry (scope didn't exist).

  The split duplicated code and forced consumers to manage an extra npm dependency for what is naturally a subpath of TheoKit. The standalone package has been removed from the monorepo.

  **New surface:**

  ```ts
  import { stableQueryKey, buildUseTheoQueryConfig } from 'theokit/react-query'
  ```

  Aliases `buildUseTheoQueryInternals`, `FetcherFn`, and `UseTheoQueryInternals` are re-exported under the same subpath to preserve the names that pre-release builds of the standalone package exposed.

  This is a purely additive change — `theokit/client` continues to expose the same primitives. No code needs to change for existing users.

- ee1b596: **Templates DX overhaul + scaffold SDK wiring (fix EC-S2/S3/S6 do dogfood-stranger run 2026-05-28)**
  - **`create-theokit` templates** (default/dashboard/api-only/postgres/saas):
    - Scripts completos: `dev` + `build` + `start` + `typecheck` declarados em todos
    - `.nvmrc` com `22.12` em todos
    - `public/favicon.ico` em todos (resolve 404 cosmético EC-S8)
    - `drizzle-kit` em devDeps de postgres + saas (EC-10 SHOULD TEST)
  - **`theokit` framework** (theokit/packages/theo):
    - `vite-plugin/theoui-detect.ts` refatorado: substituído `createRequire(...).resolve()` por filesystem walk + leitura de `package.json:exports[subpath]`. **Resolve EC-S4 root cause** (Page não hidratava) — Chrome MCP confirmou `<main>`, `<header>`, `<textarea>` agora renderizam.
    - `vite-plugin/auto-detect.ts` refatorado: mesma técnica filesystem walk (eliminação de `createRequire`).
    - D13 invariant gated por `tests/integration/no-require-on-esm-only-deps.test.ts` (2 BDD it()) — previne regressão de require em `@theokit/ui` (ESM-only by design).
    - Playwright spec `tests/e2e/scaffold-page-hydrates.spec.ts` (4 BDD it()) — required CI check para hydration regression.

  ADRs:
  - [`theokit/docs/adr/0021-dogfood-stranger-coverage-expansion.md`](docs/adr/0021-dogfood-stranger-coverage-expansion.md) — D4-D14
  - [`theokit/docs/adr/0022-create-theokit-republish-with-sdk-wired.md`](docs/adr/0022-create-theokit-republish-with-sdk-wired.md) — D2/D3/D10

  Plan: [`.claude/knowledge-base/plans/dogfood-fixes-and-coverage-expansion-plan.md`](../../.claude/knowledge-base/plans/dogfood-fixes-and-coverage-expansion-plan.md) v1.1 FAANG-grade.

- ee1b596: **Finding A fix: fail-fast when no provider env + no explicit apiKey.**

  Pre-fix: `createConversationHistory` called `tryResolveProvider()` (non-throwing
  graceful), then passed undefined apiKey to SDK's `Agent.getOrCreate`. SDK
  exhibited an undocumented silent-fallback behavior — returning a canned LLM-
  shape response `"Hello! How can I assist you today?"` regardless of input.
  Stranger sem KEY pensava que o agente funcionava.

  Post-fix: `createConversationHistory` now throws actionable error when:
  - No `options.apiKey` passed (consumer override)
  - AND no `OPENROUTER_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` env

  Template's try/catch yields `{type:'error',message:'Agent error: No LLM provider API key...'}`
  SSE event with link to OpenRouter signup. Stranger now sees actionable instruction.

  Workaround for users with manual auth flow: pass `options.apiKey` explicitly —
  auto-resolution is bypassed.

  Empirically validated end-to-end (sdk-residual-behavior-2026-05-28.md):
  - `POST /api/chat` without provider env → `{type:'error',message:'...'}`
  - Unit tests: 2 new regression gates (`Finding A: throws...` + `Finding A: explicit apiKey bypasses...`)
  - Full suite 21/21 GREEN

- 4b97fee: Hotfix: default template now declares `react-router` and `zod` (theokit peer dependencies). Without these, `pnpm dev` failed immediately on a freshly scaffolded project — entry-client couldn't resolve `react-router`, and `server/routes/chat.ts` couldn't resolve `zod`. Found by running `pnpm dlx create-theokit my-app` end-to-end against the published packages. Regression test added in `tests/unit/scaffold-default-agent.test.ts` to keep peer deps locked to the template.

  Also bumps the template's `theokit` pin to `^0.1.0-alpha.4` so freshly scaffolded projects pick up this hotfix.

- ee1b596: **Template default chat.ts: surface provider errors as AgentEvent `error`.**

  Pre-fix: `streamAgentRun(run)` could silently close SSE when SDK throws on
  invalid OPENROUTER_API_KEY / rate-limit / model-not-found / 5xx. Client saw
  a closed stream with no actionable message — stranger lost context.

  Post-fix: full agent lifecycle wrapped in try/catch + caught exceptions
  yield `{ type: 'error', message: ... }` AgentEvent. Dogfood chaos Phase 12
  (invalid-key) now PASSES end-to-end.

  Validated via `run-headless.sh` Phase 5 dogfood automation
  (`dogfood-fixes-and-coverage-expansion-plan.md` v1.1 Phase 5).

- ee1b596: **Template fix: `pnpm.onlyBuiltDependencies: ["esbuild"]` para destravar pnpm 11+ approve-builds gate.**

  Sem esse hint, `pnpm install` + `theokit dev` falham com `ERR_PNPM_IGNORED_BUILDS` em pnpm 11+ (security default: build scripts de transitivas como esbuild não rodam sem aprovação explícita). Como esbuild é dep transitiva mandatória do Vite, declaramos o opt-in nos 5 templates oficiais (default, dashboard, api-only, postgres, saas).

  Stranger executando `npx create-theokit my-app && cd my-app && pnpm install && pnpm dev` agora funciona end-to-end sem `pnpm approve-builds` interactive prompt.

- ee1b596: **Template SDK bump → `@theokit/sdk@^1.2.0` (D14 fault injection available).**

  New scaffolds get the SDK with `THEOKIT_TEST_RESPONSE_OVERRIDE` fault-injection seam built in. Documented in the SDK's `docs.md` § "Test fault injection (v1.22+)". Use in `dogfood-stranger` Phase 13 (rate-limit chaos) for zero-cost / zero-quota-burn deterministic 429 / 5xx / 401 scenarios.

  No theokit code changes — this is a template-side dep bump.

- ee1b596: Bump `@theokit/ui` peerDep range from `^0.11.0-next.0` to `^0.12.0-next.0` (alinha com create-theokit templates pós-T1.1 dist-tag move).

## 0.1.0-alpha.17

### Patch Changes

- **Finding A fix: fail-fast when no provider env + no explicit apiKey.**

  Pre-fix: `createConversationHistory` called `tryResolveProvider()` (non-throwing
  graceful), then passed undefined apiKey to SDK's `Agent.getOrCreate`. SDK
  exhibited an undocumented silent-fallback behavior — returning a canned LLM-
  shape response `"Hello! How can I assist you today?"` regardless of input.
  Stranger sem KEY pensava que o agente funcionava.

  Post-fix: `createConversationHistory` now throws actionable error when:
  - No `options.apiKey` passed (consumer override)
  - AND no `OPENROUTER_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` env

  Template's try/catch yields `{type:'error',message:'Agent error: No LLM provider API key...'}`
  SSE event with link to OpenRouter signup. Stranger now sees actionable instruction.

  Workaround for users with manual auth flow: pass `options.apiKey` explicitly —
  auto-resolution is bypassed.

  Empirically validated end-to-end (sdk-residual-behavior-2026-05-28.md):
  - `POST /api/chat` without provider env → `{type:'error',message:'...'}`
  - Unit tests: 2 new regression gates (`Finding A: throws...` + `Finding A: explicit apiKey bypasses...`)
  - Full suite 21/21 GREEN

## 0.1.0-alpha.16

### Patch Changes

- **Chaos helper `chaos-providers.sh` invalid-key scenario: env injection fix.**

  Previously the helper edited the sandbox `.env` to set an invalid OPENROUTER_API_KEY,
  but the parent shell's exported `OPENROUTER_API_KEY` (valid) won the precedence
  contest (process.env > .env file). The chaos test never exercised the actual
  auth-failure code path → false-negative "no error surfaced" finding.

  Fix: helper now passes invalid key via explicit `env "OPENROUTER_API_KEY=..."`
  before `theokit dev`, overriding parent shell. Now confirmed end-to-end:
  - OpenRouter returns HTTP 401
  - SDK surfaces error
  - Template `chat.ts` try/catch yields `{type:'error',message:'...auth_failed (HTTP 401)...'}`
  - Helper detects error in SSE response → PASS

  Vendored copy at `theokit/scripts/dogfood/chaos-providers.sh` byte-identical
  to meta-repo source (parity test `dogfood-helpers-vendor-parity.test.ts`
  enforces).

  Phase 5 dogfood QA final state: **100/100** (4/4 chaos PASS + 4/4 multi-template
  PASS + 6/7 lifecycle PASS — the 1 remaining lifecycle SKIP is INTERACTIVE_ONLY
  phases per plan design).

## 0.1.0-alpha.15

### Patch Changes

- **Template default chat.ts: surface provider errors as AgentEvent `error`.**

  Pre-fix: `streamAgentRun(run)` could silently close SSE when SDK throws on
  invalid OPENROUTER_API_KEY / rate-limit / model-not-found / 5xx. Client saw
  a closed stream with no actionable message — stranger lost context.

  Post-fix: full agent lifecycle wrapped in try/catch + caught exceptions
  yield `{ type: 'error', message: ... }` AgentEvent. Dogfood chaos Phase 12
  (invalid-key) now PASSES end-to-end.

  Validated via `run-headless.sh` Phase 5 dogfood automation
  (`dogfood-fixes-and-coverage-expansion-plan.md` v1.1 Phase 5).

## 0.1.0-alpha.14

### Minor Changes

- **theokit-evolution-ci-and-dx onda — CI gates + template DX + devtools observability.**

  This release ships 6 deliverables from the `theokit-evolution-ci-and-dx-plan.md` v1.1:

  **Templates dogfood primitives 0.5.0 (Phase 2B):**
  - `default` + `dashboard` ship `server/crons/cleanup-conversations.ts` (daily GC of stale `.theokit/agents/*` >30d)
  - `api-only` ships `server/routes/webhooks/echo.ts` (HMAC-SHA256 self-signed pattern)
  - `postgres` ships `server/jobs/log-message.ts` (defineJob enqueue pattern, ADR-0003 transactional outbox compliant)
  - `saas` ships `server/routes/billing/stripe-webhook.ts` (Stripe HMAC verify) + wires `trackAgentRun` in `server/routes/agent.ts`

  **README docs link (Phase 2A):**
  - All 5 templates ship `📚 Full docs: https://docs.theokit.dev` in header

  **Devtools `Agents` tab (Phase 3):**
  - New tab in devtools panel showing per-run telemetry: time, user, model, tokens in/out, cost USD, status
  - `dispatcher.onAgentRun(record)` wired from `trackAgentRun` in dev mode
  - Tree-shaken in prod via universal `__IS_DEV` IIFE guard (Vite OR tsup) — devtools-treeshake test stays GREEN
  - Ring buffer cap RING_BUFFER_CAP (50) for high-throughput resilience
  - Reducer: `AGENT_RUN_ADD` + `RESET_AGENT_RUNS` actions

  **Internals:**
  - `AgentRunRecord` type + `CHANNEL_AGENT_RUN` channel in `devtools/shared.ts`
  - `trackAgentRun` extended with optional `status` field (default 'finished')

  No breaking changes; all wiring is additive + opt-in via dev mode.

## 0.1.0-alpha.13

### Patch Changes

- **Template fix: `pnpm.onlyBuiltDependencies: ["esbuild"]` para destravar pnpm 11+ approve-builds gate.**

  Sem esse hint, `pnpm install` + `theokit dev` falham com `ERR_PNPM_IGNORED_BUILDS` em pnpm 11+ (security default: build scripts de transitivas como esbuild não rodam sem aprovação explícita). Como esbuild é dep transitiva mandatória do Vite, declaramos o opt-in nos 5 templates oficiais (default, dashboard, api-only, postgres, saas).

  Stranger executando `npx create-theokit my-app && cd my-app && pnpm install && pnpm dev` agora funciona end-to-end sem `pnpm approve-builds` interactive prompt.

## 0.1.0-alpha.12

### Patch Changes

- **Template SDK bump → `@theokit/sdk@^1.2.0` (D14 fault injection available).**

  New scaffolds get the SDK with `THEOKIT_TEST_RESPONSE_OVERRIDE` fault-injection seam built in. Documented in the SDK's `docs.md` § "Test fault injection (v1.22+)". Use in `dogfood-stranger` Phase 13 (rate-limit chaos) for zero-cost / zero-quota-burn deterministic 429 / 5xx / 401 scenarios.

  No theokit code changes — this is a template-side dep bump.

## 0.1.0-alpha.11

### Patch Changes

- **FAANG-grade provider routing — Strategy + Registry pattern.**

  Provider resolution moved from per-template conditionals into a centralized Strategy + Registry inside `theokit/server`. Consumers (template `chat.ts`, fixtures) now ship **zero conditionals on provider** — the framework resolves `apiKey` + `baseUrl` automatically from the highest-priority env var present (`OPENROUTER_API_KEY` > `OPENAI_API_KEY` > `ANTHROPIC_API_KEY`).

  Inspired by Dapr Conversation Registry (`dapr/pkg/components/conversation/registry.go`) and Encore Manager provider array (`encore/runtimes/go/pubsub/manager_internal.go`).

  **New public API in `theokit/server`:**
  - `resolveProvider(): ResolvedProvider` — throws actionable error if no env var present
  - `tryResolveProvider(): ResolvedProvider | null` — graceful degradation
  - `registerProvider(descriptor: ProviderDescriptor): void` — runtime extension point (idempotent by name)
  - `resetProviderRegistry(): void` — test-only / dev escape hatch
  - `listProviders(): readonly ProviderDescriptor[]` — sorted by priority

  **`createConversationHistory` upgrade:** auto-injects `apiKey` + `providers.routes[0]` (capability=chat) into SDK options when consumer omits `options.apiKey`. Explicit `options.apiKey` always wins (escape hatch preserved).

  **Template `chat.ts` is now FAANG-clean** — pure `model: { id: 'gpt-4o-mini' }`, no `process.env.*` reads, no provider conditionals, no manual error yields.

  **Wire protocol:** OpenAI Chat Completions (universal — every provider implements it). Anthropic uses native Messages API behind the same Strategy abstraction.

## 0.1.0-alpha.8

### Patch Changes

- Bump `@theokit/ui` peerDep range from `^0.11.0-next.0` to `^0.12.0-next.0` (alinha com create-theokit templates pós-T1.1 dist-tag move).

## 0.1.0-alpha.6

### Minor Changes

- e761aac: Add cache primitives to `theokit/server` — closes the largest production gap vs Next.js.

  Ships 5 new public primitives:
  - **`defineCachedRoute(engine, config)`** — cache HTTP route responses with SWR + tag invalidation. Set-Cookie auto-bypasses, status `>= 400` not cached by default, GET/HEAD only (override via `cache.methods`).
  - **`defineCachedFunction(engine, fn, opts)`** — memoize server functions. Built-in `.invalidate(...args)` method on the returned wrapper.
  - **`revalidateTag(tag, opts?)`** — fan-out invalidation by tag.
  - **`revalidatePath(path, opts?)`** — sugar over `revalidateTag('_THEO_T_/path')`.
  - **`updateTag(tag)`** — Server-Action-safe immediate invalidation.

  Plus the storage layer:
  - **`CacheStorageAdapter`** interface with 7 methods (`get`, `set`, `delete`, `deleteByTag`, `size`, `clear`, `keys`).
  - **`InMemoryCacheAdapter`** default implementation — LRU + reverse tag index, O(matched-keys) `deleteByTag`.
  - **`createCacheEngine({ storage })`** factory exposing `getOrCompute`, `invalidate`, `invalidateTag`, `revalidatePath`.
  - **`initCacheEngine(config)` / `getCacheEngine()` / `_resetCacheEngine()`** singleton resolver for framework wiring.

  Helpers:
  - **`getCacheControlHeader({ maxAge, swr, isPrivate? })`** — RFC 7234-compliant header builder.
  - **`deriveCacheKey(req, opts?)`** — URL+sorted-query key derivation with `DEFAULT_EXCLUDED_QUERY_PARAMS` (25 tracking params auto-stripped, mirrors Astro list).
  - **`compileRouteRules` / `resolveRouteRule`** — first-match-wins glob matching for `theo.config.ts cache.routeRules`.
  - **`validateCacheTags` / `validateCacheMaxAge` / `validateCacheExpire`** — defensive validators.
  - **Constants**: `CACHE_TAG_MAX_LENGTH = 256`, `CACHE_TAG_MAX_ITEMS = 128`, `THEO_T_PREFIX = '_THEO_T_'`, `CACHE_DEFAULT_MAX_AGE = 1`, `CACHE_DEFAULT_MAX_ENTRY_SIZE = 10 MB`.

  Config schema (`theo.config.ts`):

  ```ts
  cache: {
    enabled: true,
    storage: 'memory',                        // or custom CacheStorageAdapter
    maxEntries: 1000,
    defaults: { maxAge: 1, cacheErrors: false },
    routeRules: { '/api/static/**': { maxAge: 300, swr: 600 } },
  }
  ```

  Edge cases handled (catalogued in `docs/reviews/edge-case-plan/caching-and-revalidation-edge-cases-2026-05-23.md`):
  - **EC-1**: `validateTags` defensive guard for non-array input.
  - **EC-2**: `varies: ['cookie']` auto-filtered + warn-once (Astro `IGNORED_VARY_HEADERS` pattern).
  - **EC-3**: Response body > 10 MB bypasses cache + warn-once (configurable via `cache.maxEntrySize`).
  - **EC-4**: Cache middleware structurally runs AFTER user middleware — auth/session/CSRF always gate first (no data leak vector).
  - **EC-5**: `picomatch` declared as direct production dependency (was relying on Vite transitive — broken in production runtime).
  - **EC-8**: Clock-skew negative-age clamped via `Math.max(0, age)`.
  - **EC-9**: `validate` callback throws → treated as miss + `onError` invoked.
  - **EC-10**: Loader returning `undefined` warn-once + skipped from cache.
  - **EC-11**: `Transfer-Encoding: chunked` responses NOT cached.
  - **EC-19**: `cache.maxEntrySize` validated at config-time.

  New dep: `picomatch ^4.0.0` (direct, production — was transitive via Vite which broke prod).

  Documentation: `docs/concepts/caching.md` (full 5-pattern guide + Redis adapter recipe + comparison vs Next.js / Nitro / Astro / TanStack).

  Reference research: `.claude/knowledge-base/reference/caching-and-revalidation.md` (4 frameworks deep-read, 14 edge cases catalogued).

  Plan: `docs/plans/caching-and-revalidation-plan.md` (13 tasks across 8 phases, 13 ADRs, 138 RED tests, 100% coverage matrix).

  Fixture: `fixtures/cache-basic/` (all 5 primitives exercised + integration test).

  Backward compatibility: 100%. The `cache` config field is optional; existing apps without `cache:` in `theo.config.ts` see zero behavior change.

### Patch Changes

- **Templates DX overhaul + scaffold SDK wiring (fix EC-S2/S3/S6 do dogfood-stranger run 2026-05-28)**
  - **`create-theokit` templates** (default/dashboard/api-only/postgres/saas):
    - Scripts completos: `dev` + `build` + `start` + `typecheck` declarados em todos
    - `.nvmrc` com `22.12` em todos
    - `public/favicon.ico` em todos (resolve 404 cosmético EC-S8)
    - `drizzle-kit` em devDeps de postgres + saas (EC-10 SHOULD TEST)
  - **`theokit` framework** (theokit/packages/theo):
    - `vite-plugin/theoui-detect.ts` refatorado: substituído `createRequire(...).resolve()` por filesystem walk + leitura de `package.json:exports[subpath]`. **Resolve EC-S4 root cause** (Page não hidratava) — Chrome MCP confirmou `<main>`, `<header>`, `<textarea>` agora renderizam.
    - `vite-plugin/auto-detect.ts` refatorado: mesma técnica filesystem walk (eliminação de `createRequire`).
    - D13 invariant gated por `tests/integration/no-require-on-esm-only-deps.test.ts` (2 BDD it()) — previne regressão de require em `@theokit/ui` (ESM-only by design).
    - Playwright spec `tests/e2e/scaffold-page-hydrates.spec.ts` (4 BDD it()) — required CI check para hydration regression.

  ADRs:
  - [`theokit/docs/adr/0021-dogfood-stranger-coverage-expansion.md`](docs/adr/0021-dogfood-stranger-coverage-expansion.md) — D4-D14
  - [`theokit/docs/adr/0022-create-theokit-republish-with-sdk-wired.md`](docs/adr/0022-create-theokit-republish-with-sdk-wired.md) — D2/D3/D10

  Plan: [`.claude/knowledge-base/plans/dogfood-fixes-and-coverage-expansion-plan.md`](../../.claude/knowledge-base/plans/dogfood-fixes-and-coverage-expansion-plan.md) v1.1 FAANG-grade.

## 0.1.0-alpha.5

### Patch Changes

- Consolidate `theokit/react-query` as a subpath of the canonical `theokit` package.

  Previously the React Query bridge lived in two places:
  - `theokit/client` (canonical implementation)
  - A separate `packages/theokit-react-query/` package that was set to publish as `@theokit/react-query@0.2.0` but never made it to the registry (scope didn't exist).

  The split duplicated code and forced consumers to manage an extra npm dependency for what is naturally a subpath of TheoKit. The standalone package has been removed from the monorepo.

  **New surface:**

  ```ts
  import { stableQueryKey, buildUseTheoQueryConfig } from 'theokit/react-query'
  ```

  Aliases `buildUseTheoQueryInternals`, `FetcherFn`, and `UseTheoQueryInternals` are re-exported under the same subpath to preserve the names that pre-release builds of the standalone package exposed.

  This is a purely additive change — `theokit/client` continues to expose the same primitives. No code needs to change for existing users.

## 0.1.0-alpha.4

### Patch Changes

- Hotfix: default template now declares `react-router` and `zod` (theokit peer dependencies). Without these, `pnpm dev` failed immediately on a freshly scaffolded project — entry-client couldn't resolve `react-router`, and `server/routes/chat.ts` couldn't resolve `zod`. Found by running `pnpm dlx create-theokit my-app` end-to-end against the published packages. Regression test added in `tests/unit/scaffold-default-agent.test.ts` to keep peer deps locked to the template.

  Also bumps the template's `theokit` pin to `^0.1.0-alpha.4` so freshly scaffolded projects pick up this hotfix.

## 0.1.0-alpha.3

### Minor Changes

- TheoUI default integration — `npx create-theokit my-app` now scaffolds a working agent surface out of the box.

  **`theokit`** (`0.1.0-alpha.2`)
  - `defineAgentEndpoint({ handler })` (`theokit/server`) — sugar over `defineRoute` that turns an `async *handler(): AsyncGenerator<AgentEvent>` into a Server-Sent Events response. Standards-compliant `text/event-stream` framing; respects `request.signal` for prompt cancellation; emits a final `{ type: 'error', message }` event when the generator throws.
  - `useAgentStream(path, options?)` (`theokit/client`) — React hook returning `{ events, status, send, abort, reset }`. Transport is `fetch + ReadableStream` (not `EventSource` — POST + body required). Cleans up on unmount (StrictMode-safe).
  - `consumeAgentStream(path, options)` + `parseSSEChunk(line)` (`theokit/client`) — the pure primitive the hook glues, exposed for non-React consumers and for tests.
  - Runtime `AgentEvent` discriminated union (`message | tool_call | tool_result | error`) exported from `theokit/server` and `theokit/client`. Server emits, client consumes — no cross-package type coupling with `@theokit/ui`.
  - Auto-injection of `@theokit/ui` in the dev/build pipeline: when the user's project declares `@theokit/ui` as a dependency and the package resolves, the Vite plugin emits `import '@theokit/ui/styles.css'`, `import '@theokit/ui/fonts.css'` (or `fonts-cdn.css` when configured), and wraps `RouterProvider` in `<TheoUIProvider theme={{ defaultTheme }}>`. New optional `ui` field in `theo.config.ts` (`false | { theme, fonts }`) for opt-out and theme selection. Conservative detection: package must be declared in `package.json` AND resolvable — prevents false positives in monorepos.

  **`create-theokit`** (`0.1.0-alpha.2`)
  - Default template now scaffolds an **agent surface**: `app/page.tsx` ships `AgentComposer` + `AgentTimeline` from `@theokit/ui`, `server/routes/chat.ts` is a mock SSE endpoint emitting three `AgentEvent`s. Replace the mock with your real LLM provider.
  - New `--bare` flag — skips the TheoUI defaults for users who want a minimal scaffold. Atomic rollback: if the bare transform fails for any reason (filesystem perms etc.), the entire target directory is removed so no half-scaffolded project is left behind. `--bare` is only valid with `--template=default`.
  - `@theokit/ui ^0.1.0-next.0` is now a direct dependency of the default template.

## [Unreleased]

> Cross-Domain Uplift: 18 tasks from `docs/plans/cross-domain-uplift-plan.md`, lifting TheoKit toward 0.2.0. Server (plugin system), adapters (5 new targets), CLI (3 new commands), router (streaming SSR), client (batching + transformer + react-query), Vite integration API. Release engineer bumps the version when shipping.

### Added

- **TheoUI default integration — Phase 6: Dogfood checks** — `scripts/dogfood-smoke.sh` extended from 15 to 19 checks. Four new theoui-specific gates: (#16) default template ships `@theokit/ui` + `AgentTimeline` + `server/routes/chat.ts`, (#17) vite-plugin auto-detects TheoUI and injects CSS + `TheoUIProvider` wrap in entry.ts, (#18) `create-theokit --bare` opt-out with EC-4 atomic rollback (`applyBareTransform` + `rmSync`), (#19) `defineAgentEndpoint` + `useAgentStream` + `consumeAgentStream` surfaces all exported. Current run: **19/19 PASS**.
- **TheoUI default integration — Phase 5: `defineAgentEndpoint` + `useAgentStream`** — closes the loop between server-emitted `AgentEvent`s and React state, with no manual SSE parser in user code.
  - **`defineAgentEndpoint({ handler })`** (server): sugar over `defineRoute` (ADR D4). Accepts `async *handler(ctx): AsyncGenerator<AgentEvent>` and returns a `RouteConfig` whose handler responds with `text/event-stream` (`data: <JSON>\n\n` framing, `cache-control: no-cache, no-transform`, `connection: keep-alive`). Observes `request.signal` and calls `generator.return()` on abort — infinite streams shut down in &lt; 100ms. Errors thrown mid-stream emit a final `{ type: 'error', message }` event before the stream closes. Re-exported via `theokit/server`.
  - **`useAgentStream(path, options?)`** (client): React hook returning `{ events, status, send, abort, reset }` where `status` is `idle | streaming | done | error`. Internally uses `fetch + ReadableStream` — **not `EventSource`** (EC-3: EventSource is GET-only and cannot carry a request body). New `send(body)` cancels any in-flight stream before opening a new connection; unmount cleanup aborts the controller (EC-8, StrictMode-safe). Re-exported via `theokit/client`.
  - **Pure SSE primitive `consumeAgentStream(path, options)` + `parseSSEChunk(line)`** extracted to `theokit/client` so the wire behavior is testable without React/DOM (handles chunk re-assembly across `read()` boundaries, malformed JSON tolerance, comment/blank-line skipping). Re-exported via `theokit/client`.
  - 7 unit tests for `defineAgentEndpoint` (header/happy/error/abort/empty/ctx) + 12 for `useAgentStream` (3 parser + 6 primitive + 3 architectural EC-3 checks).
- **`@theokit/react-query` published as its own package (closes T5.3 ressalva)** — moved the React Query primitives from `theokit/client` into `packages/theokit-react-query/`. Idiomatic install path is now `pnpm add @theokit/react-query @tanstack/react-query`. The original exports under `theokit/client` remain in place for backward compatibility (a single source of truth lives in the new package and `theokit/client` re-exports it conceptually — the implementation is duplicated as a small file rather than a runtime dependency, so `theokit` does not pull in `@tanstack/react-query`). New package version: `0.2.0`. 3 unit tests cover the public surface of the standalone package.
- **T1.2 Deno Deploy runtime wiring (CLOSURE)** — Deno adapter now drives the full `executeRoute` pipeline. Earlier iteration documented this as "blocked"; re-evaluation showed the web-shim is Web Standards-only (`Uint8Array`/`Response`/`TextEncoder`/`Headers` — no `Buffer`) and Deno Deploy supports `node:fs`/`node:path`/`node:url` compat. Template imports `theokit/server` and `theokit/adapters/web-shim` via `npm:` specifier (Deno Deploy ≥ 1.40 native). 2 new tests confirm the npm specifier wiring and pipeline import surface.
- **`scripts/dogfood-smoke.sh`** — reproducible 10-check dogfood proxy. Validates TS strict, sequential vitest, build, publint, zero-any audit, adapter dispatcher coverage, plugin/integration exports, web-shim presence, client surface. Exit code reflects PASS/FAIL with a `Health Score: X/Y` line that mirrors `/dogfood full`. Designed for environments where the slash skill cannot be invoked (CI, automation, Ralph Loop iterations). Current run: **10/10 PASS**.
- **README: `## Plugins` and `## Integrations` sections** — public-facing documentation for the new extension surfaces. Plugins section covers `defineTheoPlugin`, hook lifecycle, `decorateRequest`, and `theo.config.ts` wiring. Integrations section covers `defineTheoIntegration`, `addRoute`/`addVirtualModule`, and the EC-5/EC-6 guards. CLI section updated to enumerate all 8 build targets and the 3 new commands (`check`/`add`/`info`).
- **Web→Node shim + Phase 1 runtime pipeline wiring** — closed the "~5% remaining" gap on Bun, Netlify, and AWS Lambda adapters by extracting `createWebShim(request)` to a new entry-point `theokit/adapters/web-shim`. The shim builds a minimal IncomingMessage/ServerResponse pair around a Web Standard `Request` and resolves `toResponse()` once `res.end()` is called. **Bun adapter** now drives the full `executeRoute` pipeline through the shim — Zod validation, plugins, sessions all run inside Bun. **Netlify Functions adapter** now drives the same pipeline — including lazy module/route caching for cold-start. **AWS Lambda adapter** now converts API Gateway v2 events to Web Requests, runs the pipeline through the shim, and converts the resulting Response back to v2 result format with base64 encoding for binary content types. New exports under `theokit/server`: `scanServerRoutes`, `matchRoute`, `executeRoute`, `sendError`, `sendJson`, `createProductionLoader`, `createViteLoader`, types `ServerRouteNode`, `LoadModule`. New entry: `theokit/adapters/web-shim`. `tsup.config.ts` updated with the new entry. Tested with 6 new unit tests for the shim (request side, response side, binary preservation). Deno Deploy intentionally left un-wired in this iteration: Deno's stdlib lacks `Buffer`/`node:http` by default and forcing the shim there bloats the bundle — pending a separate refactor to make `executeRoute` accept Web Standard Request natively.
- **Deno Deploy adapter (T1.2)** — new `deno-deploy` build target. Emits `.theo/deno/server.ts` with `Deno.serve`, `Deno.env`-based config, and a runtime presence guard (`typeof Deno === 'undefined'` throws). Build orchestration is DI-friendly via `runNodeBuild`/`writeEntry`/`ensureDir`. Tested with 9 BDD unit tests.
- **Netlify Functions adapter (T1.3, EC-2 covered)** — new `netlify` build target. Emits `.netlify/functions/theo.mjs` and **non-destructively** merges `netlify.toml`. The merge is idempotent (re-running does not duplicate the `/api/*` redirect) and preserves arbitrary unknown sections like `[build]`, `[[headers]]`, `[context.production.environment]`. When an existing `[[redirects]]` block has `from = "/api/*"` pointing somewhere other than our function, the build aborts with `NetlifyConflictError` listing the conflicting target — no silent overwrite. In-house TOML scanner avoids a new runtime dependency. Tested with 12 BDD unit tests.
- **AWS Lambda adapter (T1.4)** — new `aws-lambda` build target. Emits `.theo/aws/handler.mjs` compatible with API Gateway HTTP API v2 (default). Pure helpers `eventV2ToRequestShape` and `responseToLambdaResultV2` handle event→Request conversion and base64 encoding for binary content types (`application/octet-stream`, `application/pdf`, `application/zip`, `image/*`, `audio/*`, `video/*`). Tested with 13 BDD unit tests.
- **Static adapter closure (T1.5)** — default `renderHtml` is now wired: if `.theo/server/entry-server.js` exists, dynamic-imports it and calls its `render(url)` export, injecting the rendered HTML into the `index.html` template at the `<div id="root">` split point. Falls back to the bare client shell when no SSR build is present (acceptable degradation when the user chose `ssr: false`). Default `loadStaticPaths` dynamic-imports `static-paths.ts` files and invokes their default export. Tested with 2 new integration tests using temp project directories.
- **CLI `theokit check` (T2.1)** — runs typecheck (`npx tsc --noEmit`), project scan, and optional ESLint when a config is detected. Reports per-step status (`ok`/`fail`/`skipped`) with aggregated exit code (0 if all pass, 1 if any fails). Skips `typecheck` cleanly when `tsconfig.json` is absent. Skips `eslint` when no eslintrc-like config is present. Tested with 7 BDD unit tests using full DI for spawn/fs.
- **CLI `theokit add <package>` (T2.2)** — installs a known TheoKit adapter or plugin from a hardcoded whitelist (`bun`, `deno`, `netlify`, `aws-lambda`, `static`). Detects package manager via lockfile precedence (pnpm > bun > yarn > npm; npm fallback). EC-4 security: input validated against `/^[a-z0-9][a-z0-9-]*$/` BEFORE any registry lookup — rejects shell metacharacters (`;`, `&&`, `|`), path traversal (`../`, `/`), scope syntax (`@scope/name`), uppercase, and empty input. Spawn uses array args and `shell: false` — no string concat, no shell interpolation ever. Unknown package names emit suggestion via Levenshtein distance when within edit distance 3. Tested with 17 BDD unit tests including 5 security-focused assertions.
- **CLI `theokit info` (T2.3)** — prints a Markdown diagnostic of the project: `package.json` name+version (or `(missing)`), runtime detection (Node/Bun/Deno via global checks), config load status, and route count. Never crashes — corrupted/missing `package.json` reports `(missing)`, invalid config reports `Config: INVALID — <reason>`, scan failure reports `Scan failed: <message>`. Tested with 7 BDD unit tests.
- **Vite extension API: `defineTheoIntegration` (T3.1)** — build-time integration system mirroring Astro Integrations. Public API: `defineTheoIntegration({ name, hooks })` where hooks declare any subset of `theo:config:setup` / `theo:build:start` / `theo:build:done` / `theo:dev:start`. Each hook receives a context with `addVirtualModule(id, code)` and `addRoute(path, handler)`. EC-6 enforced: virtual module IDs must start with `virtual:integration:<name>/` — anything else throws `IntegrationVirtualModulePrefixError` (prevents collisions with `/@theo/*` internals and other integrations). EC-5 enforced: `addRoute(path, handler)` throws `IntegrationRouteCollisionError` when `path` collides with a user route OR with another integration's route — no silent override. Hooks fire in registration order. Hook errors propagate wrapped with the offending integration name. Tested with 11 BDD unit tests. Exposed via `theokit/vite-plugin`.
- **Pluggable response transformer (T5.2)** — `TheoTransformer` interface (`name`, `serialize`, `deserialize`) with two built-ins: `superjsonTransformer` (default, preserves Date/Map/Set/BigInt) and `jsonTransformer` (lightweight, plain JSON). `resolveTransformer(selector)` accepts the string keys `'superjson'` / `'json'` or a custom object — validates the shape (`serialize` and `deserialize` must be functions) and throws a clear error on unknown strings or malformed customs. Tested with 10 BDD unit tests. Exposed via `theokit/server`.
- **Client batching (T5.1)** — `createBatcher({ transport, max? })` returns a `Batcher` whose `dispatch(req)` collapses all calls made within the same microtask into a single transport invocation. Per-item error isolation: a `{ error }` result in the batch response rejects only that caller's promise — other items in the same batch still resolve normally. `max` (default 32) splits oversized batches into multiple parallel transport calls. Transport failures (e.g., network) reject all pending dispatches in that batch. Tested with 6 BDD unit tests. Exposed via `theokit/client`. The default HTTP transport (`POST /api/__theo_batch__`) is left for the consumer to compose, keeping the core primitive testable without network.
- **React Query adapter primitives (T5.3)** — `stableQueryKey(path, options)` produces a deterministic `queryKey` that is equal across calls when query/body/params content is logically equal, regardless of property order or inline-object identity (EC-10: prevents inline `{ query: { search: input } }` → infinite refetch loops). `buildUseTheoQueryConfig(path, options, fetcher)` returns the `{ queryKey, queryFn }` pair to pass directly to `useQuery` from `@tanstack/react-query`. Tested with 8 BDD unit tests. Exposed via `theokit/client`. Ships inside `theokit/client` rather than a separate `@theokit/react-query` package for 0.2.0; package split is cheap to add later when downstream adopters appear.
- **T6.1 closure — `theokit start` consumes `renderStreaming`** — when `config.ssrStreaming === true` AND the SSR build emitted `renderStreaming`, the production server now uses the streaming path: pipes the React shell as soon as `onShellReady` fires, propagates an `AbortController` derived from `req.on('close')` (EC-11 client disconnect → `stream.abort()`), and falls back to a 500 with `custom500Html` on stream errors. Single-shot `render()` remains the path when `ssrStreaming` is false or `renderStreaming` is absent (backward compatible).
- **Streaming SSR (T6.1, opt-in)** — `generateEntryServer({ streaming })` now branches between the legacy `renderToString`-style single-shot entry and a new `renderToPipeableStream` streaming entry that flushes the React shell as soon as it's ready (`onShellReady`) and streams Suspense boundaries progressively. Enabled per project via new `ssrStreaming` field in `theo.config.ts` (default `false` to preserve current behavior). The streaming entry sets `Transfer-Encoding: chunked`, propagates `request.signal` into `createStaticHandler`, and registers an abort listener that calls `stream.abort()` when the client disconnects (EC-11). Single-shot `render()` export is preserved alongside the new `renderStreaming()` for backward compatibility. The Vite plugin reads `options.ssrStreaming` and passes it through. Adapter wiring (Node/CF/Bun consuming `renderStreaming` instead of `render`) is the remaining piece, tracked separately. Tested with 11 unit tests.
- **Bun adapter (T1.1)** — new `bun` build target. `theokit build --target bun` runs the standard Node Vite build, then writes `.theo/bun/server.mjs` — a Bun-runtime entry that uses `Bun.serve` + `Bun.file` (no `node:http` import). The emitted entry embeds: dev-mode guard (EC-1: `NODE_ENV !== 'production'` → `process.exit(1)`), Bun version check (`Bun.version` parsed; requires `>= 1.1`), runtime presence check (`typeof Bun === 'undefined'` aborts), and a basic static + SPA fallback request loop. Full `executeRoute` pipeline (Zod, plugins, sessions) wiring against Bun's `Request`/`Response` is left for a follow-up. `'bun'` added to `BuildTarget` enum + `VALID_TARGETS`. Adapter dispatcher updated. Tested with 11 unit tests (`buildBun` orchestration is DI-friendly via `runNodeBuild`/`writeEntry`/`ensureDir` overrides).
- **Plugin system config wiring (Phase 4 closure)** — new `plugins` field in `theo.config.ts` schema (validates as `z.array(z.unknown())` for Zod compatibility, structurally validated at runtime). New `createPluginRunnerFromConfig(plugins)` helper returns a `PluginRunner` ready to pass to `executeRoute`, or `undefined` when no plugins are configured (preserves zero-overhead path). `InvalidPluginShapeError` thrown for malformed entries with the offending index. `createApiMiddleware` extended to accept either the legacy `RateLimitConfig` directly or a new `ApiMiddlewareOptions` object including `pluginRunner` (backward compatible — discriminated by `windowMs` presence). `theokit start` now loads plugins from `config.plugins` and passes the runner to every `executeRoute` invocation. New fixture `fixtures/plugin-example/` with a real plugin (`request-id-echo`) demonstrating all four hooks plus `decorateRequest`. Tested with 8 unit tests covering null/undefined/empty/valid inputs and the three failure modes (non-object, missing name, missing register).
- **Server plugin system (T4.1 + T4.2 + T4.3 + T4.4)** — Fastify-style typed hook system for cross-cutting concerns (auth, tracing, metrics, error capture) without touching every route. Public API: `defineTheoPlugin({ name, register })` where `register(app)` receives a `TheoApp` exposing `addHook(name, fn)` for the four lifecycle hooks (`onRequest`, `preHandler`, `onResponse`, `onError`) and `decorateRequest<T>(key, value)` for type-safe ctx extension. `executeRoute` accepts an optional `PluginRunner` parameter; callers that omit it preserve 100% of the previous behavior (backward compatible). Hook ordering is registration-order. Hooks short-circuit when the response is ended (`writableEnded`/`headersSent`). EC-7 covered: `DuplicateDecorationError` thrown when two plugins decorate the same ctx key. EC-9 covered: `inErrorPath` flag prevents `onResponse` → `onError` → `onResponse` recursion. Errors thrown inside `onError` hooks are swallowed with a console.error log (no recursion possible). Exports: `defineTheoPlugin`, `PluginRunner`, `DuplicatePluginError`, `DuplicateDecorationError`, and the types `TheoPlugin`, `TheoApp`, `PluginContext`, `PluginErrorContext`, `HookName`, `HookResult`, `OnRequestHook`, `PreHandlerHook`, `OnResponseHook`, `OnErrorHook`, `RunHookOptions`. Tested with 15 unit tests (PluginRunner) + 5 integration tests (end-to-end pipeline through `executeRoute`).
- **Static adapter (T1.5, partial — pure logic + adapter shell shipped, Vite SSR render pending)** — new `static` build target that pre-renders pages to HTML files in `.theo/static/`. Supports `[id]` dynamic routes and `[...slug]` catch-all routes via `static-paths.ts` convention (EC-3 covered). Aborts the build with `StaticApiRoutesDetectedError` when `server/routes/` is present, since static export cannot host runtime API handlers. Pure path-resolution logic (`parseSegment`, `collectStaticPaths`, `StaticPathsRequiredError`) is fully tested (11 unit tests). Adapter orchestration (`buildStatic`, `staticAdapter`, `detectApiRoutes`, `StaticRenderError`) is tested with 12 unit tests using dependency injection for I/O. The default `renderHtml` throws a clear "not yet wired" error — wiring to real Vite SSR render is queued for a follow-up iteration. New `'static'` value added to `BuildTarget` enum and `VALID_TARGETS`. Fixture in `fixtures/adapter-static/` demonstrates root page, static `/about`, dynamic `/blog/[id]`, and catch-all `/docs/[...slug]`.

### Changed

- License set to **Apache-2.0** (was unset in `package.json`). Aligns with Theo open-core pillars — see root `CLAUDE.md` strategic review of 2026-05-14.

## [0.1.0-alpha.0] - 2026-05-09

### Added

- `defineConfig` identity function with Zod schema validation via `loadConfig`
- `defineRoute` with typed query, body, params via Zod generics
- `defineAction` with required Zod input schema
- `defineMiddleware` with `await next()` pattern using Web Standards Request/Response
- `validateProjectStructure` for opinionated project validation
- File-based routing via React Router v7 with nested layouts, error boundaries, and not-found pages
- `theoPlugin` Vite plugin with virtual modules (`/@theo/entry-client`, `/@theo/route-manifest`)
- API route execution pipeline with Zod validation, requestId, and structured error responses
- Server actions with CSRF protection (origin + custom header)
- Middleware + context system with `runMiddlewareAndContext()` unified pipeline
- `theo build` command producing `.theo/client/` with Vite build
- `theo start` production server with static files, API routes, and SPA fallback
- `theo dev` development server with HMR
- Cookie helpers (`getCookie`, `setCookie`, `deleteCookie`) with OWASP-compliant defaults
- Structured JSON logging with `x-request-id` on all API responses
- 21 type tests proving end-to-end Zod inference
- Zero `any` in production code
