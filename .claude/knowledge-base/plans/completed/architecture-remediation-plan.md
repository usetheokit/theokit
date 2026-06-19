# Plan: Architecture Remediation — Fix Real Cycle + DRY Violations + Reduce Complexity

> **Version 1.1** — Remediate confirmed findings from the `loop-architecture-review` 2026-06-12 audit, re-scoped after `/edge-case-plan` validation (EC-1). The audit reported 6 module-level cycles, but `dependency-cruiser` and `madge` confirm only **1 real file-level cycle** (`generate-resource.ts ↔ generate.ts`). The 5 other "cycles" were artifacts of abstract module grouping that do not exist at the import graph level. Plan re-scoped to: fix the 1 real cycle, extract 2 DRY violations, and reduce CC=33 in `request-handler.ts`.

## Goal

> Ship zero-cycle architecture with reduced request-pipeline complexity so that `npx dependency-cruiser --validate packages/` reports 0 errors AND `lizard packages/theo/src/cli/commands/start/request-handler.ts -T cyclomatic_complexity=10` reports 0 violations, measured by CI architecture-guards passing green and `bun test` green.

## Context

The `loop-architecture-review` audit (2026-06-12) found 6 "critical dependency cycles" at the abstract module level. However, **edge case validation (EC-1)** using the project's own enforcement tools revealed:

- `npx dependency-cruiser --output-type err packages/theo/src/ packages/agents/src/` → **1 real cycle** (`generate-resource.ts ↔ generate.ts`)
- `npx madge --circular --extensions ts,tsx packages/theo/src/ packages/agents/src/` → confirms the same single cycle
- The 5 "cycles" in agents, auth/http/rate-limit, and core/security/observability were **module-grouping artifacts** — the file-level import graph is acyclic

The remaining confirmed HIGH findings are real: DRY violation (`envelopeCodeToStatus` duplicated in 2 files), DRY violation (`isAuthRequiredError` duck-type in 3 locations), and CC=33 in `request-handler.ts` (3.3x McCabe consensus threshold).

Evidence: `dependency-cruiser` output, `madge --circular` output, `architecture-output/final_report.md`, `knowledge-base/reviews/architecture-remediation-edge-cases-2026-06-12.md`.

