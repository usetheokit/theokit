# Universal Handler Architecture — Research Blueprint

> Discovery blueprint feeding `/to-plan` + an architecture ADR. Question: **can one construction author a handler ONCE and project it to web / TUI / MCP / Tauri, with a typed context, per-surface auth, and a `build --target` contract — honoring TheoKit's wedge (file-based, Zod SSoT, typed client, no-magic, Web Standards, M31 builder)?**
>
> Honesty posture (Unbreakable Rule 3): the *diagnosis* in this blueprint is code-verified. Four of the five design recommendations rest on **at least one refuted or unverified load-bearing claim** — flagged inline and consolidated in §8. This blueprint is **NEEDS_REVISION**, not SHIPPABLE. It is a decision-input document, not an implementation license.

---

## 1. Problem + Vision

### 1.1 The promise

TheoKit's thesis: **"Build the app your agent lives in."** The multi-surface extension of that thesis is: a developer authors a handler *once* — a conventional app concern (a `login`, a `createPost`, a `listInvoices`) — and the framework projects it onto every surface an agent app needs:

- **web** — a conventional HTTP route/page/action (cookies, sessions, CSRF, forms).
- **TUI** — a terminal command reusing the same logic (already partially shipped: `run-terminal-agent.ts`, ADR-0039).
- **MCP** — an AI tool descriptor + `tools/call` execution (partially shipped: `mcp-handler.ts` list-only, `mcp-stdio.ts`, ADR-0042).
- **Tauri** — a desktop IPC command (aspirational; zero code today).

…with a **typed context** (`ctx.session`, `ctx.user`, request-derived vars) that is correct *by construction*, and a **`build --target <surface>`** contract that emits/serves each surface from the same source.

### 1.2 Why it matters, and where it stands today

TheoKit already has **three parallel authoring units** — and this fragmentation is the central problem:

| Unit | Shape | Transport-independent? | Code |
|---|---|:--:|---|
| `route()` | HTTP (path+method from file, `.query/.body/.params`) | ❌ | `route-builder.ts:30-76`, `route-config.ts:18-59` |
| `action()` | single Zod input, transport-neutral def, HTTP-POST at runtime | ⚠️ partial | `action-builder.ts:34-71` |
| `tool()` / `defineAgentTool` | name + flat Zod object + handler → JSON Schema 7 | ✅ | `define-agent-tool.ts:29-39,130-179` |

Only `tool()` is genuinely transport-independent (it already crosses the LLM tool-call wire and produces MCP-shaped `inputSchema` via `z.toJSONSchema()`, `define-agent-tool.ts:149`).

**Two concrete, code-verified holes block the multi-surface claim today:**

1. **MCP route has no auth.** `serve-aux-routes.ts:63-79` mounts `POST /api/agents/<name>/mcp` and calls `handleMcpJsonRpc` with **zero** auth/CSRF/token check — while the sibling agent-run route (`mount-agent.ts:87-90`) and HITL approve route (`approve-agent.ts:89-92`) both enforce CSRF strict. Asymmetric, unauthenticated JSON-RPC surface that can drive an agent (spending real LLM tokens).
2. **MCP has no `tools/call`.** `mcp-handler.ts:93-135` answers `initialize` / `tools/list` / `resources/list` / `resources/read` only; unknown → `-32601`. The app **advertises** tools but **cannot execute** them over MCP. Additionally `buildMcpToolDescriptors` (`mcp-server-manifest.ts:44-45`) emits an **empty** `inputSchema: {properties:{}}`, dropping the Zod schema the tool unit already produced. Protocol version is stale (`2024-11-05`; current is `2025-06-18` / `2025-11-25`).

The vision is real and partially in-flight; the design question is **how to unify the units without breaking TheoKit's wedge or the SDK-owns-the-agent-wire boundary (ADR-0040).**

---

## 2. Reference landscape

Twelve frameworks/systems studied across the axes TheoKit cares about (**unit shape · context contract · transport-agnosticism · build-target · auth/session · per-surface opt-in**). Local refs are `file:line`; external are URLs.

