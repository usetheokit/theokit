# 0028. Multi-runtime strategy — R3a (Hono Web standards) chosen for C3 closure

* Status: accepted
* Date: 2026-06-06
* Deciders: [TheoKit team]
* Tags: [runtime, portability, architecture, c3-closure, web-standards, cloudflare-workers, deno, bun]

## Context and Problem Statement

The architectural review (`architecture-output/consolidated_final_report.md`, nota 3.5/5) surfaced C3 — **runtime incoherence**:

- **42 arquivos** in `packages/theo/src/server/` import `node:*` directly (`node:http`, `node:fs`, `node:crypto`, `node:stream`, etc.).
- **10 adapters** ship in-tree under `packages/theo/src/adapters/` (`node.ts`, `vercel.ts`, `cloudflare.ts`, `deno-deploy.ts`, `bun.ts`, `aws-lambda.ts`, `netlify.ts`, `theo-cloud.ts`, `static.ts`, `web-shim.ts`).
- **6 of those adapters are non-Node** (`cloudflare`, `deno-deploy`, `bun`, `aws-lambda`, `vercel`, `netlify`). The current `server/` runtime body **cannot execute under these runtimes** without per-import shims that don't exist.

The `theokit/CLAUDE.md` Ecosystem table honestly admits "TheoCloud is the only deploy target validated end-to-end; other adapters are opt-in compatibility surfaces". But the *structure* — 10 adapters visually treated as equals — promises something the code cannot deliver. This is the incoherence that closes the 3.5 → 4.0 gap (per `consolidated_final_report.md § Roadmap pra subir a nota`).

The discover-cycle blueprint (`.claude/knowledge-base/discoveries/blueprints/theokit-arch-gaps-investigation-blueprint.md` Q3, SHIPPABLE 96.4) found two **mutually-exclusive** architectural models — NOT variants of the same pattern — to resolve C3:

- **R3a (Hono Web standards)** — `Request` / `Response` baked into the base class; ONE codebase runs everywhere; adapters are 3-line shims that translate runtime-specific entry signatures into the Web API.
- **R3b (Nitro Strategy presets)** — `presets/<runtime>/` folders contain runtime-specific code; `presets/_resolve.ts` orchestrates which preset to inject at build time; `server/` core stays Node-shaped, `presets/` does the per-runtime work.

Per blueprint EC-2 (absorbed in plan v1.1) — **a hybrid R3a+R3b is forbidden**: "no third hybrid — the two are mutually-exclusive design centers and a halfway implementation will mislead plugin authors."

## Decision Drivers

* **Closure of C3 is non-negotiable for the 3.5 → 4.0 nota uplift.** The 1106-line implementation plan exists to ship this and 8 other gaps.
* **Adapter cost discovered empirically:** Hono `adapter/cloudflare-workers/index.ts` is **8 lines** (3 re-export statements + 5 lines of JSDoc); `adapter/cloudflare-workers/conninfo.ts` is **7 lines** that read one header. Adapter complexity is NOT where the cost lives in Hono — it lives in the Web standards baked into `hono-base.ts:479-485` (`fetch(): Response | Promise<Response>`).
* **Web standards is the universal direction** for edge runtimes (Cloudflare Workers, Deno Deploy, Bun, Vercel Edge, Netlify Edge). Migrating *away* from `node:*` reduces friction with the runtime ecosystem long-term.
* **TheoCloud deploys to Node** — current primary target stays Node-native. R3a doesn't break this: the Node adapter becomes a thin shim that wraps `IncomingMessage` ↔ `Request`.
* **Invariant 1 (zero cycles)** must hold. R3a creates zero new cycle pressure (handlers depend on Web standards only). R3b requires a dep-cruiser rule `presets MUST NOT import from server/* except contracts/` — an extra moving piece.
* **Invariant 2 (`core` depende de nada intra-monorepo)** — R3a respects naturally. R3b requires `presets/` and `core/` to be siblings, not parent-child, and adds a NEW barrel surface (`theokit/presets/<name>`) to public API.
* **Single-maintainer constraint.** R3a's blast radius (rewrite ~42 `node:*` sites) is bounded and one-shot. R3b's ongoing cost (presets are runtime-specific, multiply per runtime added, each needs its own test matrix) is unbounded.

## Considered Options

* **R3a — Hono-shape (Web standards FROM THE START).** ONE codebase. `server/` body uses `Request` / `Response` / `ReadableStream` / `Web Crypto` / `Headers`. Adapters are thin entry-signature shims (Node adapter wraps `IncomingMessage` ↔ `Request`; CF Workers / Deno / Bun adapters are 3–10 line files that pass `Request` through unchanged).
* **R3b — Nitro-shape (Strategy presets).** `server/` body stays Node-shaped. `presets/<runtime>/` contains per-runtime adapter code; `presets/_resolve.ts` (118 LOC, ported from Nitro) injects the right preset at build time. Adds a `theokit/presets/<name>` public barrel and a dep-cruiser rule.
* **Status quo (do nothing).** Forbidden by C3 finding — current state is "hybrid that doesn't work" per blueprint Q3 trade-off matrix.