## Baseline Context

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/theo/src/cli/commands/generate.ts` | 367 | `a00269c` (2026-06-12) | CLI scaffolding for route/action/page/ws/controller/agent/toolbox/resource | `generate()` export signature, `VALID_TYPES` array, existing 7+1 types |
| `packages/theo/src/cli/commands/generate-resource.ts` | 233 | `a00269c` (2026-06-12) | Resource scaffold (schema + routes + test) | `generateResource()` export |
| `packages/theo/src/server/web-handler.ts` | 601 | `a611f24` (2026-06-06) | Web request execution pipeline (body parse, CSRF, route exec, response) | `executeWebRequest()` export signature |
| `packages/theo/src/server/http/handle-request-error.ts` | 204 | `84892ce` (2026-06-06) | Error-to-HTTP-response translation + AuthRequired detection | `handleRequestError()` export |
| `packages/theo/src/server/http/execute.ts` | 343 | `29b4bcd` (2026-05-31) | Route execution with plugin lifecycle | `executeRoute()` export signature |
| `packages/theo/src/cli/commands/start/request-handler.ts` | 159 | `54a5a3d` (2026-06-06) | Dev server request handler (SSR + static + API routing, CC=33) | `createRequestHandler()` export |
| `packages/theo/src/core/contracts/index.ts` | 65 | varies | Barrel for shared client↔server types | Existing exports unchanged |
| `packages/theo/src/core/contracts/envelope-code-to-status.ts` (NEW) | 0 | — | Shared error-code-to-HTTP-status mapping | — |
| `packages/theo/src/core/contracts/auth-error-guard.ts` (NEW) | 0 | — | Shared `isAuthRequiredError()` guard | — |
| `tests/unit/envelope-code-to-status.test.ts` (NEW) | 0 | — | Tests for extracted mapping | — |
| `tests/unit/auth-error-guard.test.ts` (NEW) | 0 | — | Tests for auth error guard | — |

### Current callers / dependents

- **Symbol:** `generateResource()` in `packages/theo/src/cli/commands/generate-resource.ts`
  - **Callers (production):** `packages/theo/src/cli/commands/generate.ts:4,316` (via import + call)
  - **Callers (tests):** none

- **Symbol:** `GenerateResult` type in `packages/theo/src/cli/commands/generate.ts`
  - **Callers (production):** `generate-resource.ts:4` (`import type { GenerateResult } from './generate.js'`) — THIS CREATES THE BACK-EDGE
  - **Callers (tests):** none

- **Symbol:** `envelopeCodeToStatus()` in `packages/theo/src/server/web-handler.ts:262` (private)
  - **Callers:** same file only (L255)
  - **Duplicate:** `envelopeCodeToHttpStatus()` in `handle-request-error.ts:175` (private, identical 13-arm switch table)

- **Symbol:** `AuthRequiredError` duck-type check pattern
  - **Locations:** `handle-request-error.ts:58-60`, `handle-request-error.ts:133`, `execute.ts:312-314`
  - **Pattern:** `err instanceof AuthRequiredError || (err?.code === 'AUTH_REQUIRED' && err?.status === 401)`

- **Symbol:** `createRequestHandler()` in `request-handler.ts`
  - **Callers (production):** `packages/theo/src/cli/commands/start/start.ts`
  - **Callers (tests):** `tests/unit/request-handler*.test.ts`

### Domain glossary

- **ADP** — Acyclic Dependencies Principle (Robert Martin). Zero cycles, ever. Consensus threshold.
- **CC** — Cyclomatic complexity (McCabe 1976). Consensus threshold: ≤10 per function.
- **core/contracts/** — canonical home for shared types. Exception to no-deep-import rule per `architecture.md` v3 INVARIANT 3.
- **duck-type fallback** — `instanceof` check + shape check, required because Vite HMR can duplicate class identity.
- **module-level cycle** — cycle detected by grouping files into abstract modules. May not correspond to a real file-level import cycle.

### Architecture boundaries affected

Per `architecture.md` v3:
- **INVARIANT 1:** `core` depends on nothing intra-monorepo → adding exports to `core/contracts/` is SAFE
- **INVARIANT 2:** Zero cycles → 1 real cycle found (`generate-resource ↔ generate`), must fix
- **INVARIANT 3:** Public API through barrels → new `core/contracts/` files follow this pattern

## Prior Art & Related Work

- **Architecture review:** `architecture-output/final_report.md` — 22 principle violations, 6 module-level cycles (1 confirmed real)
- **Edge case review:** `knowledge-base/reviews/architecture-remediation-edge-cases-2026-06-12.md` — EC-1 (cycles re-scoped), EC-2 (agents importers), EC-3-5 (test suggestions)
- **Existing `core/contracts/`:** 9 files, zero runtime deps — proven pattern for shared types
- **Inline DRY acknowledgment:** `handle-request-error.ts:170` comment: "Mirror of the inline table… the two tables MUST stay in sync — Phase G slice 4/N may consolidate"

## Objective

- [ ] 1 real dependency cycle fixed (verified by `dependency-cruiser`)
- [ ] `envelopeCodeToStatus` consolidated into single source in `core/contracts/`
- [ ] `isAuthRequiredError()` extracted to shared guard function
- [ ] CC ≤ 10 in `createRequestHandler` (verified by `lizard`)
- [ ] All existing tests green after refactoring

## ADRs

### D1 — Extract `GenerateResult` type to break generate cycle

**Decision:** Move the `GenerateResult` type from `generate.ts` to a shared types file (`generate-types.ts` or inline in `generate-resource.ts`), eliminating the circular import.

**Rationale:** `generate-resource.ts` imports `GenerateResult` type from `generate.ts`, while `generate.ts` imports `generateResource()` from `generate-resource.ts`. This is the only real file-level cycle in the codebase. Since `GenerateResult` is a simple type (not runtime code), it can be moved to a shared location without behavioral change.

**Alternatives considered:**
- Inline the type in `generate-resource.ts` → Acceptable for a simple type but creates duplication if other files also use it (currently none do).
- Create `generate-types.ts` → YAGNI if only 2 files use it. But cleaner for future extensibility.
- Use `import type` (already the case — `import type { GenerateResult }`) → `import type` still creates a dependency-cruiser edge. TypeScript elides it at runtime, but the static analysis tool still flags it.

**Consequences:** 1 type definition moves. 0 runtime behavior change.

### D2 — Extract shared code to `core/contracts/` for DRY

**Decision:** Move `envelopeCodeToStatus` and `isAuthRequiredError` into `core/contracts/`.

**Rationale:** `core/contracts/` already exists as the canonical zero-dep shared-types home per `architecture.md` v3 INVARIANT 3 exception. The DRY violations are explicitly acknowledged in code comments.

**Alternatives considered:**
- Keep the duplication → Rejected: comment at `handle-request-error.ts:170` already acknowledges this as tech debt.
- Create a new shared module → Rejected: YAGNI, `core/contracts/` already serves this purpose.

**Consequences:** 2 new files in `core/contracts/` (~30 LOC each). Both consumers update 1 import each.

### D3 — Extract sub-functions for CC reduction in request-handler.ts

**Decision:** Extract SSR streaming, SSR sync, and error-handling branches from `createRequestHandler` into named sub-functions in the same file.

**Rationale:** CC=33 is 3.3x the McCabe consensus threshold (≤10). The function has 3 clearly separable branches (SSR streaming L82, SSR sync L114, error fallback L147).

**Alternatives considered:**
- Strategy pattern → Rejected: YAGNI, only 2 rendering modes.
- Separate files → Rejected: functions share closure over `ctx`.

**Consequences:** Same file, same exports, CC per function ≤10.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Moving `GenerateResult` type may affect TheoKit Studio if it imports from `generate.ts` | Low | Studio imports `generate()` function, not the type. Verify with grep. | dev |
| `isAuthRequiredError` shape-only guard drops `instanceof` fast path | Low | EC-3: the `instanceof` already fails under Vite HMR. Shape check is the reliable path. Test with real instance. | dev |
| `envelopeCodeToStatus` may drift from `TheoErrorCode` enum in future | Low | EC-4: add sync test that verifies all enum values have mappings | dev |

## Unresolved Questions

(none — every decision is resolved at plan time)

## Dependency Graph

```
Phase 1 (DRY extractions + cycle fix) ──▶ Phase 2 (CC reduction) ──▶ Phase 3 (Integration)
```

All phases are sequential. Phase 1 has no cross-task dependencies (T1.1, T1.2, T1.3 can run in parallel).

---

## Phase 1: Fix Cycle + Extract DRY Violations

**Objective:** Fix the 1 real dependency cycle, consolidate duplicated `envelopeCodeToStatus`, and extract `isAuthRequiredError` guard.

### T1.1 — Fix `generate-resource.ts ↔ generate.ts` cycle

#### Objective
Break the only real file-level cycle in the codebase.

#### Why this step

**What:** Move `GenerateResult` type out of `generate.ts` so that `generate-resource.ts` no longer imports from `generate.ts`, breaking the circular dependency.

**Why now:** This is the only cycle that `dependency-cruiser --validate` flags as an error. It was introduced in commit `a00269c` (2026-06-12) when `generate-resource.ts` was added. Per `architecture.md` INVARIANT 2, zero cycles ever.

#### Evidence
- `dependency-cruiser` error: `generate-resource.ts → generate.ts → generate-resource.ts`
- `generate-resource.ts:4` — `import type { GenerateResult } from './generate.js'`
- `generate.ts:4` — `import { generateResource } from './generate-resource.js'`

#### Files to edit
```
packages/theo/src/cli/commands/generate-resource.ts — define GenerateResult inline or import from new location
packages/theo/src/cli/commands/generate.ts — export GenerateResult from a shared location if needed
```

#### Deep file dependency analysis
- `generate.ts` (367 LOC): exports `generate()`, `VALID_TYPES`, `GenerateResult` type. `generate-resource.ts` calls `generateResource()` at L316.
- `generate-resource.ts` (233 LOC): exports `generateResource()`, imports `GenerateResult` type from `generate.ts` at L4.
- The cycle is type-only (`import type`), so it doesn't cause runtime issues, but `dependency-cruiser` correctly flags it as an architectural violation.

#### Deep Dives
- `GenerateResult` is a simple interface: `{ files: string[] }` or similar return type from generate commands.
- Simplest fix: define `GenerateResult` directly in `generate-resource.ts` (inline the type). Since it's only used by these 2 files and is ~3 lines, inlining avoids creating a third file.
- Alternative: move to `generate-types.ts` — but YAGNI (only 2 consumers).

#### Pseudo-code / Signatures

```typescript
// generate-resource.ts — inline the type instead of importing
// BEFORE: import type { GenerateResult } from './generate.js'
// AFTER:
export interface GenerateResult {
  files: string[]
}
```

#### Tasks
1. Read `GenerateResult` definition from `generate.ts` to understand its exact shape
2. Copy the type definition into `generate-resource.ts`
3. Remove `import type { GenerateResult } from './generate.js'` from `generate-resource.ts`
4. If `generate.ts` still needs to export `GenerateResult`, keep it there too (re-export from resource or duplicate — type-only, acceptable)
5. Run `npx dependency-cruiser --output-type err packages/theo/src/cli/` to verify 0 cycles

#### TDD
```
RED:     test_generate_resource_has_no_circular_dependency() — run depcruise, assert 0 errors
GREEN:   Inline the type, remove the back-import
REFACTOR: None expected
VERIFY:  bun test && npx dependency-cruiser --output-type err packages/theo/src/ packages/agents/src/
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] `generate-resource.ts` no longer imports from `generate.ts`
- [ ] `npx dependency-cruiser --output-type err` reports 0 errors
- [ ] `npx madge --circular` reports 0 circular dependencies
- [ ] All existing generate tests pass
- [ ] Pass: lint — `bun run lint` zero warnings
- [ ] Pass: size — every changed file ≤ 500 lines

