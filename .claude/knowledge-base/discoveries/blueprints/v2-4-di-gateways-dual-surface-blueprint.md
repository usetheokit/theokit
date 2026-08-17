# V2-4 — di/gateways/dual-surface strategic ADR: discovery blueprint

**Date:** 2026-06-23 · **Slug:** v2-4-di-gateways-dual-surface · **Repo:** theokit (ADR home; develop)

## Objective
Close the gap-audit's M8-4/Tema F strategic question with a FINAL verdict ADR, grounded in the adoption evidence V2-2/V2-3 produced — which the predecessor ADR 0031 (2026-06-22) explicitly lacked.

## Prior decisions (the first steps this ADR finalizes)
- **theokit-sdk D431** (2026-06-18) — revoked "decorators mandatory via `@theokit/di`"; factory functions are the canonical API; decorators optional via the external `theokit-di` repo; the Harness MUST NOT depend on `@theokit/di`.
- **theokit ADR 0031** (2026-06-22) — wired the 3 mapped `@theokit/agents` decorators; decision point 3 declared di/gateways/orm/http-decorators an "OPTIONAL, imperative-first convenience layer … consumed only by apps that opt in", but flagged M8-4 as the open strategic question ("what is the future of the broader declarative layer"). 0031 had NO adoption evidence (it predates V2-2/V2-3).
- **theokit ADR 0030** — library sub-packages must never depend on the principal `theokit`.

## Evidence (multi-repo sweep, 2026-06-23 — file:line cited in the report)

### 1. Adoption: the V2 reference app adopted NONE of di/di-agent/orm/gateways/decorators
`/home/paulo/Projetos/usetheo/theocode` (the reference agent app, `@theokit/sdk ^2.5.0`) depends only on `@theokit/sdk`, `@theokit/sdk-tools`, `@theokit/ui`, `theokit`. Grep verdicts: `@theokit/di` ABSENT, `@theokit/di-agent` ABSENT, `@theokit/orm` ABSENT, gateways ABSENT, decorators ABSENT. The app builds a FULL agent (loop, tools, memory, plan-mode, eval/SWE-bench, UI) imperatively via `Agent.create()` + `defineTool` + `agent.send` (`server/lib/agent-stream.ts:314`). Its own system prompt explicitly tells agents "decorators exist … but this codebase does NOT use them" (`server/agents/code.prompt.ts:175`). The only app carrying di/di-agent is the legacy pre-V2 monorepo copy (`theokit-tools/theocode`, SDK ^1.9.0).

### 2. The imperative on-ramp is COMPLETE
theocode proves the imperative/factory-first path builds a complete code-assistant with zero di/decorators/gateways. V2-2 (adoption) + V2-3 (capability map + `@theokit/sdk/persistence`) hardened/exposed the imperative primitives the app actually uses.

### 3. Dual HTTP surface — M7 SHIPPED in theokit 0.8.1
The convention/filesystem-route dev-server now ships the primitives a builder previously hand-rolled:
- `defineHealthRoute`/`defineReadyRoute` (`src/server/define/health-route.ts:49,59`; wired into `theokit start` at `src/cli/commands/start/index.ts:126` → `/__theo/health|ready`).
- Typed errors `TheoError`/`fromUnknown`/`serverErrorToEnvelope`/`NotFoundError` (`src/core/contracts/theo-error.ts`; exported via `theokit/server`; envelope at every transport boundary `src/server/web-handler.ts:265`).
- A socketless `theokit/boot` (`createConventionFetchHandler`) for in-process embedding.
theocode uses surface (a) — the convention dev-server (`theokit dev/build/start`, 15 file-based routes under `server/routes/` via `defineRoute`/`defineAgentEndpoint`), and STILL hand-rolls `server/routes/health.ts` (it's on theokit ^0.5.4, pre-M7). The imperative `@theokit/http` `TheoApp` (`theocode/app.ts:13`) is present but VESTIGIAL/DEAD (`controllers: []`, unreferenced). Residual: readiness-config wiring is a TODO; `startDevServer`/`startCommand` stay CLI-only by design (boot exports the fetch handler, not the socket server); `NotFoundException` (NestJS name) does not exist — it's `NotFoundError`.

### 4. theokit-di / gateways: alive, barely/not used by V2
- `theokit-di` repo (own biome toolchain, last commit 2026-06-22 `@theokit/orm@0.1.0`): `@theokit/di 0.1.1`, `@theokit/di-agent 0.2.0`, `@theokit/orm 0.1.0`. External dependents: `@theokit/orm` → 2 theokit-plugins (standalone, non-DI); `@theokit/di`+`di-agent` → only the LEGACY theocode (zero V2 consumers).
- `theokit-gateways` repo (own biome toolchain, last commit 2026-06-18): 11 gateway packages. Consumers: only its own examples + SDK starter templates (telegram-bot). No real V2 consumer.

## Scope decision (what the ADR decides)
1. **di/di-agent/orm/gateways stay EXTERNAL + OPTIONAL + opt-in** (theokit-di, theokit-gateways repos) — confirm D431/0031. The boundary is CORRECT; the mistake (mandatory decorators) was already corrected. Zero re-absorption into the Harness; zero new extraction needed.
2. **The imperative/factory-first on-ramp is the canonical, complete path** — validated by the reference app adopting it exclusively.
3. **Dual HTTP surface RESOLVED:** the convention/filesystem dev-server is the PRIMARY surface (now has typed health/ready + typed errors + boot handler via M7); `@theokit/http` `TheoApp` is the secondary EMBEDDING surface. A builder no longer chooses between "convention without typed health" and "TheoApp" — the convention surface has the primitives.
4. **Honest residual follow-ups** (not blocking): theocode should adopt `defineHealthRoute` (drop hand-rolled `health.ts`) on a theokit upgrade; readiness-config wiring TODO; di-agent/gateways carry a "no V2 consumer" honesty note (kept, not deleted — external, zero Harness tax, latent value).

## ADR home + format
theokit `.claude/knowledge-base/adrs/0032-*.md` (next after 0031), standard format (Status/Date/Deciders/Milestone/Context/Decision/Rationale/Alternatives/Consequences). It continues 0031 (the first step) with the adoption evidence 0031 lacked, and references theokit-sdk D431.
