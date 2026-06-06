# T5a.2 — IncomingMessage → Request SHAPE refactor

**Status:** PLANNED (dedicated multi-session work; not autonomous halt-loop scope)
**Plan version:** v1.0 (drafted 2026-06-06)
**Parent plan:** `docs/plans/theokit-arch-gaps-implementation-plan.md` v1.2 Phase 5a
**Predecessor commits:** T5a.1a-d (Web Crypto cutover) + T5a.1 audit (commits `730c33a`, `74424c6`, `a625f43`, `4ebde4a`, `ae09d2b`)
**Discovered via:** `docs/audit/arch-gaps-phase5a-progress-2026-06-06.md` Category C
**ADR:** `docs/adr/0028-multi-runtime-strategy.md` (R3a chosen)

---

## Why this is its own plan

T5a.1 (Web Crypto cutover) closed the `node:crypto` portion of C3 in 4 autonomous slices. The SHAPE refactor is **structurally different**:
- It changes **function signatures** of 24 files in `server/` (`req: IncomingMessage` → `req: Request`).
- It changes **call patterns** at every call-site (`req.headers['x-foo']` → `req.headers.get('X-Foo')`).
- It changes **response building** (`res.writeHead/end/setHeader` → `new Response(body, init)`).
- It changes **body handling** (Node `Readable` → Web `ReadableStream`).
- It requires a **Node adapter boundary shim** (`adapters/node.ts`) that converts Node `IncomingMessage`/`ServerResponse` ↔ Web `Request`/`Response`.
- It enables **CF Workers / Bun / Deno adapters to pass `Request` through without conversion**.

Per plan v1.2 § "Honest limitations": "T5a.1 (R3a path) tem blast radius alto — 42 arquivos reescritos. Pode levar 1-2 sprints." T5a.2 is the SHAPE portion of that estimate; T5a.1 was the leaf primitives (Web Crypto) portion.

---

## In scope

### File migration order (leaf-first per plan T5a.1 Task #3)

**Phase A — Foundation (1 session):**
1. Add structural type `TheoWebRequest` mirroring `Request` shape (extends a subset of native `Request` properties: `headers`, `method`, `url`, `body`).
2. Add Node adapter shim `adapters/node-web-shim.ts`:
   - `incomingMessageToWebRequest(req: IncomingMessage): Request`
   - `webResponseToServerResponse(response: Response, res: ServerResponse): Promise<void>`
   - Cookie header normalization (Node `req.headers.cookie` string|string[]|undefined → Web `req.headers.get('cookie')` string|null)
   - Body normalization (Node `Readable` → Web `ReadableStream`)
3. RED test: `executeWebRequest` exists in `theokit/server` barrel (currently the T1.2 RED test stub throws `"intentionally RED until then"`).

**Phase B — Header-only leaves (1 session):**
- `server/security/csrf.ts` — only reads `req.headers[X]`, `req.method`, `req.url`. Pure header-read leaf.
- `server/security/csrf-multi-header.ts` — same.
- `server/security/csrf-readiness-endpoint.ts` — header read + `res.writeHead`.
- `server/security/csp-report.ts` — header read + body parse.
- `server/http/cors.ts` — header read + `res.setHeader` + early `res.end` for preflight.
- `server/http/cookies.ts` — `req.headers.cookie` + `res.setHeader('Set-Cookie', ...)`.

**Phase C — Tracing + observability (1 session):**
- `server/http/trace-context.ts` — header read for `traceparent` / `x-request-id`.
- `server/observability/request-log.ts` — request log emit.

**Phase D — Rate-limit + auth (1 session):**
- `server/rate-limit/rate-limit-per-route.ts` — already async post-T5a.1d; convert IncomingMessage→Request.
- `server/rate-limit/rate-limit.ts` — same.
- `server/auth/session.ts` — read session cookie, set session cookie.

**Phase E — Body parsing (1 session):**
- `server/body-parser-web.ts` — already Web-compatible; verify pass-through.
- `server/body-parser.ts` — Node-only (Busboy) — STAYS Node-only per Phase 5a audit Category B; consumer switch from `body-parser.ts` to `body-parser-web.ts` happens here.