#### DoD
- [ ] All tests passing — `bun test` green
- [ ] Zero type errors — `bun run typecheck`
- [ ] Zero cycles — `dependency-cruiser` clean

---

### T1.2 — Extract `envelopeCodeToStatus` to `core/contracts/envelope-code-to-status.ts`

#### Objective
Consolidate the duplicated error-code-to-HTTP-status mapping table into a single source of truth.

#### Why this step

**What:** Create `core/contracts/envelope-code-to-status.ts` with the canonical switch table, export it from the contracts barrel, and replace both inline copies.

**Why now:** The DRY violation is explicitly acknowledged in `handle-request-error.ts:170` ("Mirror of the inline table… the two tables MUST stay in sync"). Per D2, `core/contracts/` is the natural home.

#### Evidence
- `web-handler.ts:262-285` — `envelopeCodeToStatus()` (13 switch arms)
- `handle-request-error.ts:170-200` — `envelopeCodeToHttpStatus()` (identical 13 arms, comment confirms intentional duplication)
- Both files are in the server module; the extract goes to `core/contracts/` (INVARIANT 1 safe)

#### Files to edit
```
packages/theo/src/core/contracts/envelope-code-to-status.ts — (NEW) shared mapping function
packages/theo/src/core/contracts/index.ts — add export
packages/theo/src/server/web-handler.ts — remove inline function, import from contracts
packages/theo/src/server/http/handle-request-error.ts — remove inline function, import from contracts
tests/unit/envelope-code-to-status.test.ts — (NEW) unit tests
```