| Cluster | System | Unit shape | Transport-independent unit? | `build --target` analog | Key steal |
|---|---|---|:--:|:--:|---|
| RPC-contract | **oRPC** | named procedure; `.route()` optional HTTP metadata | ✅ | runtime handler modules | `.route()` = optional metadata, adapter-read only ([orpc.dev/docs/openapi/routing](https://orpc.dev/docs/openapi/routing)) |
| RPC-contract | **tRPC v11** | procedure (no verb/path) | ✅ | `adapters/*` per runtime | `callProcedure({router,path,type,ctx,getRawInput,signal})` neutral dispatcher; `localLink`/`createCallerFactory` in-process seam (`.claude/knowledge-base/references/trpc/...router.ts:401-496`) |
| Effect | **@effect/rpc** | `RpcGroup`/`Rpc.make` | ✅ | `layerProtocol*` (http/ws/socket/worker) | serialization decoupled from transport ([npmjs.com/package/@effect/rpc](https://www.npmjs.com/package/@effect/rpc)) — **UNSTUDIED in depth, see §8.2** |
| HTTP-route | **Hono** | route (path+method+validation-target) | ❌ | router presets + runtime adapters | `Env {Bindings,Variables}` + `IntersectNonAnyTypes` typed-var merge (`hono/src/types.ts:30-46,143`); `hc<typeof app>()` zero-codegen typed client |
| HTTP-route | **Nitro v3 / h3** | event handler; universal `fetch(Request)=>Response` | ❌ | **~31 presets** (`--preset`) — gold standard | preset = `{entry, configOverrides, meta}`; entry is the ONLY runtime coupling (`nitro/src/types/preset.ts:5-14`) |
| HTTP-route | **Next.js App Router** | 3 units: RSC-loader vs Server Action vs `route.ts` | ⚠️ action only | `NextAdapter.onBuildComplete({routing,outputs,config})` | ambient `cookies()/headers()` via ALS; adapter neutral manifest (`next.js/.../build-complete.ts:367-439`) |
| HTTP-route | **Fastify** | route (method+url) | ❌ | none | encapsulation fork (parent-hooks-flow-down); `inject()` fake-transport seam; schema→type-provider (runtime==type for inputs) |
| HTTP-route | **opencode** | `HttpApiEndpoint` on typed group | ❌ (HTTP-first) | per-surface launcher commands | one `app.fetch`; TUI worker-fetch shim + in-process call; `handleMcpJsonRpc` over HTTP+stdio |
| Meta-framework | **SvelteKit** | file-route + **remote** `query/command/form` (opt-in transport-independent) | ⚠️ | `adapter.adapt(builder)` | `App.Locals` + `sequence()` typed ctx; `form()` progressive enhancement (**EXPERIMENTAL, non-semver — see §8**) |
| Conventional | **Rails / Laravel** | controller action (HTTP) | ❌ | none | Rails 8 Session model + `Current`; Laravel Sanctum dual-guard (cookie vs bearer, transport decides CSRF) |
| Desktop | **Tauri v2** | `#[command]` — named typed procedure | ✅ | Specta codegen (`gen client`) | capability/permission ACL per-window (strongest per-surface boundary); IPC has `invoke` **AND** `Channel`/`emit` push (**§8.3**) |
| Highest-abstraction / build | **Blitz · Wasp · Astro · Vinxi/TanStack** | resolver / operation / adapter / router | ⚠️ mixed | Astro `setAdapter` · Nitro presets · Encore `gen client --lang` · Vinxi per-router | TanStack `createServerFn`+`createMiddleware` (no-magic typed ctx); Encore `expose:false` default-deny; **AVOID** Blitz auto-RPC-every-file (caused CVE-2022-23631) |

**Convergence at a glance:** every system reduces its runtime to **one `fetch(Request)=>Response` narrow waist**; every typed system uses **Zod/Schema as single source of truth**; the winning context model is **middleware-accretes-typed-vars** (not global augmentation); the winning multi-target model is a **neutral-manifest adapter/preset**. The **divergence** is the authoring unit shape (procedure vs HTTP-route) and per-surface exposure (default-expose vs default-deny) — and **nobody** ships a first-class per-handler multi-surface projector with a per-surface capability boundary.

---

## 3. Design space — key decisions

Each decision states options, the recommendation, its rationale, **and the adversarial verdict** (four independent critics attempted to break each recommendation; three of five recommendations were REFUTED or REFUTED-IN-PART).

### D1 — The universal unit: HTTP-route vs procedure vs hybrid

- **(A)** HTTP-shaped route as the unit (Hono/Fastify/Nitro/Next/Astro/opencode). Non-HTTP surfaces fake a Request.
- **(B)** Transport-independent named procedure (oRPC/tRPC/@effect-rpc/Encore/TanStack/SvelteKit-remote/Tauri/Blitz/Wasp).
- **(C)** **Hybrid** — one named typed procedure is canonical; HTTP path+method+status is optional `.route()` metadata read only by the HTTP adapter; MCP-tool / TUI-command / Tauri-IPC are sibling projections. Unify `route()`/`action()`/`tool()`.

**Recommendation:** (C) hybrid.

**Rationale:** HTTP-first is structurally unable to serve TUI/MCP/Tauri without faking Requests (opencode literally builds `http://opencode.internal`). oRPC is direct prior art for optional `.route()` metadata; `tool()` already crosses the MCP wire.

**⚠️ Adversarial verdict — REFUTED as written (holds up: NO).** The *narrow kernel* survives (HTTP method/path as optional metadata a REST adapter reads — true of tRPC/oRPC). The *full unification* does not:
1. **The projector template does not exist.** oRPC `.callable()` yields a generic in-process JS function (no MCP/TUI/Tauri projection); `.actionable()` is Next-RSC-specific. **No studied framework ships an MCP/TUI/Tauri projector from a shared unit.** The cited "template for `.asTool()`/`.asTuiCommand()`" is a fabricated-strength citation.
2. **The cited "transport-independent" prior art is HTTP-codec-independent (REST vs proprietary RPC over HTTP), not transport-agnostic.** oRPC RPCHandler is "built on top of HTTP"; tRPC v11 core uses Fetch Request/Response.
3. **The three TheoKit units differ in input arity + ctx + output contract, not merely HTTP projection.** `route()` has three input channels (`.query/.body/.params`); `tool()` has one flat `z.object` (enforced by `isZodObject`) + a model-visible-string output contract + `transform`. Collapsing three HTTP channels into one universal input is **lossy** — a TUI/MCP author must decide query-vs-body-vs-param mapping, defeating "authors never see path/method."
4. **Collides with guardrails G4 ("AI tool capability must be explicit — NEVER auto-inferred") and G5 ("shared guards, distinct pipelines — never same pipeline").** "Single procedure + per-surface projectors" is the "same pipeline" framing G5 forbids; filename-sugar HTTP path invites inferring the tool projection G4 forbids.
5. **The opencode evidence is mis-cited** — its single HTTP surface + in-process `toWebHandler` is a *deliberate, celebrated* choice, not an impedance scar.

**Defensible narrower variant:** keep `tool()` as-is (already transport-independent); make `route()` method/path **explicit optional metadata read only by the HTTP/OpenAPI adapter**; do **not** merge the three units into one universal procedure.

---

### D2 — The typed context contract

- **(A)** Global module augmentation (Nitro `ServerRequestContext`, Hono `ContextVariableMap`, SvelteKit `App.Locals`, Fastify `declare module`) — optional fields, author-maintained, can lie.
- **(B)** **Middleware-accretes-typed-vars** via generic threading (Hono `c.set/c.var`, tRPC `next({ctx})`, TanStack `next({context})`, oRPC `.use()`) — type produced by the same runtime code that computes the value.
- **(C)** Effect Layer/Context requirements-channel — compile-time-forced DI.

**Recommendation:** (B) over a fixed transport-aware base ctx `{requestId, headers, cookies, session, url, transport}` materialized per-transport at the adapter seam. Retire `ctx:TCtx=unknown`.

**Rationale:** `ctx:unknown` is the #1 DX gap vs Hono. oRPC's two-tier model (per-request initial ctx at the adapter seam + middleware-added typed vars) makes runtime==type by construction. Effect's guarantee is stronger but the ceremony is unanimously flagged AVOID for conventional authors.

**⚠️ Adversarial verdict — REFUTED (holds up: NO).** Diagnosis accurate; recommendation fails against TheoKit's own code:
1. **`runtime==type` is false by construction.** `execute.ts:122-165` accretes ctx from **THREE** writers, only one being middleware: `pluginRunner.applyDecorations` (124/136), the `context.ts` factory via `runMiddlewareAndContext` (131-133), and `jobBackend` injecting `ctx.queue` (141-151). A middleware-accretes generic sees only the factory writer; any plugin decoration or `ctx.queue` injection re-opens divergence — reproducing the Hono failure the proposal claims to escape. oRPC's guarantee holds only because middleware is its **sole** ctx writer; TheoKit is multi-writer.
2. **The `.use()` typed-delta mechanism does not exist** (no `c.set/c.get/Variables`; grep zero) and TheoKit has **two non-composing middleware models**: Node `(req,res,next)` (`middleware-runner.ts:36-40`, ctx built by a separate `context.ts` factory) and Web `(request,next)=>Response` (`define-middleware.ts:1-4`, returns a Response, never touches ctx). (B) requires unifying both and changing the Web signature — a rewrite, not a generic retirement.
3. **The base-ctx `transport` field invents three transports that don't exist** (zero `tui/mcp/tauri` literals as route transports; MCP is agent-scoped `@MCP` + SDK MCP-over-HTTP per ADR-0040). Violates G11 (YAGNI — sole implementor: web).
4. **Evidence mis-reads the defect:** `route-config.ts:22` `TCtx=unknown` is the **default of a LOCKED 5-arity generic** (GAP-4, `route-config-generic-arity.test.ts`) the handler threads (52-58); retiring it breaks a tested invariant.

**Defensible narrower fix:** infer `TCtx` from `context.ts` at the **web adapter seam only**, keep the 5-arity generic, and explicitly **exclude plugin-decoration and `jobBackend` keys** from the inferred type (or route those two writers out of the typed surface). **A reconciliation artifact + type-tests against `execute.ts` is a required deliverable, not a footnote.**

---

### D3 — Auth/session across transports

- **(A)** Primitives-only, author wires everything (Hono/Fastify/Nitro/tRPC/Next/TanStack/oRPC).
- **(B)** Batteries-included subsystem (Rails 8, Laravel Breeze/Sanctum, Blitz, Wasp, Elysia macro).
- **(C)** **Transport-aware auth contract:** one pluggable session strategy → one `ctx.session`, materialized per surface; CSRF **web-only**; `form()` = progressive HTML on web, plain typed mutation off-web.

**Recommendation:** (C). Keep the LOCKED AUTH-DELEGATION posture (ship RFC primitives, delegate providers). Add typed `ctx.session` (not imperative `getSession`+`requireAuth`), a `requireAuth()` narrowing guard, web-only CSRF (Rails `:null_session` / Laravel Sanctum dual-guard), and a `form()` projection (SvelteKit).

**Rationale:** Rails+Laravel are the gold standard for conventional login/cadastro. CSRF is meaningless/harmful on token+stdio surfaces (both frameworks scope it to cookies; Tauri IPC has no cross-origin attacker). TheoKit already ships the hard primitives (AES-256-GCM sessions, rotation, PKCE, OIDC, TOTP).

**⚠️ Adversarial verdict — REFUTED-IN-PART (holds up: NO).** Diagnosis survives (MCP auth hole is real and code-confirmed; per-surface CSRF is a genuine pattern). The recommendation as written does not:
1. **Fabricated MCP mechanism.** The evidence cites "an MCP capability-scope token" — **no such primitive exists in the MCP spec.** Real spec is **transport-bifurcated**: remote/HTTP MCP = OAuth 2.1 Resource Server validating an **RFC 8707 audience-bound** token (401 + `WWW-Authenticate` + RFC 9728 PRM); **stdio MCP = env credentials, NO in-request token** (spec: "STDIO transport SHOULD NOT follow this spec, retrieve credentials from the environment"). The recommendation would push token validation onto the stdio surface the spec says must not carry one.
2. **The "uniform `ctx.session` type" is a type-safety mirage.** A cookie session authenticates a human; an OAuth audience-bound MCP token authenticates a *client acting on behalf of a user with a scoped audience* (confused-deputy risk — spec prohibits token passthrough); a Tauri IPC identity is ambient-trusted; a TUI credential is a device. Flattening these into one type **hides the authorization authority difference** — a handler reading `ctx.session.user` cannot tell full-trust human from narrowly-scoped MCP client. This must be a **discriminated union** `{kind:'web-cookie'} | {kind:'mcp-oauth', audience, scopes} | {kind:'ipc'} | {kind:'tui-device'}` (aligns with TheoKit `type-safety.md` discriminated-union guidance + G4).
3. **Reinvents an existing seam.** `middleware-runner.ts:117-124` already runs user `context.ts` `createContext({request,response})` → typed `ctx.ctx`. Typed `ctx.session` today = call `getSession(request)` inside `createContext`, return `{session}`. This is a **convention/docs gap, not a missing framework surface** (G11/YAGNI).
4. **SvelteKit `form()` is EXPERIMENTAL** (2.54+, non-semver, prior security advisories incl. DoS). Steal the *pattern*, not the API-as-north-star for the most security-sensitive surface.
5. **Rails `Current` singleton is a concurrency liability** — thread-local, does not propagate to async/child threads (rails/rails#36646). TheoKit agent surface is streaming/async (`Run.stream`); an ambient request-scoped singleton would silently return null inside a streamed continuation. Explicit `ctx` threading (which TheoKit already does) is correct; do **not** import the singleton.

**Defensible design:** keep AUTH-DELEGATION; close the MCP hole via the **real** MCP mechanism (OAuth resource-server validation for remote / env creds for stdio, transport-bifurcated); model cross-surface identity as a **discriminated union**, not a flattened uniform type; keep web-only CSRF; borrow only the *pattern* of progressive-enhanced forms.

---

### D4 — The `build --target` contract

- **(A)** Runtime-only adapter selection (oRPC/tRPC/Hono/Elysia).
- **(B)** Build-time preset registry emitting per-target artifacts (Nitro/Astro/SvelteKit/Encore).
- **(C)** **Split contract:** emit-shaped targets (deploy artifacts) vs serve-shaped targets (TUI binary / MCP stdio server / Tauri sidecar); extend TheoKit's `DeployAdapter` into a target abstraction covering emit AND serve, consuming a neutral procedure manifest + surface tags, with per-target safety gates.

**Recommendation:** (C). Model on Nitro/Astro/Next; keep TheoKit's inversion (`AdapterBuildContext` injecting `makeVitePlugins`). Add `tui/mcp/tauri` as first-class targets.

**Rationale:** TheoKit already has `DeployAdapter{name, build(config,cwd,ctx)}` + `adapterRegistry` + `--target` authoritative (`build.ts:63-72`). The gap: `build():Promise<void>` is emit-shaped; TUI/MCP/Tauri are serve-shaped. Every strong precedent converges on one-source-many-outputs + neutral-manifest + per-target gates.

**⚠️ Adversarial verdict — REFUTED (holds up: NO).** Four independent axes, any one fatal:
1. **The cited gold standards prove the OPPOSITE.** Astro `setAdapter` is emit-only + one web-standard `App.render(Request):Promise<Response>` — HTTP-bound; no Astro adapter for MCP/TUI/Tauri. Nitro presets `{entry, extends, hooks}` where `entry` is a per-host **fetch-handler** server entrypoint — emit-only, zero non-HTTP transports. Next `onBuildComplete` is a build-complete emit hook. **All precedents deliberately keep the adapter seam emit-only and HTTP-bound and route non-HTTP surfaces elsewhere.** Citing them as support while they are counter-evidence is post-rationalization.
2. **TheoKit ALREADY ships mcp/tui and deliberately did NOT use `--target`.** MCP-over-stdio is a CLI command reusing `handleMcpJsonRpc` (`cli/commands/mcp.ts`, ADR-0042); the terminal agent reuses the SAME `streamAgentUIMessages` + approval registry as HTTP `mountAgent`, differing only in render sink (`run-terminal-agent.ts`, ADR-0039). The shipped seam is **one core handler + thin per-transport CLI wrappers**, not a build target. (C) would rip out released ADR-0039/0042 work for no gain (YAGNI/KISS).
3. **The neutral procedure registry + surface tags do NOT exist.** `RouteConfig.handler` receives raw `request:Request` (HTTP-coupled at the type level); the universal core is `executeWebRequest(request:Request):Promise<Response>` — Request→Response, not neutral. Grep for `mcp-safe/surfaceTag/capability` on the manifest returns nothing; the safety gate has no tags to gate on. The **prerequisite** (decouple handlers from Request, build capability tagging) is the hard problem the recommendation hand-waves.
4. **Tauri and TUI are neither emit-shaped nor Request→Response.** Tauri IPC is JSON-RPC-like message passing over `ipc://` with **two** primitives (request-response `invoke` AND push `events`/`channels`); the push side has **no** Request→Response analogue. A TUI is a long-lived interactive readline process, not an emitted bundle. Forcing emit (`Promise<void>` artifacts) and serve (stateful streaming process) under one `build()` is a Liskov/ISP violation.

**Defensible design:** keep `--target` **emit/deploy-only and fetch-handler-shaped** (matching Astro/Nitro); keep `mcp/tui/tauri` as **thin transport wrappers over the one core handler** as CLI commands/sidecars (matching shipped M5/M16). Adding them as `--targets` is a **category error** conflating deploy emission with runtime transport.

---

### D5 — Per-transport opt-in + security

- **(A)** Implicit-by-file/folder (Blitz auto-RPC every file, TheoKit auto-mounts every agent as MCP, Next every `route.ts`, Hono whole-app-type) — default-EXPOSE.
- **(B)** Handler-level filter/tags (oRPC `filter`+`tags`, tRPC/Nitro/Elysia `meta`).
- **(C)** **Declarative per-unit surface allowlist with DEFAULT-DENY** on RPC/MCP + per-surface capability/auth boundary. Closest precedents: Encore `expose:false`, Tauri capability ACL, Rails safe-by-default.

**Recommendation:** (C). `surfaces: ['web']` default (web-only + auth-required); opting onto MCP/RPC requires explicit tag + per-surface guard, enforced structurally at the emit layer. Fix the two concrete holes: implement `tools/call`; add an auth/capability gate on the MCP route.

**Rationale:** This is the findings' loudest GAP — **nobody** ships a declarative per-handler multi-surface opt-in with a per-surface capability boundary, and default-EXPOSE is actively dangerous (Blitz CVE-2022-23631; Next "any use-server fn is a public POST endpoint" footgun; TheoKit auto-mounts every agent as MCP with no gate). For a "one construction on every surface" thesis, default-expose is that footgun **magnified** — a login mutation exposed on web-with-session would silently become an unauthenticated MCP tool.

**Adversarial verdict — NOT independently refuted in the provided verdict set; this is the strongest recommendation.** It combines verified precedents (Rails safe-by-default, Laravel guard-name-selects-boundary, Tauri capability ACL, Encore `expose` flag) and TheoKit's own in-repo `ui://` capability sandbox (`mcp-app-resources.ts:8-11` scheme gate + `mcp-app-host.ts:60-84` null-origin `allow-scripts` iframe + fixed guest vocabulary) as a generalizable capability boundary. **Caveat inherited from §8.7: it presumes TUI/MCP/Tauri are authorized core surfaces — which no ADR currently grants (see §7 ADR-1).**

---

## 4. Convergent patterns (safe to adopt) vs divergent forks (owner decision)

### 4.1 Convergent — safe to adopt

1. **Universal narrow waist = `fetch(Request)=>Response`.** Hono `app.fetch`, Nitro `NitroApp.fetch`, Next `RouteModule.handle`, opencode `Server.app.fetch`, SvelteKit `resolve()`, Astro `App.render`, Elysia `app.fetch`, **TheoKit `executeWebRequest`**. TheoKit already has this — keep it.
2. **Zod/Schema as single source of truth.** One schema → `z.infer` types + runtime validation + codegen/OpenAPI/MCP-inputSchema. Fastify type-provider, Encore tsparser, oRPC/tRPC `.input()`, **TheoKit `z.toJSONSchema()`**. Runtime==type *only for inputs* — extend this discipline; do NOT overclaim it for ambient ctx (see §3 D2 verdict).
3. **Middleware-accretes-typed-vars over global augmentation** — as a *design intent*. Verified winner in single-writer systems (Hono/tRPC/TanStack). **In TheoKit it is blocked by the multi-writer ctx** (§3 D2); adopt the *goal*, implement only at the web adapter seam with plugin/jobBackend keys excluded.
4. **Neutral-manifest adapter/preset for multi-target.** One app source → many outputs; adapter is the only runtime coupling; receives a neutral manifest, not raw internals; per-target safety gates. **Scope to emit/deploy only** (§3 D4 verdict).
5. **In-process/zero-serialization seam for non-HTTP surfaces.** tRPC `localLink`/`createCallerFactory`, opencode worker-fetch shim, Tauri IPC, Encore `~encore/clients`, SvelteKit remote. **This is the practical mechanism for TUI/Tauri and it does NOT exist in TheoKit today** (§8.8) — the core seam is Request→Response, not an in-process typed caller.
6. **Auth as per-route guard + typed session, enforced at the endpoint (the data boundary).** Rails `before_action`, Laravel middleware, Blitz `resolver.authorize`, TanStack `authMiddleware`. Route/UI checks are UX-only.
7. **Typed transport-neutral error protocol.** oRPC `os.errors()`+`[error,data]`, **TheoKit `action-protocol` ActionError→status**, Encore structured errors. One model, N presentations (HTTP status / MCP `isError` / TUI render).

### 4.2 Divergent — needs an owner decision

- **Unit shape:** procedure camp (oRPC/tRPC/@effect-rpc/Encore/TanStack/SvelteKit-remote/Tauri/Blitz/Wasp) vs HTTP-route camp (Hono/Fastify/Nitro/Next/Astro/Elysia/opencode). *The refuted D1 verdict says: do NOT fully unify; keep `tool()` transport-independent, make `route()` HTTP-metadata explicit-optional.*
- **Context delivery:** single ctx bag vs split req/reply/this (Fastify) vs request-IS-the-arg with origin in types (Encore) vs type-injection-by-parameter (Tauri) vs ambient ALS (Next/SvelteKit). *TheoKit already uses single ctx + explicit threading; ALS ambient is a concurrency hazard for the streaming agent surface (§3 D3).*
- **Typed-ctx safety enforcement:** generic threading (runtime==type, single-writer) vs global augmentation (can lie) vs Effect R-channel (compile-forced). *Blocked in TheoKit by multi-writer ctx — reconciliation required.*
- **Auth posture:** batteries-included vs primitives-only. *AUTH-DELEGATION lock keeps primitives for PROVIDERS; add first-class typed session/guard/form/web-CSRF.*
- **Per-surface exposure:** default-EXPOSE (dangerous) vs handler tags vs **default-DENY** (Encore/Tauri/Rails). *Decision: default-DENY — the one clearly-correct fork.*
- **MCP as a surface:** first-class procedure→tool adapter (needed) vs OpenAPI-detour (oRPC, loses rich types). *TheoKit must ship first-class `tools/call`, not the detour.*

---

## 5. Recommended architecture for TheoKit

> This is the **honest, verdict-adjusted** architecture — the *narrower* variant of each decision that survived the critics — not the original over-scoped recommendations.

### 5.1 The unit (D1-narrow)

Keep **two** authoring units; do NOT force a single universal procedure:

- **`tool()`** — already transport-independent (name + flat Zod object + handler + JSON Schema). This is the MCP/agent unit. Unchanged.
- **`route()`** — HTTP-shaped, but make method/path/status **explicit optional metadata** consumed only by the HTTP/OpenAPI adapter. File-based routing stays as sugar generating that metadata.

Bridge for reuse *without* merging: a route handler and a tool handler that share logic call a common **plain typed function** (the in-process seam, §5.4) — this is "shared guards, distinct pipelines" (G5), not "one pipeline."

**Concrete target API sketch (illustrative — NOT a committed API):**

```ts
// Shared logic authored ONCE as a plain typed function (no transport).
async function createPost(
  input: { title: string; body: string },
  ctx: AppCtx,            // typed; session narrowed by requireAuth
): Promise<{ id: string }> { /* ... */ }

// WEB projection — HTTP metadata is explicit + adapter-only.
export const POST = route()
  .body(z.object({ title: z.string(), body: z.string() }))
  .use(requireAuth)                 // narrows ctx.session -> ctx.user
  .csrf('strict')                   // WEB-ONLY concern (auto-skipped off-web)
  .handler(({ body, ctx }) => createPost(body, ctx))
  .build();

// MCP projection — DEFAULT-DENY; explicit surface opt-in + capability guard.
export const createPostTool = tool()
  .name('create_post')
  .inputSchema(z.object({ title: z.string(), body: z.string() }))
  .surfaces(['mcp'])                // explicit; NOT auto-inferred (G4)
  .capability('posts:write')        // per-surface authorization
  .handler((input, ctx) => createPost(input, ctx));
// build/runtime: emit a real MCP tool descriptor (retain the Zod schema!)
// AND wire tools/call to execute this handler under the capability guard.
```

### 5.2 Typed context (D2-narrow)

- Keep the **5-arity `RouteConfig` generic** (locked invariant); do NOT retire `TCtx`.
- Infer `TCtx` from user `context.ts` **at the web adapter seam only** (`middleware-runner.ts:117-124` already returns typed `ctx.ctx`).
- **Explicitly exclude** the two non-middleware writers (`pluginRunner.applyDecorations`, `jobBackend` `ctx.queue`) from the inferred typed surface — or route them out — with a documented reconciliation + type-tests against `execute.ts`.
- `ctx.session` becomes typed by calling the session strategy inside `createContext` and returning `{session}` (convention, not a new surface).

### 5.3 Auth/session per surface (D3-narrow)

`ctx.session` is a **discriminated union**, not a uniform type:

```ts
type SessionCtx =
  | { kind: 'web-cookie'; user: User }                         // CSRF applies
  | { kind: 'mcp-oauth'; audience: string; scopes: string[] }  // RFC 8707; no CSRF
  | { kind: 'ipc'; user: User }                                // Tauri; no CSRF
  | { kind: 'tui-device'; deviceId: string };                  // no CSRF
```

- `requireAuth()` narrows `SessionCtx | null` → the surface-appropriate member.
- **CSRF is web-cookie-only**, auto-skipped on `mcp-oauth`/`ipc`/`tui-device` (Rails `:null_session` / Sanctum dual-guard pattern).
- **MCP auth is transport-bifurcated per the real spec:** remote/HTTP MCP validates an RFC 8707 audience-bound OAuth token (401 + `WWW-Authenticate` + RFC 9728 PRM discovery); stdio MCP uses env credentials with no in-request token.
- Keep AUTH-DELEGATION (RFC primitives in core: AES-256-GCM sessions + rotation + PKCE/OIDC/TOTP already shipped; providers delegated to Auth.js/Better Auth).
- Steal the SvelteKit `form()` *pattern* (progressive HTML on web, typed mutation off-web) — not the experimental API.
- Do NOT import a Rails-`Current`-style ambient singleton (async-streaming hazard).

### 5.4 The in-process seam (prerequisite for TUI/Tauri)

Introduce a **stable in-process typed caller** (tRPC `createCallerFactory` / `localLink` analog): `callProcedure(name, input, ctxFactory) => Result`. This is the mechanism by which TUI and Tauri invoke shared logic **without** synthesizing an HTTP Request. Today TheoKit's only core seam is `executeWebRequest(Request):Promise<Response>` — this gap is unbridged (§8.8) and is the **first thing to prototype** (§7).

### 5.5 `build --target` contract (D4-narrow)

- `--target` stays **emit/deploy-only and fetch-handler-shaped** (the 9 existing targets: node/vercel/cloudflare/static/bun/deno-deploy/netlify/aws-lambda/theo-cloud). `DeployAdapter{name, build(config,cwd,ctx):Promise<void>}` unchanged; keep `makeVitePlugins` injection.
- **TUI/MCP/Tauri are NOT build targets.** They are **serve-shaped transport wrappers** over the one core handler, shipped as **CLI commands / sidecars** (matching ADR-0039 TUI + ADR-0042 MCP-stdio, already shipped). Tauri = a **sidecar reusing the node adapter**, not `adapter-tauri` — because Tauri IPC has a push half (`Channel`/`emit`) that Request→Response cannot express (§8.3).

### 5.6 Per-surface opt-in + capability boundary (D5 — the strong recommendation)

- **Default-DENY:** `surfaces: ['web']` + auth-required unless a unit explicitly opts onto MCP/RPC AND declares a per-surface capability guard.
- Enforce **structurally at the emit layer:** a unit not tagged `mcp` gets **no** tool descriptor and **no** `tools/call` route.
- **Fix the two holes now:** implement `tools/call` (return proper `CallToolResult` — `content[]` + `isError`, or `structuredContent` + `outputSchema`); add an auth/capability gate on `POST /api/agents/<name>/mcp` (currently unguarded); retain the per-tool Zod schema through `buildMcpToolDescriptors` (currently dropped); bump protocol to `2025-06-18`+.
- Generalize the in-repo `ui://` capability sandbox as the template for any surface rendering/executing app-supplied content.

---

## 6. The universal-unit resolution (route vs procedure vs hybrid)

**Winning evidence, weighed:**

- **For hybrid/procedure:** oRPC proves `.route()` can be optional metadata (`orpc.dev/docs/openapi/routing`); tRPC proves procedures need no verb/path (`procedure.ts:6-53`); TheoKit's own `tool()` already crosses the MCP wire via `z.toJSONSchema()`. Conventional apps are fully expressible as named procedures (Encore/Wasp/Blitz/Rails/Laravel all prove this).
- **Against full unification (decisive):** (a) **no framework ships an MCP/TUI/Tauri projector from a shared unit** — the projector template is fabricated; (b) cited "transport-independent" prior art is HTTP-codec-independent, not transport-agnostic; (c) the three TheoKit units differ in **input arity + output contract**, so merging is lossy; (d) merging collides with guardrails G4/G5; (e) the opencode single-surface design is deliberate, not a scar.

**Resolution: a bounded hybrid, NOT a universal procedure.**
- Keep `tool()` transport-independent (already is).
- Make `route()` HTTP-metadata **explicit-optional, adapter-read** (the surviving kernel of D1).
- Reuse logic across surfaces via a **shared plain typed function + in-process caller** (§5.4), not a single projected unit.
- This satisfies "author the logic once, project to web + MCP" (the realistic subset) while respecting the input-arity/output-contract divergence and the SDK-owns-the-wire boundary. **TUI and Tauri are gated on the in-process seam prototype + a scope ADR** (§7).

---

## 7. Open ADR decisions, risks, phased path

### 7.1 ADRs the owner must sign

- **ADR-1 (FOUNDATIONAL — blocks everything):** *Are TUI / MCP / Tauri authorized framework-core surfaces?* No current ADR or milestone grants this; framework-web scope + ADR-0040 (SDK-owned agent/MCP wire) put the agent/MCP wire SDK-side. Every downstream decision inherits its risk from this unmade call. Must respect the G1 boundary DAG (`@theokit/http` must not import `@theokit/agents`) — a unit straddling both packages was never proven to respect the locked dependency direction.
- **ADR-2:** *Bounded-hybrid unit shape* — keep `tool()` + `route()`; make `route()` HTTP-metadata explicit-optional; reject full unification.
- **ADR-3:** *Multi-writer ctx reconciliation* — how the inferred typed `TCtx` coexists with `pluginRunner.applyDecorations` + `jobBackend` `ctx.queue` (exclude / route-out / augment). Ship with type-tests against `execute.ts`.
- **ADR-4:** *`ctx.session` as a discriminated union* (`web-cookie | mcp-oauth | ipc | tui-device`), not a uniform type; CSRF web-only.
- **ADR-5:** *MCP authorization mechanism* aligned to the real spec (OAuth resource-server for remote / env creds for stdio), + `tools/call` + schema retention + protocol bump.
- **ADR-6:** *`--target` stays emit-only; TUI/MCP/Tauri are serve-wrappers/sidecars* (reject them as build targets).
- **ADR-7:** *Default-DENY per-surface exposure* + capability boundary.
- **ADR-8:** *Tauri push transport* — decide sidecar-over-node-adapter vs a new push seam; the `fetch(Request)=>Response` waist cannot express `Channel`/`emit`.

### 7.2 Risks

| Risk | Severity | Note |
|---|---|---|
| Building on a fabricated projector template | HIGH | D1 rests on prior art that does not exist; reclassify as "we invent it" (greenfield) or narrow the scope |
| `runtime==type` overclaim vs multi-writer ctx | HIGH | Would ship a typed ctx that lies (plugin/jobBackend writers) — the exact Hono failure |
| Uniform `ctx.session` hiding authz authority | HIGH | Confused-deputy footgun magnified across surfaces |
| Unauthenticated MCP route in production | HIGH | Already shipped; spends real LLM tokens; fix before any surface expansion |
| Category-error `--target tui/mcp/tauri` | MEDIUM | Would rip out shipped ADR-0039/0042; conflates emit with transport |
| Scope creep (TUI/Tauri without ADR-1) | MEDIUM | G11/YAGNI — sole real implementor today is web |
| Anchoring on experimental SvelteKit `form()` | LOW | Steal pattern, not API |

### 7.3 Phased path — prototype the contract before the transports

1. **Phase 0 — Scope ruling (ADR-1).** No code until TUI/MCP/Tauri are authorized core surfaces respecting the G1 DAG.
2. **Phase 1 — Typed-ctx + in-process caller contract (prototype FIRST).** (a) Multi-writer ctx reconciliation + type-tests against `execute.ts`; (b) the in-process typed caller (`callProcedure`) — the seam every non-HTTP surface needs. This is the load-bearing contract; prove it before any transport.
3. **Phase 2 — Close the MCP holes** (independent of everything, security-urgent): `tools/call`, MCP-route auth (real spec), schema retention, protocol bump, default-DENY exposure.
4. **Phase 3 — `ctx.session` discriminated union + web-only CSRF + `form()` pattern.**
5. **Phase 4 — MCP-as-a-first-class-surface projection** from the bounded-hybrid unit (route+tool sharing logic via the Phase-1 caller).
6. **Phase 5 (gated on ADR-1 + evidence) — TUI reuse hardening; Tauri sidecar** (with a push-transport decision, ADR-8). Explicitly deferred; no `--target` for these.

---

## 8. Completeness gaps to close (from the critics)

The following are **decision inputs, not footnotes**. Both concrete code holes were re-verified and hold.

- **8.1 — The projector template does not exist (highest blocker).** oRPC `.callable()` = generic in-process fn; `.actionable()` = Next-RSC-only. No studied framework emits an MCP tool descriptor + TUI command + Tauri IPC command from one shared unit. **Action:** produce a positive precedent OR concede TheoKit *invents* the projector (changes risk from "adopt prior art" to "greenfield research").
- **8.2 — `@effect/rpc` unstudied.** It is the one surveyed system that ships a single `Rpc` definition served over **multiple concrete transports** (HTTP/WS/worker) via swappable `Protocol` + `RpcSerialization` layers — the closest existing "one unit, N transports." Reduced to a strawman. **Action:** study `RpcServer.layerProtocolHttp` vs `layerProtocolWorker` — it validates or refutes the projector-registry design more directly than tRPC/oRPC.
- **8.3 — Tauri push half absent.** Tauri IPC has `invoke` (req→resp) **AND** `Channel`/`emit` (server→client push/streaming) — exactly what agent token-streaming needs on desktop. The `(nativeInput, ctxFactory)=>nativeOutput` seam and the `fetch(Request)=>Response` waist cannot express push. **Action:** research whether Tauri streaming maps onto TheoKit's existing `UIMessageStream` sink via a **sidecar reusing the node adapter** (verdicts strongly suggest sidecar, not `adapter-tauri`).
- **8.4 — Conventional-app categories uncovered:** (a) **file upload / multipart** — a single flat Zod object (MCP-shaped) cannot represent `multipart/form-data` with a streamed `File`; no story exists. (b) **DB migrations / persistence lifecycle** — a "cadastro" (signup) flow has no persistence-lifecycle decision (in-scope vs delegated). (c) **rate limiting across surfaces** — `RateLimitStorageAdapter` exists but D5 never says how it materializes per transport, and the *unauthenticated* MCP route is exactly where it matters most.
- **8.5 — `runtime==type` refuted vs multi-writer ctx.** Required design artifact: reconcile a generic-threaded typed ctx with plugin decorations + `jobBackend` injection, with type-tests against `execute.ts:122-165`. Only foreign single-writer frameworks were cited; no proof against TheoKit's own ctx.
- **8.6 — MCP auth mechanism invented.** "MCP capability-scope token" is not a spec primitive. Real spec: remote = OAuth 2.1 RS validating RFC 8707 audience-bound token; stdio = env creds, no in-request token. **Action:** re-decide `ctx.session` as a discriminated union aligned to the transport-bifurcated spec.
- **8.7 — No ADR authorizes TUI/MCP/Tauri as core surfaces.** framework-web scope + ADR-0040 put the agent/MCP wire SDK-side. The base-ctx `transport: 'web'|'tui'|'mcp'|'tauri'` invents three surfaces with a sole real implementor (web) — a G11/YAGNI collision. The G1 boundary DAG (`@theokit/http` ↛ `@theokit/agents`) was never checked against a straddling unit.
- **8.8 — The in-process caller seam is asserted but never designed for TheoKit.** The synthesis lists it (tRPC `createCallerFactory`, opencode worker-fetch shim) as the prior art for TUI/Tauri, but TheoKit's only core seam is `executeWebRequest(Request):Promise<Response>` — Request→Response, not an in-process typed caller. This is the practical make-or-break mechanism and has **no design**. **Prototype it first** (Phase 1).

### Bottom line for the decision-maker

The **diagnosis is verified and correct** (ctx hole, MCP auth hole, no `tools/call`, per-surface CSRF). But **four of five recommendations rest on at least one refuted or unverified load-bearing claim**: the non-existent projector template (D1/§8.1), `runtime==type` against multi-writer ctx (D2/§8.5), the invented MCP token (D3/§8.6), and Request→Response can't express Tauri push (D4/§8.3). Two conventional-app categories are uncovered (§8.4), one directly-relevant shipped framework is unstudied (§8.2, `@effect/rpc`), and the foundational scope question is unauthorized (§8.7). **Do NOT treat this as SHIPPABLE-with-caveats.** The one clearly-correct, un-refuted recommendation is **D5 default-DENY + close the two MCP holes** — start there, and prototype the **typed-ctx reconciliation + in-process caller contract (Phase 1)** before any transport work.

---

## Coverage Corner 1 — Integration Tests

- `tests/unit/services-manifest-v2.test.ts` EC-7 (schema-version drift guard) — the pattern for a per-surface manifest gate.
- `route-config-generic-arity.test.ts` (GAP-4) — LOCKED 5-arity invariant any ctx change must not break (D2).
- `tests/integration/contract-usetheo-ui-vite-plugin.test.ts` — cross-repo contract-test precedent for a producer/consumer seam (applicable to a procedure→MCP-tool contract test).
- Required new: type-tests proving `ctx.session` narrows per surface against `execute.ts`; a `tools/call` execution integration test; an unauthenticated-MCP-route regression test (negative case, asserts 401 with `WWW-Authenticate`).

## Coverage Corner 2 — Dependencies

- Zod v4 (`z.toJSONSchema()` — `define-agent-tool.ts:149`) — SSoT producer, already in-tree.
- `@theokit/sdk` (agent runtime; owns the MCP wire per ADR-0040) — the boundary a straddling unit must respect (G1 DAG).
- No new runtime dep required for the narrow variant. `@effect/rpc` is a **study target**, not an adoption target (§8.2). Auth providers remain delegated (AUTH-DELEGATION lock) — Auth.js / Better Auth.

## Coverage Corner 3 — Tools

- `theokit build --target <t>` (`cli/commands/build.ts:40-77`, `adapters/types.ts:24-50`) — keep emit-only.
- `theokit mcp <agent>` (`cli/commands/mcp.ts:27-64`) — shipped MCP-stdio wrapper (ADR-0042); the model for serve-wrappers.
- `run-terminal-agent.ts` (ADR-0039) — shipped TUI reuse of `streamAgentUIMessages` + approval registry.
- `handleMcpJsonRpc` (`mcp-handler.ts:77`) — one JSON-RPC handler behind HTTP+stdio; extend with `tools/call`.

## Coverage Corner 4 — Techniques

- Optional-metadata `.route()` (oRPC) — HTTP path/method adapter-read only.
- Middleware-accretes-typed-vars (Hono/tRPC/TanStack) — design intent; blocked by multi-writer ctx, apply at web seam only.
- In-process typed caller (tRPC `createCallerFactory`/`localLink`) — the TUI/Tauri seam to prototype first.
- Discriminated-union session (TheoKit `type-safety.md`) — models cross-surface authz authority honestly.
- Default-DENY capability ACL (Encore `expose:false`, Tauri capabilities, Rails safe-by-default) + in-repo `ui://` sandbox — the per-surface boundary.
- Transport-bifurcated MCP auth (OAuth RS remote / env stdio) — the real spec mechanism.

## ADRs referenced

ADR-0001 (Vite-plugin dep inversion), ADR-0039 (TUI reuse), ADR-0040 (SDK-owned agent/MCP wire), ADR-0042 (MCP-stdio CLI), ADR-0043 (builder-only scope). Guardrails G1/G2/G4/G5/G11/G13 (system-design-guardrails). GAP-4 (5-arity route generic invariant).
