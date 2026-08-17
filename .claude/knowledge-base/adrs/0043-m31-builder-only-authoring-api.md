# ADR-0043 — M31 Builder-only authoring API (4 decisions)

- **Status:** Accepted (2026-07-08)
- **Milestone:** M31
- **Context:** The fluent builder becomes the ONLY authoring surface across all 8 define-surfaces
  (agent · tool · route · action · websocket · middleware · config · plugin); every `define*` and every
  `@theokit/agents` decorator is removed from the public API. This ADR records the four load-bearing
  decisions the plan (`builder-only-authoring-api-plan.md`) named.

---

## D1 — Builder-only = un-export, NOT delete

**Decision:** "Remove `define*`/decorators" means remove them from the **public barrels** (`packages/theo/src/index.ts`, `server/define/index.ts`, `@theokit/agents` index, `decorators/*`). The functions stay as **internal** implementation that each builder's `.build()` delegates to.

**Rationale:** All 8 `define*` are identity/branded functions the scan/compile/loadConfig/SDK runtime consumes. A builder whose `.build()` emits that exact shape leaves the runtime **100% untouched** — only the authoring surface changes. Deleting the internal impl would force a runtime rewrite for zero benefit.

**Alternatives rejected:** (a) physically delete define*/decorators → forces runtime rewrite, high risk. (b) keep them exported → does not achieve "one pattern".

---

## D2 — Decorator-only capability resolution

**Decision:**
- `guardrails` / `approvals` / `skills` → **builder methods** `.guardrail(s)/.approval(s)/.skills` (they map to existing `DefineAgentConfig` fields; shipped in Phase 2).
- `@Checkpoint / @MainLoop / @Toolbox / @SubAgents / @Memory / @Mcp / @Mixin` → these are **decorator-only** (no `DefineAgentConfig` field today) and have **ZERO in-tree consumers** except `examples/` (deleted in M31). Their decorators are removed; the capabilities are **DROPPED from the authoring surface** and re-addable as thin builder methods when a shipped app needs them (the `CompiledAgentOptions` fields remain, so re-adding is a config-field + setter, not a redesign). `@Mixin` is replaced by the existing `.use(preset)` composition.

**Rationale:** "No SILENT capability loss" (the constraint) is satisfied by documenting the drop here. YAGNI (G11) forbids carrying 6 builder methods with no caller/test (G7). The drop is reversible in minutes.

**Alternatives rejected:** (a) add all 6 methods now → violates YAGNI/G7 (uncalled exports). (b) keep the decorators → breaks "one pattern".

**Re-evaluation trigger:** a shipped TheoKit app declares it needs checkpoint/mainLoop/subAgents/memory/mcp/toolbox — add the corresponding `.<method>()` + config field + compile mapping + test.

---

## D3 — `config()` hybrid grammar

**Decision:** `config()` exposes dedicated setters for the common fields (`name/serverDir/appDir/agentsDir/distDir/port/host/ssr`) PLUS a `.set(partial: Partial<TheoConfig>)` escape hatch for the ~20-field long tail (rateLimit/security/upload/services/openapi/…), terminal `.build()`.

**Rationale:** Config is a flat ~30-field bag. A pure setter chain (30 methods) is worse DX than the object literal — which is exactly why Vite/Nuxt/Astro keep `defineConfig` as an identity object. The hybrid keeps discoverable setters for the hot path and object-parity for the tail.

**Alternatives rejected:** (a) 30 setters → worse DX than an object. (b) keep `defineConfig({})` as the config authoring surface → breaks "all surfaces".

---

## D4 — Handler-method naming per surface

**Decision:** the handler-setting method is named per the surface's ecosystem idiom, terminal is always `.build()`:
- **tool** → `.execute()` (AI-ecosystem muscle-memory: Mastra/Vercel AI SDK/OpenAI Agents all use `execute`).
- **route / action** → `.handler()` (HTTP idiom: Hono/Nitro/Express).
- **websocket / plugin** → lifecycle names (`onOpen`/`onMessage`/`onRequest`/…).
- **middleware** → `.handle()`.

**Rationale:** a uniform `.handle()` everywhere would fight the muscle-memory of both the AI-tool ecosystem (`execute`) and the HTTP ecosystem (`handler`). Matching the idiom the reader already knows lowers onboarding friction — the whole point of M31.

**Alternatives rejected:** uniform `.handle()`/`.run()` across all surfaces → maximal internal consistency but fights every reader's prior.

---

## Consequences

- The runtime/scan/compile/loadConfig paths are unchanged (D1) — the migration is authoring-only.
- theo-code-v2 (anchor app) migrated + proven end-to-end (dogfood evidence 2026-07-08).
- The 6 dropped decorator-only capabilities (D2) are the only capability reduction; documented + reversible.
- Cross-references: plan `builder-only-authoring-api-plan.md`, blueprint `builder-only-authoring-api-blueprint.md`.
