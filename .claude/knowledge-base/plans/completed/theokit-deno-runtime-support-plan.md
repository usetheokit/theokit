---
slug: theokit-deno-runtime-support
created_at: 2026-06-10
goal: Ship a Deno runtime adapter and validate the full test suite on Deno 2.x, measured by deno test returning 100+ GREEN tests plus a 3-runtime benchmark (Node vs Bun vs Deno) with req/s numbers.
---

# Plan: TheoKit Deno Runtime Support

> **Version 1.1** (2026-06-10) — Absorbed EC-1 (shutdown promise chaining in close()). Plus 2 SHOULD TEST (EC-2 port 0 auto-assign, EC-3 reflect-metadata resolution). 1 DOCUMENT (EC-4 Deno permissions).
>
> **Version 1.0** — Add native Deno 2.x runtime support via `runtime/deno.ts` adapter using `Deno.serve()`. The pipeline already operates on Web Standard Request/Response (shipped in runtime-optimization plan). Zero changes to pipeline core — adapter only.

## Goal

> Ship a Deno runtime adapter at `runtime/deno.ts` using `Deno.serve()` and validate the full http-decorators + agents test suite on Deno 2.x, measured by `deno test` returning 100+ GREEN tests plus a 3-runtime benchmark with real req/s numbers for Node, Bun, and Deno.

## Context

The runtime-optimization plan shipped Web Standard Request/Response throughout the pipeline. Node adapter (`runtime/node.ts`) converts IncomingMessage↔Request at the boundary. Bun adapter (`runtime/bun.ts`) is zero-conversion passthrough. Deno.serve() uses the same `(request: Request) => Response` handler signature as Bun — the adapter is equally trivial.

Deno 2.x supports `node:*` compat layer and npm packages via `npm:` specifier, so `reflect-metadata` and the SWC loader should work without changes.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Why it exists | Invariants to preserve |
|---|---|---|---|
| `packages/http-decorators/src/bridge/runtime/types.ts` | 17 | RuntimeAdapter + ServerHandle interfaces | Interface contract |
| `packages/http-decorators/src/bridge/runtime/bun.ts` | 64 | Bun adapter (pattern to mirror) | — |
| `packages/http-decorators/src/bridge/runtime/deno.ts` (NEW) | 0 | Deno adapter | — |
| `packages/http-decorators/tests/benchmark/node-vs-bun.ts` | 51 | 2-runtime benchmark | Extend to 3 runtimes |
| `packages/http-decorators/tests/benchmark/node-vs-bun-vs-deno.ts` (NEW) | 0 | 3-runtime benchmark | — |

### Current callers / dependents

- **`RuntimeAdapter`** — consumed by `create-server.ts` (uses Node adapter), `app.ts` (uses Node adapter). Deno adapter is opt-in — no existing callers need to change.
- **`ServerHandle`** — consumed by TheoApp. Deno adapter returns the same shape.

### Domain glossary

- **Deno.serve()** — Deno 2.x built-in HTTP server. Accepts `(request: Request) => Response | Promise<Response>`. Same signature as Bun.serve().
- **npm: specifier** — Deno's way to import npm packages: `import 'npm:reflect-metadata'`.
- **Node compat layer** — Deno supports `node:fs`, `node:path`, etc. for backward compatibility.

### Architecture boundaries affected

- **Runtime adapter layer only** — new file at `runtime/deno.ts`. No pipeline changes. Per `architecture.md` Prohibitions: "Node.js APIs only in adapter layer."

## Prior Art & Related Work

- **Internal:** `runtime/bun.ts` — same pattern (zero-conversion passthrough). Deno adapter mirrors this exactly.
- **Internal:** `runtime/node.ts` — conversion adapter. Deno does NOT need this (Web Standard native).
- **External:** Deno.serve() documentation — `Deno.serve({ port }, handler)` pattern.
- **External:** Hono framework — ships Deno adapter at `hono/deno`. Validates the pattern.

## Objective

- [ ] `runtime/deno.ts` adapter using `Deno.serve()` — zero conversion
- [ ] Install Deno 2.x, run http-decorators unit tests via `deno test`
- [ ] Run agents unit tests via `deno test`
- [ ] Fix any Deno-specific incompatibilities (if any)
- [ ] 3-runtime benchmark: Node vs Bun vs Deno with real req/s numbers

## ADRs

### D470 — Deno adapter mirrors Bun pattern (zero conversion)

**Decision:** `createDenoAdapter()` returns a `RuntimeAdapter` that passes the handler directly to `Deno.serve()`. No Request/Response conversion.