**Phase F — Plugin types + define/* (1 session):**
- `server/plugin-types.ts` — change `PluginContext.request` / `PluginContext.response` types to Web shapes.
- `server/define/define-channel.ts` — channel handlers.
- `server/define/define-websocket.ts` — WebSocket upgrade.

**Phase G — Execute pipeline (HIGH BLAST RADIUS, 2-3 sessions):**
- `server/http/execute-context.ts` — context construction.
- `server/http/execute-stages.ts` — middleware/handler/response stages.
- `server/http/execute.ts` — top-level executor.
- `server/http/action-execute.ts` — action executor.
- `server/http/middleware-runner.ts` — middleware runner.
- `server/http/send-response.ts` — response builder.
- `server/http/handle-request-error.ts` — error handler.
- `server/http/static.ts` — STAYS Node-only per Phase 5a audit (filesystem static server).

**Phase H — Integration + tests (1-2 sessions):**
- Update `vite-plugin/api-middleware.ts` to call new Web-Request executor (with Node-shim at edge).
- Update `adapters/node.ts` to use new shim.
- T1.2 RED tests (`tests/integration/handler-web-standards.test.ts`) all turn GREEN.
- CF Workers smoke (`wrangler dev tests/fixtures/handler-web-standards/`) returns 200.
- Bun + Deno adapter passes Request through without shim.

**Total estimate:** 9-11 dedicated sessions = approximately 1-2 sprints per plan v1.2 "Honest limitations".

---

## Out of scope (intentional)

- **`server/http/static.ts`** — Node-only static file server per ADR-0028; CF Workers use Assets/KV bindings, Vercel uses Edge Static. Stays Node-adapter scope per Phase 5a audit Category B.
- **`server/body-parser.ts`** — Busboy-based Node multipart parser. CF Workers/Bun consumers use `body-parser-web.ts` (already Web Standards). Stays Node-adapter scope per Phase 5a audit Category B.
- **Scanner / build-time leaves** (`scan/*`, `_internal/*`, `jobs/job-scan.ts`, `cron/cron-scan.ts`, `cron/adapter-translators.ts`) — Node-only at build/scanner boundary per ADR-0028. NOT migrating.
- **Public API breaking change beyond `executeWebRequest`** — `defineRoute`/`defineAction` signature changes for handlers (`(req, res) => ...` → `(req) => Response`) — schedule via separate ADR after T5a.2 lands the executor.

---

## Test infrastructure prerequisites

**Pre-T5a.2 cleanup (out of T5a.2 scope but blocks it):**
1. Fix CLI test fixture (`tests/integration/cli-build-emits-{cron,job}-manifest.test.ts`) — the minimal `package.json` in the tmp fixture doesn't include `better-sqlite3`, so CLI preflight rejects. Two options:
   - **Option A:** add `better-sqlite3` to fixture's `package.json` + symlink to monorepo's `node_modules`.
   - **Option B:** add a CLI flag `--skip-native-preflight` for test fixtures (preferred — cleaner).
2. Verify `pnpm rebuild better-sqlite3` succeeds in dev (verified 2026-06-06 — sentinel at `node_modules/.cache/preflight-native-127.ok`).
3. Acquire Cloudflare account credentials for `wrangler dev` smoke (CF Workers Free tier suffices).

---

## Validation gates

Per T5a.2 each phase MUST satisfy:
- `pnpm typecheck` exit 0.
- Phase-scoped test sweep GREEN.
- T1.2 RED counter decreases monotonically (target: 7 → 0 by Phase H).
- `pnpm depcruise` zero violations (architecture invariants preserved).
- `tests/unit/r3a-web-crypto-migration-leaf.test.ts` invariant guards stay GREEN (no Node-only regression).

Final acceptance (post-Phase H):
- `tests/integration/handler-web-standards.test.ts` 8/8 GREEN (all 7 documented-RED turn GREEN).
- `wrangler dev tests/fixtures/handler-web-standards/` returns 200.
- `dogfood full` skill exercises Web Request boundary end-to-end (after fixture fix above).
- `loop-architecture-review --mode=full` re-run scores nota ≥ 4.0/5.

---

## Anti-patterns to avoid

1. **Big-bang refactor across all 24 files in one PR** — blast radius is too large for review. Phase per session, atomic commit per phase.
2. **Drop `IncomingMessage` from public API in the same release that introduces `Request`** — ship both shapes during one minor version with the Node adapter providing both; deprecate `IncomingMessage` in the next minor. Don't double-break consumers.
3. **Skip the Node adapter shim** — without it the only deployable runtime would be CF Workers/Bun/Deno. Node consumers MUST continue to work via the shim during the migration window.
4. **Migrate the executor (Phase G) before the leaves (Phase B-F)** — the executor's `executeWebRequest` must compose from already-migrated leaves. Leaves first, executor last.
5. **Convert function signatures without updating tests in the same commit** — tests are part of the leaf; both move together.

---

## Cross-references

- ADR: `docs/adr/0028-multi-runtime-strategy.md`
- Parent plan: `docs/plans/theokit-arch-gaps-implementation-plan.md` v1.2 Phase 5a
- Predecessor audit: `docs/audit/arch-gaps-phase5a-progress-2026-06-06.md`
- Phase 6 audit: `docs/audit/arch-gaps-phase6-progress-2026-06-06.md`
- T1.2 RED tests (waiting for this plan to GREEN): `tests/integration/handler-web-standards.test.ts` (commit `54bc2e3`)
- Invariant guards (must stay GREEN throughout): `tests/unit/r3a-web-crypto-migration-leaf.test.ts`
- Node adapter (will host the shim): `packages/theo/src/adapters/node.ts`
- Pre-existing CLI test fixture issue (blocks `dogfood full`): `tests/integration/cli-build-emits-{cron,job}-manifest.test.ts` + preflight `packages/theo/src/cli/preflight-node-version.ts:91`