#### Deep file dependency analysis
- `envelope-code-to-status.ts` (NEW): pure function, no deps. Maps error code string → HTTP status number.
- `core/contracts/index.ts`: adds 1 export line. No callers break — additive change.
- `web-handler.ts`: L262-285 deleted, replaced by import. `executeWebRequest()` signature unchanged.
- `handle-request-error.ts`: L170-200 deleted, replaced by import. `handleRequestError()` signature unchanged.

#### Deep Dives
- The switch table maps 13 error codes to HTTP statuses (400-504 range + default 500).
- Invariant: unknown error codes → return 500 (existing behavior, preserved).
- EC-4 (SHOULD TEST): add a sync test verifying all `TheoErrorCode` enum values have mappings.

#### Pseudo-code / Signatures

```typescript
// core/contracts/envelope-code-to-status.ts
export function envelopeCodeToStatus(code: string): number {
  switch (code) {
    case 'BAD_REQUEST': return 400
    case 'UNAUTHORIZED': return 401
    case 'FORBIDDEN': return 403
    case 'NOT_FOUND': return 404
    case 'METHOD_NOT_ALLOWED': return 405
    case 'PAYLOAD_TOO_LARGE': return 413
    case 'UNPROCESSABLE_ENTITY': return 422
    case 'TOO_MANY_REQUESTS': case 'RATE_LIMITED': return 429
    case 'BAD_GATEWAY': return 502
    case 'SERVICE_UNAVAILABLE': return 503
    case 'GATEWAY_TIMEOUT': return 504
    case 'INTERNAL_SERVER_ERROR': default: return 500
  }
}
```

