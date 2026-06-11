# Discovery Plan: TheoKit Decorators ↔ DI Container Integration

> **Version 1.0** — How to wire `@theokit/di`'s `Container.resolve()` into `@theokit/http-decorators`' controller + guard instantiation so that NestJS-style constructor injection (`constructor(private catsService: CatsService)`) works. The user pasted the canonical NestJS Providers chapter as the spec input.

**Slug:** `theokit-decorators-di-integration`
**Owner:** paulohenriquevn
**Created:** 2026-06-09
**Time budget:** 3h total (2h internal code audit + 1h di-agent pattern reference)

## Context

`@theokit/di` 0.1.0 GA is already shipped on npm `@latest` (since 2026-05-29). It provides:
- `@Injectable({ scope? })` class decorator (SINGLETON/TRANSIENT/REQUEST)
- `@Inject(token)` constructor + property decorator
- `@Module({ providers, imports, exports })` module composition
- `@Optional()` parameter decorator
- `Container` class with `resolve<T>(token)`, `resolveAsync<T>(token)`, `runInRequest(cb)`, `dispose()`
- Cycle detection, freeze-after-first-resolve, alias providers

`@theokit/http-decorators` v0.1.0-alpha.0 shipped (2026-06-09) with 24 decorators + bridge engine + 77 tests. Currently instantiates controllers + guards via bare `new (Ctor)()` at 4 call sites. This means `constructor(private catsService: CatsService)` silently receives `undefined` — no DI.

The NestJS Providers chapter (user spec) describes exactly the pattern `@theokit/di` already implements. The gap is ONLY the wiring — replacing `new` with `container.resolve()`.

## Objective

Produce a blueprint that answers: **what is the minimal integration to make `@theokit/http-decorators`' `createDecoratorServer()` + `httpDecoratorsPlugin()` accept a `Container` instance and resolve controllers + guards via DI instead of bare `new`?** Measured by: blueprint scores SHIPPABLE_WITH_CAVEATS or higher.

## In-Scope

### @theokit/di (primary — already shipped, read-only audit)

- **`../theokit-sdk/packages/di/src/container.ts`** — `Container.resolve<T>(token)`, `runInRequest()`, registration API
- **`../theokit-sdk/packages/di/src/decorators/injectable.ts`** — `@Injectable` decorator shape
- **`../theokit-sdk/packages/di/src/decorators/module.ts`** — `@Module` composition
- **`../theokit-sdk/packages/di/src/types.ts`** — `Scope` enum, `Provider<T>`, `Token<T>`

### @theokit/di-agent (pattern reference — how another package wires DI)

- **`../theokit-sdk/packages/di-agent/src/agent-provider.ts`** — `createAgentProvider()` factory. This is the canonical example of a sibling package wiring into `@theokit/di`.

### @theokit/http-decorators (integration target — 4 bare-new call sites)

- **`packages/http-decorators/src/bridge/create-server.ts:38`** — `new (Ctor as new () => object)()`
- **`packages/http-decorators/src/bridge/create-server.ts:123`** — guard instantiation
- **`packages/http-decorators/src/theokit-plugin.ts:62`** — controller instantiation
- **`packages/http-decorators/src/theokit-plugin.ts:145`** — guard instantiation

### Out of scope

- NestJS internal DI implementation (we have our own `@theokit/di`)
- `@Module` module-level composition in http-decorators (defer to v0.2.0 per original ADR-D4)
- Request-scoped controllers (defer per EC-12 documented limitation)
- Property-based `@Inject()` on controller fields (constructor injection only for v0.1.0)

## ADRs

### D1 — Optional Container: `container?: Container` parameter (NOT required)

**Decision:** `createDecoratorServer()` and `httpDecoratorsPlugin()` accept an OPTIONAL `container` parameter. When provided, controllers + guards are resolved via `container.resolve(Ctor)`. When absent, fallback to `new Ctor()` (current behavior — backward compat).

**Rationale:** Not every consumer uses DI. A consumer who just wants `@Controller` + `@Get` without services injection should NOT be forced to set up a Container. Per YAGNI — optional is correct.

**Alternatives considered:**
- (a) Required Container — breaks existing consumers who don't use DI; violates backward compat.

### D2 — @theokit/di as OPTIONAL peer dep (NOT required)

**Decision:** `@theokit/di` declared as optional peer dep in `packages/http-decorators/package.json`. When installed, DI integration works. When not installed, bare `new` fallback.

