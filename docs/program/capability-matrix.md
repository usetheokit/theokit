# Capability matrix — what the north-star app must exercise

Versioned recipe for `rules/northstar-app.md`. The application itself is not committed; this file and the evidence it produces are. Derived from the framework's own public surface on 2026-08-19 — the `exports` map of every package, the config schema, the reserved route filenames, the reserved agent folders, the adapter registry and the presenters. Re-derive whenever the public surface changes; a capability absent here is one that will never be validated.

## Counts

| Surface | Count |
|---|---|
| Public subpaths | 55 — `theokit` 24 · `@theokit/agents` 20 · `@theokit/http` 7 · `@theokit/presenter` 2 · `@theokit/tauri` 2 |
| Config keys (`theo.config.ts`) | 32 |
| Reserved agent folders | 13 |
| Reserved route filenames | 5 |
| Deploy adapters | 9 |
| Presenters | 3 |

`create-theokit` has no `exports` — it is a bin scaffolder, validated by `pnpm try:scaffold` rather than by import.

## What "100%" can honestly mean

It cannot mean every capability. A measured portion of the surface is unreachable from a local validation run, and pretending otherwise would make the whole exercise a claim nobody can check. So the target is stated in three tiers, and the app reports against each separately.

| Tier | Definition | Claim it supports |
|---|---|---|
| **T1 — Exercised** | Driven end to end by the app, evidence recorded | "this works" |
| **T2 — Reached but not completed** | Invoked, and the framework refused or the artifact was produced without being run (e.g. `build --target vercel` emits output; nothing deploys it) | "this is wired" |
| **T3 — Out of reach** | Requires a paid account, a foreign runtime, a TTY, an external service, or a real platform | nothing — and saying so is the point |

**100% means T1 ∪ T2 ∪ T3 covers the whole surface with no capability unaccounted for**, and every T3 entry carries the reason it is out of reach. The number that matters is |T1|, reported honestly against |T1|+|T2|+|T3|.

## Architecture the app must have

```
backend  →  presenter  →  ┬─ Web
                          └─ TUI
```

Non-negotiable: **the same run must render through both front-ends via the same presenter.** That is the assertion that proves `three-target-parity.md` rather than asserting it. An app with only a Web front-end validates one target and leaves the rule unproven.

## T1 — Core, target-agnostic (must work in Web, Tauri and TUI)

| Capability | Subpath | Evidence | How the app exercises it |
|---|---|---|---|
| Route/action/ws/middleware/tool/plugin authoring | `theokit/server/define` | `server/define/index.ts:29-34` | a `route().get()` reached through `theoFetch` |
| Convention scanner | `theokit/server/scan` | `server/scan/index.ts:1-7` | files created; manifest observed |
| Agent discovery + 13 reserved folders | `theokit/server/scan` | `server/scan/agent-scan.ts:22-36,52` | `agents/x/tools/y.ts` is NOT a route; `agents/x/index.ts` is |
| Programmatic fetch handler | `theokit/boot` | `server/boot.ts:43` | serve a `Request` with no CLI |
| HTTP pipeline (CORS, cookies, batch, trace, error pages) | `theokit/server/http` | `server/http/index.ts:5-17` | request with `traceparent`, assert propagation |
| Typed errors + envelope | `theokit/server/http` | `server/http/index.ts:5-8` | throw `TheoError`, assert the serialized envelope |
| Auth (session, TOTP, backup codes, throttle, OAuth PKCE, OIDC) | `theokit/server/auth` | `server/auth/index.ts:1-10` | login + session rotation + second factor |
| Cron | `theokit/server/cron` | `server/cron/index.ts:11-42` | `crons/tick.ts` fires; execution asserted |
| Webhooks (raw body, timing-safe compare) | `theokit/server/webhook` | `server/webhook/index.ts:7-11` | one signed POST, one with a wrong signature |
| Rate limit | `theokit/server/rate-limit` | `server/rate-limit/index.ts:1-3` | exceed the limit, assert 429 |
| Plugins | `theokit/server/plugins` | `server/plugins/index.ts:1-2` | a config plugin marking the request |
| Realtime channels | `theokit/server/realtime` | `server/realtime/channel-manager.ts:3` | two ws clients on one channel |
| In-process agent seam, code-mode, MCP stdio, ACP | `theokit/server/agent` | `server/agent/index.ts:12-70` | TUI runs a turn with no HTTP |
| Agent authoring + guardrails + A2A + skills | `@theokit/agents` | `agents/src/index.ts:19-31,136` | agent with a tool and a guardrail |
| HITL approval | `@theokit/agents/bridge` | `agents/src/bridge-entry.ts:2-4` | a human approval blocking a tool |
| Agent client + 3 transports | `@theokit/agents/client` | `agents/src/client-entry.ts:28-53` | **the same turn over all three transports** |
| Session / persistence / hooks / ask / commands / doctor / tool-scope / mcp-health / testing | `@theokit/agents/*` | per-entry barrels | resume a session; pre-tool hook; `askUserVia`; `diagnose()` |
| `AgentOutputEvent` + Presenter strategy | `@theokit/presenter` | `presenter/src/index.ts:10-18` | **one turn rendered by all three presenters** |
| Wire protocol | `@theokit/presenter/wire` | `presenter/src/wire/index.ts:10-25` | `readMessageStream` over a synthetic stream |
| Tauri sidecar (turn → JSONL) | `@theokit/tauri/sidecar` | `tauri/src/sidecar.ts:23` | run the binary, read JSONL |
| Decorator HTTP layer + `TheoApp` | `@theokit/http`, `/app`, `/runtime/node` | `http/src/index.ts:2-6`, `app.ts:172` | a decorated controller serving a route |