#### Tasks
1. Create `packages/theo/src/core/contracts/envelope-code-to-status.ts` with the switch table from `web-handler.ts:262-285`
2. Add export to `packages/theo/src/core/contracts/index.ts`
3. Replace inline function in `web-handler.ts` with import from `core/contracts/`
4. Replace inline function in `handle-request-error.ts` with import from `core/contracts/`
5. Write unit tests covering all 13 codes + unknown code default + TheoErrorCode enum sync (EC-4)

#### TDD
```
RED:     test_envelopeCodeToStatus_maps_BAD_REQUEST_to_400() — asserts envelopeCodeToStatus('BAD_REQUEST') === 400
RED:     test_envelopeCodeToStatus_maps_all_13_codes() — parametric test for all known codes
RED:     test_envelopeCodeToStatus_unknown_code_returns_500() — asserts default fallback
RED:     test_envelopeCodeToStatus_covers_all_TheoErrorCode_values() — import enum, verify coverage (EC-4)
GREEN:   Copy switch table from web-handler.ts into new file
REFACTOR: None expected
VERIFY:  bun test tests/unit/envelope-code-to-status.test.ts
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] `envelopeCodeToStatus` exists in `core/contracts/` and is exported from barrel
- [ ] `web-handler.ts` no longer contains inline `envelopeCodeToStatus` function
- [ ] `handle-request-error.ts` no longer contains inline `envelopeCodeToHttpStatus` function
- [ ] Both consumers import from `core/contracts/`
- [ ] 13 codes + unknown default + TheoErrorCode sync tested
- [ ] Pass: lint — zero warnings on changed files
- [ ] Pass: size — every changed file ≤ 500 lines

#### DoD
- [ ] All tests passing — `bun test` green
- [ ] Zero type errors — `bun run typecheck`
- [ ] Zero lint warnings — `bun run lint`

---

### T1.3 — Extract `isAuthRequiredError()` to `core/contracts/auth-error-guard.ts`

#### Objective
Consolidate the triplicated `AuthRequiredError` duck-type detection into a single shared guard function.

#### Why this step

**What:** Create `core/contracts/auth-error-guard.ts` with `isAuthRequiredError(err: unknown): boolean` encapsulating the shape-based detection pattern.

**Why now:** The duck-type pattern appears in 3 locations (`handle-request-error.ts:58`, `handle-request-error.ts:133`, `execute.ts:312`). Per D2, `core/contracts/` is the natural home. The guard uses shape-based check only — NO `AuthRequiredError` class import (would violate `core` INVARIANT 1).

#### Evidence
- `handle-request-error.ts:3` — `import { AuthRequiredError } from '../auth/auth.js'`
- `handle-request-error.ts:58-60` — `err instanceof AuthRequiredError || (err?.code === 'AUTH_REQUIRED' && err?.status === 401)`
- `handle-request-error.ts:133` — same pattern repeated
- `execute.ts:3,312-314` — same pattern
- Code comments explain why duck-typing is needed (Vite HMR duplicates class identity)

#### Files to edit
```
packages/theo/src/core/contracts/auth-error-guard.ts — (NEW) shared guard function
packages/theo/src/core/contracts/index.ts — add export
packages/theo/src/server/http/handle-request-error.ts — remove AuthRequiredError import, use guard
packages/theo/src/server/http/execute.ts — use guard instead of inline check
tests/unit/auth-error-guard.test.ts — (NEW) unit tests
```

#### Deep file dependency analysis
- `auth-error-guard.ts` (NEW): NO imports from `server/auth/`. Pure shape-based check. INVARIANT 1 preserved.
- `handle-request-error.ts`: removes `import { AuthRequiredError } from '../auth/auth.js'` from L3. The `instanceof` check is dropped in favor of the shape-only guard (EC-3: `instanceof` already fails under Vite HMR, making it unreliable).
- `execute.ts`: removes `import { AuthRequiredError } from '../auth/auth.js'` from L3. Replaces inline check with guard call.

#### Deep Dives
- The guard MUST NOT import `AuthRequiredError` class (would violate `core` INVARIANT 1).
- Shape-based check: `err?.code === 'AUTH_REQUIRED' && err?.status === 401` is the reliable path.
- EC-3 (SHOULD TEST): test with a real `AuthRequiredError` instance to confirm the shape check catches it.

#### Pseudo-code / Signatures

```typescript
// core/contracts/auth-error-guard.ts
export function isAuthRequiredError(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false
  const e = err as Record<string, unknown>
  return e.code === 'AUTH_REQUIRED' && e.status === 401
}
```

#### Tasks
1. Create `packages/theo/src/core/contracts/auth-error-guard.ts` with shape-based guard
2. Add export to `packages/theo/src/core/contracts/index.ts`
3. Update `handle-request-error.ts` — remove `AuthRequiredError` import, use `isAuthRequiredError()` at L58 and L133
4. Update `execute.ts` — remove `AuthRequiredError` import, use `isAuthRequiredError()` at L312
5. Write unit tests (including EC-3: test with object matching AuthRequiredError shape)

#### TDD
```
RED:     test_isAuthRequiredError_detects_matching_shape() — {code:'AUTH_REQUIRED', status:401} → true
RED:     test_isAuthRequiredError_rejects_non_auth_error() — {code:'NOT_FOUND', status:404} → false
RED:     test_isAuthRequiredError_handles_null_undefined() — null, undefined, non-object → false
RED:     test_isAuthRequiredError_handles_partial_match() — {code:'AUTH_REQUIRED', status:403} → false
RED:     test_isAuthRequiredError_detects_error_with_extra_fields() — {code:'AUTH_REQUIRED', status:401, message:'...'} → true (EC-3)
GREEN:   Implement shape-based guard
REFACTOR: None expected
VERIFY:  bun test tests/unit/auth-error-guard.test.ts
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] `isAuthRequiredError` exists in `core/contracts/` and is exported
- [ ] `handle-request-error.ts` no longer imports `AuthRequiredError` from `../auth/auth.js`
- [ ] `execute.ts` no longer imports `AuthRequiredError` from `../auth/auth.js`
- [ ] All 3 duck-type check locations use the shared guard
- [ ] Guard uses shape-based check only (no class import from auth)
- [ ] Pass: lint — zero warnings
- [ ] Pass: size — every changed file ≤ 500 lines