**Rationale:** Same as D1. Per Rule 9 (Don't Reinvent) — the DI container already exists as a separate package.

### D3 — Singleton scope for controllers by default (REQUEST scope deferred)

**Decision:** Controllers resolved as SINGLETON by default (one instance per process). REQUEST scope (one instance per HTTP request via `container.runInRequest()`) deferred to v0.2.0.

**Rationale:** Per EC-12 documented limitation in README. NestJS defaults to singleton. REQUEST scope requires `runInRequest()` wrapping around each HTTP handler invocation — adds complexity.

## Research Questions

### Coverage Corner 1 — Integration Tests

**Q1:** How does `@theokit/di-agent` test the Container → Agent provider wiring? What test shape can http-decorators copy?

- **Corner:** Integration tests
- **Method:** Read `../theokit-sdk/packages/di-agent/tests/` for test patterns.
- **Expected answer shape:** Test pattern showing `container.register(Provider) → container.resolve(Consumer) → Consumer.dep is resolved`.
- **Evidence:** `../theokit-sdk/packages/di-agent/tests/`

### Coverage Corner 2 — Dependencies

**Q2:** What is the exact dependency relationship: does `@theokit/di-agent` declare `@theokit/di` as peer, dev, or required dep? What should `@theokit/http-decorators` mirror?

- **Corner:** Dependencies
- **Method:** Read `../theokit-sdk/packages/di-agent/package.json`.
- **Expected answer shape:** Dependency table: current vs proposed.
- **Evidence:** `../theokit-sdk/packages/di-agent/package.json`

### Coverage Corner 3 — Tools

**Q3:** Does the DI integration require any CLI/codegen tooling changes? Does `theokit generate controller` need to scaffold an `@Injectable()` decorator or a module registration?

- **Corner:** Tools
- **Method:** Read `packages/theo/src/cli/commands/generate.ts` `generateControllerTemplate()`. Compare with NestJS `nest g controller` output shape.
- **Expected answer shape:** Yes/no + proposed template delta (if any).
- **Evidence:** `packages/theo/src/cli/commands/generate.ts`

### Coverage Corner 4 — Techniques

**Q4:** What is the exact `Container.resolve()` call signature and error shape when a class is NOT registered? How should http-decorators handle the "class not in container" case gracefully?

- **Corner:** Techniques
- **Method:** Read `../theokit-sdk/packages/di/src/container.ts` `resolve()` method + error types in `../theokit-sdk/packages/di/src/errors.ts`.
- **Expected answer shape:** Error flow: `resolve(UnknownClass)` → throws `MissingInjectableError` → http-decorators catches → fallback to `new` OR actionable error.
- **Evidence:** `../theokit-sdk/packages/di/src/container.ts:180`, `../theokit-sdk/packages/di/src/errors.ts`

**Q5:** How does `createAgentProvider()` in `@theokit/di-agent` wire a non-DI-native class (SDK Agent) into the Container? What pattern can http-decorators copy for controllers?

- **Corner:** Techniques
- **Method:** Read `../theokit-sdk/packages/di-agent/src/agent-provider.ts` fully.
- **Expected answer shape:** Pattern description: factory provider? class provider? value provider? + worked example adapted to http-decorators.
- **Evidence:** `../theokit-sdk/packages/di-agent/src/agent-provider.ts`

**Q6:** What is the minimal code delta in `create-server.ts` + `theokit-plugin.ts` to replace the 4 `new (Ctor)()` calls with `container?.resolve(Ctor) ?? new Ctor()`?

- **Corner:** Techniques
- **Method:** Read the 4 call sites, draft the replacement, estimate LoC delta.
- **Expected answer shape:** Pseudo-code ≤ 20 LoC delta total across both files + the `container` parameter addition to factory signatures.
- **Evidence:** `packages/http-decorators/src/bridge/create-server.ts:38,123`, `packages/http-decorators/src/theokit-plugin.ts:62,145`

## Coverage Matrix

| # | Question | Corner | Method | Evidence path | Expected shape |
|---|---|---|---|---|---|
| Q1 | di-agent test patterns | Tests | Read di-agent/tests/ | `../theokit-sdk/packages/di-agent/tests/` | Test pattern |
| Q2 | Dep relationship (peer vs required) | Deps | Read di-agent/package.json | `../theokit-sdk/packages/di-agent/package.json` | Dep table |
| Q3 | CLI template delta | Tools | Read generate.ts template | `packages/theo/src/cli/commands/generate.ts` | Yes/no + delta |
| Q4 | Container.resolve error handling | Techniques | Read container.ts + errors.ts | `../theokit-sdk/packages/di/src/container.ts`, `errors.ts` | Error flow |
| Q5 | di-agent factory provider pattern | Techniques | Read agent-provider.ts | `../theokit-sdk/packages/di-agent/src/agent-provider.ts` | Pattern desc |
| Q6 | Minimal code delta (4 call sites) | Techniques | Read create-server.ts + theokit-plugin.ts | Both files | Pseudo-code ≤ 20 LoC |

**Coverage: 6/6 questions mapped (100%). All 4 corners: Tests:1, Deps:1, Tools:1, Techniques:3.**

## Halt-Loop Checkpoints

1. After Q4: confirm `Container.resolve()` throws a catchable error for unregistered classes (if NOT → the optional-container fallback strategy D1 needs revision).
2. After Q5: confirm di-agent's pattern is copy-able (if it uses a non-public Container API → escalate).
3. After Q6: confirm delta ≤ 20 LoC (if larger → scope may be wrong).

## Acceptance Criteria

- [ ] Every question answered with `file:line` citations.
- [ ] Container.resolve error handling documented with exact error class name.
- [ ] Code delta pseudo-code for the 4 call sites ≤ 20 LoC total.
- [ ] All 4 coverage corners populated.
- [ ] ≥ 1 ADR in blueprint.

## Global Definition of Done

- Blueprint scored ≥ SHIPPABLE_WITH_CAVEATS by `/discover-confidence`.
- Zero fabricated citations.
- All 4 coverage corners populated.
- ≥ 1 ADR.
