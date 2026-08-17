# ADR 0032 — V2-4 final verdict: imperative on-ramp is complete; di/gateways/orm stay external+opt-in; the dual HTTP surface is resolved (convention is primary)

**Status:** Accepted
**Date:** 2026-06-23
**Deciders:** project owner
**Milestone:** V2-4 (gap-audit Tema F / Seção 6 / M8-4 — the broader declarative-layer strategic question)
**Plan:** `.claude/knowledge-base/plans/v2-4-di-gateways-dual-surface-plan.md`
**Continues:** ADR 0031 (M8 decorator runtime — wired the 3 agents decorators; deferred the broader-di verdict to M8-4)
**References:** ADR 0030 (library sub-packages never depend on principal `theokit`); theokit-sdk ADR `revoke-decorators-mandatory` (factory-first; Harness must not depend on `@theokit/di`)

## Context

ADR 0031 (2026-06-22) wired the three mapped `@theokit/agents` decorators and declared `@theokit/di` / `di-agent` / `@theokit/orm` / gateways "an OPTIONAL, imperative-first convenience layer … consumed only by apps that opt in." But 0031 explicitly flagged **M8-4** as the OPEN strategic question — *"what is the future of the broader declarative layer?"* — and it had **no adoption evidence**: it predates the V2 adoption cycles (V2-2 hardened/reconciled theocode's use of the imperative primitives; V2-3 shipped the harness capability map + the public `@theokit/sdk/persistence` subpath). V2-4 closes M8-4 with the evidence those cycles produced.

A second open thread is the **dual HTTP surface**: a builder previously had to choose between (a) the convention/filesystem-route dev-server (`theokit dev`, `defineRoute`, file-based routes) which lacked typed health/errors, and (b) the imperative `@theokit/http` `TheoApp` which does not serve the `theokit dev` routes. The "M7 http dual-surface" work shipped in theokit 0.8.1; this ADR records whether that resolved the tension.

## Evidence (2026-06-23 multi-repo sweep — file:line in `knowledge-base/discoveries/blueprints/v2-4-di-gateways-dual-surface-blueprint.md`)

1. **The V2 reference app adopted NONE of di/di-agent/orm/gateways/decorators.** `/home/paulo/Projetos/usetheo/theocode` (`@theokit/sdk ^2.5.0`) depends only on `@theokit/sdk`, `@theokit/sdk-tools`, `@theokit/ui`, `theokit`. Grep across `server/`+`app/`+`lib/`: `@theokit/di` ABSENT, `@theokit/di-agent` ABSENT, `@theokit/orm` ABSENT, gateways ABSENT, decorators ABSENT. It builds a full code-assistant (agent loop, tools, memory, plan-mode, eval/SWE-bench, UI) imperatively via `Agent.create()` + `defineTool` + `agent.send` (`server/lib/agent-stream.ts:314`), and its own system prompt tells agents "decorators exist … but this codebase does NOT use them" (`server/agents/code.prompt.ts:175`). Only the legacy pre-V2 monorepo copy carries di/di-agent.
2. **The imperative/factory-first on-ramp is complete.** theocode proves the imperative path ships a complete agent app with zero di/decorators/gateways. V2-2 (adoption) + V2-3 (capability map + `@theokit/sdk/persistence`) hardened and exposed exactly the imperative primitives it uses.
3. **The dual HTTP surface — M7 shipped (theokit 0.8.1).** The convention server now exports + serves the primitives a builder previously hand-rolled: `defineHealthRoute`/`defineReadyRoute` (`packages/theo/src/server/define/health-route.ts:49,59`; wired into `theokit start` → `/__theo/health|ready`), typed errors `TheoError`/`fromUnknown`/`serverErrorToEnvelope`/`NotFoundError` (`packages/theo/src/core/contracts/theo-error.ts`; envelope at every transport boundary `packages/theo/src/server/web-handler.ts:265`), and a socketless `theokit/boot` (`createConventionFetchHandler`) for in-process embedding.
4. **theokit-di / gateways: alive, barely/not used by V2.** `theokit-di` (own repo, `@theokit/orm@0.1.0` released 2026-06-22): `@theokit/orm` has 2 plugin consumers (standalone, non-DI); `@theokit/di`+`di-agent` have ZERO V2 consumers (only the legacy app). `theokit-gateways` (own repo, 11 packages): no real consumer — only its own examples + SDK starter templates.

## Decision

1. **di / di-agent / orm / gateways stay EXTERNAL, OPTIONAL, and opt-in.** They remain in their own repos (`theokit-di`, `theokit-gateways`); the Harness (`@theokit/sdk`) and the principal `theokit` MUST NOT depend on them (upholds ADR 0030 + the SDK's `revoke-decorators-mandatory`). The boundary set by those prior ADRs is **correct and final** — no re-absorption into the Harness, and no further extraction work is needed. The adoption evidence ratifies it: the reference app needed none of them to ship a complete agent.

2. **The imperative/factory-first on-ramp is the canonical, complete path.** Building an agent app via factory functions (`Agent.create`/`defineTool`/`agent.send`) + the `theokit` convention server is the supported, evidence-validated way. Decorators (`@theokit/agents` + the optional `@theokit/di` layer) remain a convenience for apps that opt in, never a requirement. New agent primitives ship as imperative factories first (sugar over the SDK), never as a parallel DI-first surface.

3. **The dual HTTP surface is RESOLVED: the convention/filesystem dev-server is the PRIMARY surface; `@theokit/http` `TheoApp` is the secondary EMBEDDING surface.** M7 closed the capability gap — the convention server now ships typed health/ready + typed errors + a socketless boot handler, so a builder no longer chooses between "convention without typed health/errors" and "TheoApp." Use the convention server (`theokit dev/build/start`, file-based routes) by default; reach for `@theokit/http` `TheoApp` only to embed the app in-process / mount it inside another server.

4. **Residual follow-ups are tracked as non-blocking Consequences** (below), not new strategic questions. V2-4 (and the V2 program) is complete.

## Rationale

- **The strategic direction was already set** by `revoke-decorators-mandatory` (factory-first; Harness has no IoC container) + ADR 0031 (imperative-first; di/gateways opt-in). V2-4's job was to confirm it WITH DATA — and the data is unambiguous: the reference app, free to use anything, used the imperative SDK exclusively and none of the declarative/DI/gateway packages. Reversing the boundary now would re-open the exact Backend-DX scope creep (di → di-agent → orm → http-decorators) that `revoke-decorators-mandatory` rejected, violating Unbreakable Rules 7/9 (don't reinvent), KISS, and YAGNI.
- **Keeping di/gateways external is zero-cost to the Harness** (no dependency, no maintenance tax) and preserves latent value: `@theokit/orm` already has plugin consumers; the gateways back the starter templates. Deleting them would destroy that value for no benefit; absorbing them would violate the four-pillar split (the SDK is the Harness, not a backend framework).
- **The convention server is primary because that is what the reference app uses** (15 file-based routes via `defineRoute`/`defineAgentEndpoint`; `theokit dev/build/start`), and M7 gave it the two things the app had to hand-roll (typed health, typed errors). The imperative `TheoApp` keeps its distinct, narrower job (embedding) — both surfaces now coexist without forcing a capability trade-off, so neither needs to be deprecated.

## Alternatives considered

- **Re-absorb `@theokit/di`/`orm` into the Harness (or principal `theokit`)** — rejected: re-introduces a generic IoC/ORM dependency into an agent SDK (the precise scope creep `revoke-decorators-mandatory` removed), violates Rule 7/9 + KISS, and contradicts the four-pillar split. The adoption evidence shows zero demand from the reference app.
- **Deprecate/delete `di-agent` + gateways (zero V2 consumers)** — rejected: they are external + opt-in, so they impose ZERO maintenance tax on the Harness, and they carry latent value (gateways back the starter templates; `orm` has plugin consumers). "Unused by the reference app" ≠ "should be deleted" when the cost of keeping them external is nil. Their honesty status (no V2 consumer) is recorded, not acted on.
- **Make `@theokit/http` `TheoApp` the PRIMARY HTTP surface** — rejected: the reference app uses the convention server; M7 gave the convention server the typed health/errors it lacked, so there is no reason to demote it. `TheoApp` is the right tool for embedding, a narrower job.
- **Defer the verdict again (keep M8-4 open)** — rejected: the V2-2/V2-3 cycles + the 2026-06-23 sweep provide exactly the adoption evidence ADR 0031 said it lacked. Deferring would waste that evidence and leave the boundary ambiguous.

## Consequences

- **Enables** a clear, evidence-backed ecosystem boundary: the Harness + principal `theokit` are imperative/factory-first and self-sufficient; di/gateways/orm are opt-in externals. Marketing/docs can state the imperative on-ramp is the canonical path without hedging.
- **Constrains:** any future proposal to make decorators/DI mandatory, or to absorb di/gateways/orm into the Harness or principal `theokit`, must supersede this ADR + `revoke-decorators-mandatory` + ADR 0031 with new evidence. New agent primitives ship imperative-first.
- **Residual follow-ups (non-blocking):**
  - theocode should adopt `defineHealthRoute` (drop its hand-rolled `server/routes/health.ts`) when it upgrades from `theokit ^0.5.4` to ≥ 0.8.1 — a consumer upgrade, not a framework gap.
  - The convention server's readiness-probe wiring from `theo.config.ts` is a documented TODO (`packages/theo/src/cli/commands/start/index.ts:120-124`).
  - The gap-audit snapshot's `NotFoundException` name does not exist; the canonical typed-404 is `NotFoundError` — a naming correction, recorded here.
  - `@theokit/di` + `di-agent` carry a "no V2 consumer" status; if that persists, a future ADR may consider deprecation — but only with that evidence, and never as a Harness-coupling change.