#### DoD
- [ ] All tests passing — `bun test` green
- [ ] Zero type errors — `bun run typecheck`
- [ ] Zero lint warnings — `bun run lint`

---

## Phase 2: Reduce Cyclomatic Complexity

**Objective:** Reduce CC=33 in `request-handler.ts` to ≤10 per function.

### T2.1 — Reduce CC in `request-handler.ts` (CC=33 → ≤10)

#### Objective
Extract SSR streaming, SSR sync, and error-handling branches into named sub-functions.

#### Why this step

**What:** Extract 3 private functions from `createRequestHandler`: `handleSsrStreaming()`, `handleSsrSync()`, `handleFallbackError()`.

**Why now:** CC=33 is 3.3x the McCabe consensus threshold. Per D3, extract-function is the minimal refactor. The function has 3 clearly separable branches (SSR streaming path at L82, SSR sync path at L114, error fallback at L147).

#### Evidence
- `request-handler.ts:82` — `if (ctx.ssrStreamingEnabled && ctx.ssrRenderStreaming)` (streaming branch)
- `request-handler.ts:114` — `if (ctx.ssrRender)` (sync SSR branch)
- `request-handler.ts:147` — error handling branch

#### Files to edit
```
packages/theo/src/cli/commands/start/request-handler.ts — extract 3 functions
```

#### Deep file dependency analysis
- `request-handler.ts` (159 LOC): exports `createRequestHandler()`. Called by `start.ts`. The extracted sub-functions are private (not exported), so no downstream impact.

#### Tasks
1. Extract `handleSsrStreaming(ctx, req, res)` from L82-112
2. Extract `handleSsrSync(ctx, req, res)` from L114-145
3. Extract `handleFallbackError(ctx, req, res, err)` from L147-158
4. Verify CC per function ≤ 10 with `lizard`