## Decision Outcome

**Chosen option: R3a — Hono Web standards.**

Rationale:

1. **Lower long-term maintenance cost** (the unbounded multiplier of per-preset code surfaces in R3b would drown the single-maintainer scope).
2. **Truth in marketing.** The "TheoKit runs anywhere" framing becomes empirically true once R3a ships, not just structurally promised. Marketing honesty was explicitly cited in blueprint Q3 trade-off matrix as a Decision Driver.
3. **Bounded blast radius.** ~42 `node:*` import sites is a one-shot rewrite — concrete, auditable, finishable. R3b's "presets multiply per runtime" cost has no ceiling.
4. **Hono empirical finding** (blueprint Surprise #3): adapter complexity in the Web-standards model is **trivial** (7-line files). The C3 implementation cost is concentrated in `server/` body refactor, NOT in adapter authoring — which means the rewrite scope is well-defined and the resulting code surface stays small.
5. **Invariant compatibility favors R3a:** zero new cycle pressure, zero new public barrel surfaces, zero new dep-cruiser rules. R3b requires all three.

## Consequences

### Good

- C3 closes empirically (`grep -rln "from 'node:" packages/theo/src/server | wc -l` returns 0 post-implementation).
- "TheoKit runs anywhere" claim becomes auditable, not just structurally promised.
- Adapter ecosystem becomes maintainable by community (7-line shims are PR-friendly — barrier to "add `@theokit/adapter-fastly`" drops to near-zero).
- Future edge-runtime adoption (e.g., Vercel Edge V2, Bun.serve future versions) is shim-only — no `server/` body changes.
- Plugin authors who use `Request` / `Response` in their plugins get cross-runtime portability for free.
- Bundle size of `server/` core decreases (Node-binding code removed).

### Bad

- **Phase 5 has the highest blast radius in the plan** — ~42 file rewrites cascading through `server/http/`, `server/security/`, `server/scan/`, `server/jobs/`, `server/cron/`, `server/storage/`. Plan T5a.1 owns this; estimated 1–2 sprints of real wall-time.
- **BREAKING change for plugins** that imported `node:*` directly through TheoApp context (rare today, but possible). Migration guide required at `docs/migration/0.x-to-0.y-web-standards.md`.
- **Node adapter takes on shim cost** (`packages/theo/src/adapters/node.ts` becomes the boundary that translates `IncomingMessage` ↔ `Request`). This adds a tiny per-request allocation overhead in the most-used adapter — acceptable per Hono's empirical practice (Hono runs production workloads on Node without measurable overhead from the Web-standards baseline).
- **Some Node-specific affordances are lost** (e.g., direct access to `req.socket.remoteAddress` requires going through Web standards `c.req.header('x-forwarded-for')` instead, OR through the adapter-provided `getConnInfo()` helper). Plan T5a.1 documents migration of each `node:*` usage site.
- **Cloudflare Workers / Deno smoke testing** added to CI matrix (per plan T1.2 EC-5 + T5a.1 acceptance criteria). Requires wrangler CLI as new dev-dep — already declared in plan v1.2 § Dependencies New.

## Implementation outline

See `docs/plans/theokit-arch-gaps-implementation-plan.md` Phase 5a (T5a.1 — Migrar `server/http/` para Web Request/Response). Acceptance criteria for closure:

- [ ] `grep -rln "from 'node:" packages/theo/src/server | wc -l` returns 0
- [ ] Node adapter (`packages/theo/src/adapters/node.ts`) wraps `IncomingMessage` ↔ `Request` at the boundary; preserves backward compat for existing Node-target consumers
- [ ] `wrangler dev tests/fixtures/handler-web-standards/` returns 200 with native `Response` shape (Phase 1 T1.2 RED tests turn GREEN)
- [ ] CF Workers + Deno smoke tests added to CI (post-T5a.1)
- [ ] BREAKING change documented in migration guide + CHANGELOG `Changed (BREAKING)` entry

## Related artifacts

- **Blueprint:** `.claude/knowledge-base/discoveries/blueprints/theokit-arch-gaps-investigation-blueprint.md` Q3 (R3a + R3b + trade-off matrix + invariant compatibility analysis)
- **Implementation plan:** `docs/plans/theokit-arch-gaps-implementation-plan.md` v1.2 D3 ADR-deferral acknowledgement + Phase 5a task spec
- **Consolidated review:** `architecture-output/consolidated_final_report.md` C3 risk description
- **Architectural rules:** `.claude/rules/architecture.md` v3.1 (invariants 1, 2, 3 — preserved post-R3a)

## Sunset / re-validation

This decision is locked. Re-opening requires:

- A fresh ADR citing concrete evidence that R3b would deliver lower 18-month total cost than R3a (e.g., R3a's `server/` refactor stalls past sprint 4, OR Hono ecosystem makes a hostile breaking change to its Web-standards baseline).
- Demand evidence from ≥3 in-production TheoKit apps explicitly blocked by R3a's constraints.
- Sign-off from the TheoKit lead maintainer.

Sunset date: indefinite (this is a foundational architectural choice, not a calendar-gated experiment).