## T1 — Web presentation

| Capability | Subpath | Evidence | How the app exercises it |
|---|---|---|---|
| Vite plugin, dev server, HMR | `theokit/vite-plugin` | `vite-plugin/index.ts:300` | edit a page in dev |
| Reserved route files (`page`,`layout`,`error`,`loading`,`not-found`) | convention | `router/types.ts:5,11` | force an error, assert `error.tsx` renders |
| `theoFetch` + typed app client + batching | `theokit/client` | `client/index.ts:7-15` | two concurrent calls collapse into one `/api/__theo_batch__` |
| React-free agent client | `theokit/client/core` | `client/core.ts:11-13` | import in Node, assert React absent |
| React Query adapter | `theokit/react-query` | `client/react-query.ts:31` | `stableQueryKey` + a query hook |
| Devtools overlay | auto-injected | `config/schema.ts:202` | open the overlay in dev |
| Security headers / CSRF / CSP report | `theokit/server/security` | `server/security/index.ts:1-5` | POST without a CSRF token is rejected |

## T2 — Reached, not completed

- **6 of 9 deploy adapters** (`vercel`, `cloudflare`, `netlify`, `aws-lambda`, `deno-deploy`, `theo-cloud`) — `adapters/registry.ts:27-33`. The app asserts the artifact is emitted; running it needs the real platform.
- **Jobs on Postgres, storage on Postgres/Redis** — in-memory paths are T1; the backed ones need a service.
- **`openapi` typed client** — soft-depends on `@hey-api/openapi-ts`, and **skips silently when absent**, which is indistinguishable from success. The app must assert the artifact, never the exit code.

## T3 — Out of reach, with the reason

| Capability | Why |
|---|---|
| A real provider turn (Anthropic / OpenAI) | paid credential. With a mock it does not validate the provider; without one it does not run |
| `@theokit/agents/auth` device-code flow | interactive login at an external provider |
| `@theokit/tauri` client transport | needs `window.__TAURI__`; only the sidecar runs headless |
| `@theokit/agents/pty` | needs a real TTY |
| Bun / Deno / Cloudflare shims | need runtimes that are not the CI's Node |
| Polyglot `services` | need Python/Node sidecars and free ports |

## The capabilities the app must FAIL on

These ship, are exported or reachable, and have no production caller. An app that tries them and cannot is producing the **correct** result, and that result is evidence. Recording these failures is required — `dogfood-golden-rule.md` § 4 mandates at least one failure story, and these are it.

| Capability | Evidence | What the app observes |
|---|---|---|
| The whole `cache/` subsystem | `cache/index.ts:10-52` | **no public subpath at all** — only reachable through the deprecated `theokit/server` barrel (`server/index.ts:98`), which prints a deprecation warning on first import |
| `initCacheEngine` | `cache/engine-singleton.ts:23` | with `cache: {}` configured, the engine is never initialised; `getCacheEngine()` throws "Cache engine not initialized" (`:57`) |
| `createObservabilityPlugin` | `observability/index.ts:11` | must be registered by hand in `plugins`; without that, no request span exists |
| `trackAgentRun` | `server/cost/track-agent-run.ts:49` | the devtools agents tab stays empty — the code itself says "trigger a request to an endpoint using `trackAgentRun`" (`devtools/.../AgentsTab.tsx:94`) |
| `evaluateCsrfMultiHeader` | `security/csrf-multi-header.ts:128,171` | **not exported** by `security/index.ts` — unreachable by any consumer |
| `@theokit/http/action-encryption` | `http/src/action-encryption.ts:21,52,72` | callable directly; nothing in the action pipeline uses it |
| `@theokit/http/server-inserted-html` | `http/src/server-inserted-html.ts:38` | no SSR path consumes it |
| `@theokit/http/css-resource` | `http/src/css-resource.ts:31` | same shape: test-only |

## Not measured

Real coverage of the 24 `theokit` subpaths by the existing suite (it was not run), and the full symbol contents of the `export *` barrels (`server/auth`, `server/http`, `server/scan`, `server/security`, `agents/capability`, `agents/loop`, `agents/guardrails`) — re-exported modules were counted, not every symbol.