#### TDD
```
RED:     (existing tests must continue to pass — no new behavior)
GREEN:   Extract functions
REFACTOR: Rename for clarity if needed
VERIFY:  bun test && lizard packages/theo/src/cli/commands/start/request-handler.ts -T cyclomatic_complexity=10
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] `createRequestHandler` CC ≤ 10
- [ ] Each extracted function CC ≤ 10
- [ ] All existing tests pass without changes
- [ ] Pass: lint — zero warnings
- [ ] Pass: size — file ≤ 500 lines (currently 159)

#### DoD
- [ ] All tests passing — `bun test` green
- [ ] Zero type errors — `bun run typecheck`
- [ ] `lizard` reports 0 violations on this file

---

## Phase 3: Integration Validation

**Objective:** Verify the full codebase is cycle-free, all tests pass, and complexity thresholds hold.

### T3.1 — Full validation + CHANGELOG

#### Objective
Run end-to-end verification confirming 0 cycles and all quality gates green.

#### Why this step

**What:** Run `dependency-cruiser`, `madge`, `bun test`, `bun run typecheck`, `bun run lint`, and `lizard` on all touched files.

**Why now:** Integration validation gate per plan template.

#### Files to edit
```
CHANGELOG.md — update [Unreleased] § Fixed
```

#### Tasks
1. Run `npx dependency-cruiser --output-type err packages/theo/src/ packages/agents/src/` — assert 0 errors
2. Run `npx madge --circular --extensions ts,tsx packages/theo/src/ packages/agents/src/` — assert 0 cycles
3. Run `bun test` — all green
4. Run `bun run typecheck` — zero errors
5. Run `bun run lint` — zero warnings
6. Run `lizard packages/theo/src/cli/commands/start/request-handler.ts -T cyclomatic_complexity=10` — 0 violations
7. Update CHANGELOG.md under `[Unreleased] § Fixed`

#### Acceptance Criteria
- [ ] `dependency-cruiser` reports 0 errors
- [ ] `madge --circular` reports 0 cycles
- [ ] `bun test` all green
- [ ] `bun run typecheck` zero errors
- [ ] `bun run lint` zero warnings
- [ ] `lizard` 0 violations on touched files
- [ ] CHANGELOG.md updated

#### DoD
- [ ] All validation commands pass
- [ ] CHANGELOG.md has entries for cycle fix + DRY extractions + CC reduction

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Real cycle: `generate-resource.ts ↔ generate.ts` | T1.1 | Inline `GenerateResult` type, remove back-import |
| 2 | DRY: `envelopeCodeToStatus` duplicated (H3) | T1.2 | Extract to `core/contracts/` |
| 3 | DRY: `AuthRequiredError` duck-type x3 (M6) | T1.3 | Extract to `core/contracts/auth-error-guard.ts` |
| 4 | CC=33 in `request-handler.ts` (H1) | T2.1 | Extract 3 sub-functions |
| 5 | 5 module-level cycles (C1-C6 minus real) | N/A | **Not real file-level cycles** — confirmed by `dependency-cruiser` and `madge`. Documented in edge case review. No action needed. |
| 6 | CC=25 in `execute.ts:buildPluginCtx` (H2) | deferred | Separate plan — complexity is in plugin lifecycle |
| 7 | God file `web-handler.ts` 601 LOC (H4) | T1.2 (partial) | DRY extraction reduces ~30 LOC; full decomposition deferred |

**Coverage: 4/4 confirmed real gaps fully resolved. 2 deferred with explicit justification. 1 gap re-classified as non-issue.**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `bun test` green
- [ ] Zero type errors — `bun run typecheck`
- [ ] Zero lint warnings — `bun run lint`
- [ ] File-size budget respected (≤ 500 LOC per `architecture.md`)
- [ ] CHANGELOG.md updated under `[Unreleased] § Fixed`
- [ ] 0 dependency cycles — `npx dependency-cruiser --validate` green
- [ ] CC ≤ 10 on all touched functions — `lizard` verification
- [ ] Plan archived after merge

## Failure scenarios

```
(none — no external I/O touched)
```

## Final Phase: Integration Validation (MANDATORY)

### Execution

```bash
bun test                                          # unit + integration tests
bun run typecheck                                 # zero type errors
bun run lint                                      # zero lint warnings
npx dependency-cruiser --output-type err packages/theo/src/ packages/agents/src/  # zero cycles
npx madge --circular --extensions ts,tsx packages/theo/src/ packages/agents/src/   # zero cycles (cross-check)
lizard packages/theo/src/cli/commands/start/request-handler.ts -T cyclomatic_complexity=10 -w  # CC check
```

### Acceptance Criteria

- [ ] All test suites green
- [ ] Zero type errors
- [ ] Zero lint warnings
- [ ] Zero dependency cycles (both tools)
- [ ] CC ≤ 10 on all touched functions

### If Validation Fails

1. Identify which failures are caused by this plan's changes vs pre-existing
2. Fix all plan-caused failures before declaring complete
3. Re-run the validation chain
4. Pre-existing issues logged but do NOT block (documented in PR description)