**Rationale:** Deno.serve() accepts `(request: Request) => Response | Promise<Response>` — identical to our pipeline handler signature. Per DRY, the adapter is a thin shell (like Bun). Per `architecture.md` Prohibitions: "Node.js APIs only in adapter layer" — Deno adapter uses zero Node APIs.

**Alternatives considered:**
- (a) Use Deno's node:http compat layer — rejected: adds conversion overhead that the Web Standard pipeline was designed to avoid.

**Consequences:** Deno users get native performance. Adapter is ~30 LoC.

### D471 — Deno test runner instead of vitest for Deno validation

**Decision:** Use `deno test` (Deno's built-in test runner) for the Deno validation pass. The existing vitest tests can run on Deno via `deno run` with `--allow-net --allow-read` flags.

**Rationale:** Deno has its own test runner that understands Deno's security model (permissions). Running vitest under Deno works but is slower and less idiomatic. For validation, we use `bun test` pattern — run existing test files directly.

**Alternatives considered:**
- (a) Run vitest under Deno — works but adds complexity. Rejected for simplicity.

**Consequences:** Some tests may need minor adjustments for Deno's stricter module resolution.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| reflect-metadata npm compat — Deno needs `npm:` specifier or import map | Medium | Deno 2.x supports bare `node_modules/` resolution when `nodeModulesDir: true` in deno.json. Test both paths. | Implementer |
| SWC loader uses node:fs/path — may behave differently on Deno | Low | Deno's node compat layer supports node:fs and node:path. The SWC loader is only used for parameter decorator compilation, not in the hot path. | Implementer |
| Deno test runner may not support vitest APIs (describe/it/expect) | Medium | Use `deno test` with Deno's built-in `assertEquals` OR run via `bun test` pattern using Deno's vitest compat. | Implementer |
| EC-4: Deno permissions model requires `--allow-net --allow-read` | Low | Not a bug — Deno's security model by design. Document in README: "Run with `deno test --allow-net --allow-read`." | Implementer |

## Unresolved Questions

- UQ1 — Should we ship a `deno.json` config file in the package, or leave Deno config to the consumer?

## Dependency Graph

```
Phase 1 (Install Deno + adapter)
  ↓
Phase 2 (Test validation + fixes)
  ↓
Phase 3 (3-runtime benchmark + integration validation)
```

All sequential.

---

## Phase 1: Deno Adapter

**Objective:** Create `runtime/deno.ts` and install Deno.

### T1.1 — Install Deno + create adapter

#### Objective
Install Deno 2.x and create the `createDenoAdapter()` function.

#### Why this step
**Action:** Mirror the Bun adapter pattern for Deno.serve().
**Reasoning:** Per D470, Deno.serve() accepts the same handler signature. The adapter is a thin passthrough. Per `architecture.md`, Node APIs only in adapter layer.

#### Evidence
- `packages/http-decorators/src/bridge/runtime/bun.ts:21-51` — pattern to mirror

#### Files to edit
```
packages/http-decorators/src/bridge/runtime/deno.ts (NEW) — Deno adapter
packages/http-decorators/tests/unit/runtime-deno.test.ts (NEW) — adapter tests
```

#### Deep file dependency analysis
- New file only. No existing files modified.
- Implements `RuntimeAdapter` interface from `types.ts`.

#### Deep Dives

```typescript
export function createDenoAdapter(): RuntimeAdapter {
  if (typeof globalThis.Deno === 'undefined') {
    throw new Error('createDenoAdapter() requires Deno runtime.')
  }
  return {
    createServer(handler) {
      let server: Deno.HttpServer | null = null
      return {
        listen(port, callback?) {
          server = Deno.serve({ port }, handler)
          if (callback) callback()
        },
        close(callback?) {
          // EC-1: shutdown() returns Promise — chain callback after it resolves
          server?.shutdown().then(() => callback?.())
        },
        address() {
          return server ? { port: server.addr.port } : null
        },
      }
    },
  }
}
```

#### Tasks
1. Install Deno 2.x via `curl -fsSL https://deno.land/install.sh | sh`
2. Create `runtime/deno.ts` mirroring Bun adapter pattern
3. Add global type augmentation for `Deno.serve` + `Deno.HttpServer`
4. Write unit test (env-gated: `typeof Deno !== 'undefined'`)

#### TDD
```
RED:     test_deno_adapter_creates_server_handle() — returns ServerHandle with listen/close/address
RED:     test_deno_adapter_requires_deno_runtime() — throws on Node/Bun
RED:     test_deno_adapter_port_zero_auto_assigns() — EC-2: port 0 → handle.address()?.port > 0
RED:     test_deno_adapter_close_awaits_shutdown() — EC-1: close(cb) fires callback AFTER shutdown completes
GREEN:   Implement adapter with promise-chained close()
REFACTOR: None expected
VERIFY:  deno test tests/unit/runtime-deno.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `deno --version` returns 2.x
- [ ] `runtime/deno.ts` compiles without error
- [ ] `createDenoAdapter()` throws on Node/Bun (env guard)
- [ ] Pass: size — `deno.ts` ≤ 60 LoC (mirrors bun.ts)

#### DoD
- [ ] Deno installed
- [ ] Adapter file created and compiles

---

## Phase 2: Test Validation on Deno

**Objective:** Run the full test suite on Deno and fix incompatibilities.

### T2.1 — Run http-decorators tests on Deno

#### Objective
Execute http-decorators unit + integration tests using Deno runtime.

#### Why this step
**Action:** Validate that the Web Standard pipeline actually works on Deno, not just compiles.
**Reasoning:** Per D471, we use `deno test` or `deno run` to execute existing test files.

#### Files to edit
```
packages/http-decorators/tests/unit/ — potential fixes for Deno compat
```

#### TDD
```
RED:     deno test tests/unit/ — identify failures
RED:     test_reflect_metadata_works_on_deno() — EC-3: Reflect.defineMetadata available after import
GREEN:   Fix Deno-specific issues (import resolution, permissions)
REFACTOR: None expected
VERIFY:  deno test returning 100+ GREEN
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `deno test` or `bun test` (as Deno proxy) returns 100+ GREEN tests
- [ ] Any Deno-specific fixes documented

#### DoD
- [ ] Tests passing on Deno

### T2.2 — Run agents tests on Deno

#### Objective
Execute agents test suite on Deno runtime.

#### Files to edit
```
packages/agents/tests/unit/ — potential fixes
```

#### TDD
```
RED:     deno test packages/agents/tests/ — identify failures
GREEN:   Fix Deno-specific issues
VERIFY:  100+ GREEN
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] Agents tests pass on Deno

#### DoD
- [ ] Tests passing

---

## Phase 3: 3-Runtime Benchmark + Validation

**Objective:** Benchmark Node vs Bun vs Deno on the same HTTP throughput test.

### T3.1 — 3-runtime benchmark

#### Objective
Extend the existing benchmark to include Deno, producing a comparison table.

#### Files to edit
```
packages/http-decorators/tests/benchmark/node-vs-bun-vs-deno.ts (NEW) — 3-runtime benchmark
```

#### TDD
```
RED:     Run benchmark on all 3 runtimes — capture req/s
GREEN:   Produce comparison table
VERIFY:  All 3 runtimes complete without error
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] Benchmark runs on Node, Bun, AND Deno
- [ ] Results include: runtime name, version, req/s, ms/req avg
- [ ] No runtime crashes during benchmark

#### DoD
- [ ] Benchmark results documented

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Deno runtime adapter | T1.1 | `runtime/deno.ts` with `Deno.serve()` |
| 2 | Test validation on Deno | T2.1 + T2.2 | Full test suite on Deno |
| 3 | 3-runtime benchmark | T3.1 | Node vs Bun vs Deno req/s |

**Coverage: 3/3 gaps covered (100%)**

## Global Definition of Done

- [ ] Deno 2.x installed and verified
- [ ] `runtime/deno.ts` adapter created and compiles
- [ ] http-decorators tests pass on Deno (100+)
- [ ] agents tests pass on Deno (100+)
- [ ] 3-runtime benchmark with real numbers
- [ ] CHANGELOG.md updated under `[Unreleased]`
- [ ] File-size budget: `deno.ts` ≤ 60 LoC
- [ ] Node + Bun tests still GREEN (zero regression)

## Failure scenarios

(none — no external I/O touched. Adapter is in-process.)

## Final Phase: Integration Validation (MANDATORY)

### Execution

```bash
pnpm --filter @theokit/http-decorators test   # Node: 201 tests
bun test tests/unit/ tests/integration/        # Bun: 183 tests
deno test tests/                                # Deno: 100+ tests
node --import tsx tests/benchmark/node-vs-bun-vs-deno.ts  # Node benchmark
bun tests/benchmark/node-vs-bun-vs-deno.ts                # Bun benchmark
deno run --allow-net tests/benchmark/node-vs-bun-vs-deno.ts  # Deno benchmark
```

### Acceptance Criteria

- [ ] All 3 runtimes pass tests
- [ ] Benchmark produces numbers for all 3
- [ ] Zero regression on Node + Bun
