---
slug: theokit-di-spring-boot-parity
created_at: 2026-06-10
goal: Ship @Qualifier, @Primary, @PostConstruct, @PreDestroy decorators in @theokit/di, replace TheoApp manual DI with real Container, and auto-wire @Agent classes as async factory providers, measured by bun test returning 35+ new tests GREEN across theokit-sdk/packages/di and theokit/packages/http-decorators with zero manual wiring in TheoApp.create().
---

# Plan: @theokit/di Spring Boot Parity + TheoApp Container Integration

> **Version 1.1** (2026-06-10) — Absorbed EC-1 (async PostConstruct must await Promises), EC-2 (registration order: providers → toolboxes → controllers → agents). Plus EC-3 (PreDestroy before Disposable), EC-4 (Qualifier overrides Primary), EC-5 (PostConstruct per REQUEST scope). EC-6 (async PostConstruct documented), EC-7 (TheoApp.create() becomes async).
>
> **Version 1.0** — Evolve `@theokit/di` to Spring Boot feature parity with `@Qualifier`, `@Primary`, `@PostConstruct`, `@PreDestroy` decorators. Replace `TheoApp.create()`'s manual `Map<Function, object>` with the real `Container`. Auto-wire `@Agent` classes as async factory providers so the consumer writes ZERO plumbing — `TheoApp.create({ controllers, agents, providers })` handles everything like `SpringApplication.run()`.

## Goal

> Ship `@Qualifier(name)`, `@Primary`, `@PostConstruct`, `@PreDestroy` decorators in `@theokit/di` and replace `TheoApp.create()` manual DI with the real `Container` including REQUEST scope and async factory support for `@Agent` auto-wiring, measured by `bun test` returning 35+ new tests GREEN across both packages with `TheoApp.create({ controllers, agents, providers })` requiring zero manual wiring.

## Context

`@theokit/di` v0.1.0 is production-ready with 1,442 LoC — `@Injectable`, `@Module`, `@Inject`, `@Optional`, 3 scopes (SINGLETON/TRANSIENT/REQUEST), async resolution, cycle detection. But `TheoApp.create()` ignores it entirely — uses a manual `Map<Function, object>` that lacks scopes, async support, lifecycle hooks, and error handling. Meanwhile, `@Agent` classes require manual `compileAgent()` + `createRunFactory()` plumbing. Spring Boot's value proposition is ZERO wiring — the framework resolves everything from annotations.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Why it exists | Invariants to preserve |
|---|---|---|---|
| `theokit-sdk/packages/di/src/container.ts` | 830 | Core DI orchestrator | resolve/register/dispose API |
| `theokit-sdk/packages/di/src/types.ts` | 127 | Provider + Scope types | Existing Provider union |
| `theokit-sdk/packages/di/src/index.ts` | 39 | Public barrel | Additive exports only |
| `theokit-sdk/packages/di/src/decorators/` | 140 | 4 decorators (Injectable, Inject, Module, Optional) | Existing APIs |
| `theokit-sdk/packages/di/src/internal/metadata.ts` | 105 | Metadata keys + readers | Key namespace |
| `theokit-sdk/packages/di/src/decorators/qualifier.ts` (NEW) | 0 | @Qualifier decorator | — |
| `theokit-sdk/packages/di/src/decorators/primary.ts` (NEW) | 0 | @Primary decorator | — |
| `theokit-sdk/packages/di/src/decorators/lifecycle.ts` (NEW) | 0 | @PostConstruct + @PreDestroy | — |
| `theokit/packages/http-decorators/src/app.ts` | 256 | TheoApp.create() | Controllers + agents options |

### Current callers / dependents

- **`Container`** — consumed by `theokit-sdk/packages/di/tests/` (5 test files), `theokit-sdk/packages/di-agent/` (InjectAgent). TheoApp does NOT use it yet.
- **`TheoApp.create()`** — consumed by `tests/integration/theo-app.test.ts`, `examples/app.test.ts`, `fixtures/demo-faang/demo-launcher.ts`.
- **`@Injectable()`** — used in DI tests only. TheoApp does not require it on providers.

### Domain glossary

- **Container** — The IoC container that resolves dependencies by token (class or string).
- **@Qualifier** — Disambiguates when multiple providers implement the same interface. `@Qualifier('admin')` on constructor param selects the `admin`-qualified provider.
- **@Primary** — Marks a provider as the default when multiple match the same token.
- **@PostConstruct** — Method called after DI resolution completes (all deps injected).
- **@PreDestroy** — Method called during container.dispose() (cleanup).
- **REQUEST scope** — Per-HTTP-request instance via `AsyncLocalStorage`. Isolated between concurrent requests.

### Architecture boundaries affected

- **theokit-sdk/packages/di/** — new decorators added to existing package. No cross-package deps added.
- **theokit/packages/http-decorators/src/app.ts** — replaces manual DI with Container import. Creates a runtime dependency from http-decorators → di (already declared as peerDep concept).

## Prior Art & Related Work

- **Internal:** `theokit-sdk/packages/di/` — existing Container with 5 test suites and 8 ADRs documented in its completed implementation plan.
- **External:** NestJS `@nestjs/core` — `OnModuleInit`, `OnModuleDestroy` lifecycle hooks. `@Inject()` for tokens.
- **External:** Spring Boot `org.springframework.context` — `@PostConstruct`, `@PreDestroy` (JSR-250), `@Qualifier`, `@Primary`.
- **External:** tsyringe — lightweight TS DI with `@injectable()` and `@inject()`. No lifecycle hooks.

## Objective

- [ ] `@Qualifier(name)` decorator in `@theokit/di` with Container resolution support
- [ ] `@Primary` decorator in `@theokit/di` with "default when ambiguous" resolution
- [ ] `@PostConstruct` method decorator — called after resolve completes
- [ ] `@PreDestroy` method decorator — called during dispose
- [ ] `TheoApp.create()` uses real `Container` from `@theokit/di`
- [ ] REQUEST scope wrapping each HTTP request via `container.runInRequest()`
- [ ] `@Agent` classes auto-wired as async factory providers (zero manual plumbing)
- [ ] 35+ new tests GREEN

## ADRs

### D480 — @Qualifier stores name in metadata, Container matches at resolve-time

**Decision:** `@Qualifier(name)` is a parameter decorator that stores the qualifier name in metadata. During `container.resolve(token)`, if multiple providers match the token, the qualifier narrows to the matching provider. If no qualifier specified and multiple exist, pick `@Primary` or throw.

**Rationale:** Per Spring Boot pattern — qualifier is on the injection SITE (consumer), not the provider definition. This matches NestJS's `@Inject('token')` semantics but adds semantic naming. Per DIP (`architecture.md`), the consumer declares what it needs.

**Alternatives considered:**
- (a) Qualifier on provider only — rejected: consumer should control which impl it gets, not the provider.

**Consequences:** Container.resolve() gains a resolution priority chain: exact class match → qualifier match → @Primary → error.

### D481 — @Primary stores boolean metadata on provider class

**Decision:** `@Primary` is a class decorator on the provider implementation. When multiple providers resolve for the same token, the `@Primary` one wins. If multiple `@Primary` exist for the same token, throw.

**Rationale:** Per Spring Boot — `@Primary` is the "default" signal. Simple boolean flag. Per KISS, no scoring system — just "is primary or not".

**Alternatives considered:**
- (a) Priority number instead of boolean — rejected: YAGNI, boolean covers 99% of cases.

**Consequences:** One new metadata key on class. Container checks it during ambiguous resolution.

### D482 — @PostConstruct/@PreDestroy as method decorators with metadata scan

**Decision:** `@PostConstruct` and `@PreDestroy` are method decorators. After `container.resolve()` creates an instance, it scans for `@PostConstruct` methods and calls them. During `container.dispose()`, it scans for `@PreDestroy` methods before calling `Disposable.dispose()`.

**Rationale:** Per JSR-250 (Java) and NestJS (`OnModuleInit`). Method decorators are more explicit than interface implementation — the class doesn't need to know about the DI container's lifecycle API.

**Alternatives considered:**
- (a) Interface-only (`implements PostConstructable`) — rejected: forces DI awareness into business classes. Decorator is non-invasive.

**Consequences:** Container gains lifecycle hook discovery after resolution. Both hooks are optional (most classes won't have them).

### D483 — TheoApp uses Container, not manual Map

**Decision:** Replace `TheoApp.create()`'s manual `Map<Function, object>` with `new Container()`. Controllers, agents, and providers registered via `container.register()`. Each HTTP request wrapped in `container.runInRequest()`.

**Rationale:** Container already solves: async resolution, cycle detection, typed errors, lifecycle, scopes. Manual Map duplicates all of this poorly. Per DRY, use the existing solution.

**Alternatives considered:**
- (a) Keep manual Map for simplicity — rejected: blocks async factories (Agent.create()), blocks REQUEST scope, blocks lifecycle hooks.

**Consequences:** TheoApp gains a peerDep on `@theokit/di`. All DI errors become typed (TokenNotFoundError instead of generic Error).

### D484 — @Agent classes become async factory providers via useFactory

**Decision:** When `TheoApp.create({ agents: [PlannerAgent] })` is called, each `@Agent` class is registered in the Container as an async factory provider. The factory: walks metadata → compiles tools → calls SDK `Agent.create()` → returns the SDK agent instance. Tools (@Toolbox/@Mixin) are resolved from the Container via DI.

**Rationale:** This is the "SpringApplication.run()" moment — the framework, not the consumer, wires everything. Per the FAANG demo gap analysis, the #1 issue was manual wiring. Factory providers are the idiomatic DI solution for async initialization.

**Alternatives considered:**
- (a) Consumer provides createRunFactory — rejected: this IS the gap. Consumer should write zero wiring.

**Consequences:** `@Agent` classes are first-class DI citizens. Toolboxes injected, agents compiled, SDK wired — automatically.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Container adds startup latency (async resolution) | Low | Agent.create() is the bottleneck, not DI resolution (~1ms). Profile in integration test. | Implementer |
| peerDep @theokit/di required for TheoApp users | Medium | Document in README. Users who don't use TheoApp still use createDecoratorServer() without DI. | Implementer |
| @PostConstruct called synchronously blocks startup if method is slow | Low | Document: @PostConstruct methods should be fast. Async PostConstruct deferred to v2. | Implementer |
| REQUEST scope adds AsyncLocalStorage overhead per request | Low | Measured in DI v1 tests: ~0.1ms per request. Acceptable. | Implementer |
| EC-6: @PostConstruct supports async — resolveAsync() recommended | Low | Document: "Use resolveAsync() for providers with async @PostConstruct." Container detects Promise and awaits. | Implementer |
| EC-7: TheoApp.create() becomes async (breaking change) | Medium | System not in production. Change signature to `await TheoApp.create()`. createDecoratorServer() unaffected. | Implementer |

## Unresolved Questions

- UQ1 — RESOLVED (v1.1): `@PostConstruct` MUST support async methods per EC-1. Container detects Promise return and awaits it. Sync-only would cause race conditions on startup.
- UQ2 — Should TheoApp auto-detect `@theokit/di` via optional peer, or require it? Leaning toward require (explicit > implicit).

## Dependency Graph

```
Phase 1 (DI decorators: @Qualifier, @Primary, @PostConstruct, @PreDestroy)
  ↓
Phase 2 (TheoApp Container integration + REQUEST scope)
  ↓
Phase 3 (Agent auto-wiring via factory providers)
  ↓
Phase 4 (Integration Validation)
```

All sequential.

---

## Phase 1: DI Decorators — Spring Boot Parity

**Objective:** Add `@Qualifier`, `@Primary`, `@PostConstruct`, `@PreDestroy` to `@theokit/di`.

### T1.1 — @Qualifier decorator + Container resolution

#### Objective
Add `@Qualifier(name)` parameter decorator and update Container to use it during ambiguous resolution.

#### Why this step
**Action:** Create the disambiguator that lets consumers pick between multiple providers implementing the same interface.
**Reasoning:** Per D480, qualifier is the standard Spring/NestJS pattern for multi-impl scenarios. Without it, the Container throws on ambiguous tokens.

#### Evidence
- `theokit-sdk/packages/di/src/container.ts:resolve()` — current resolution doesn't support qualifiers.
- `theokit-sdk/packages/di/src/decorators/inject.ts` — existing parameter decorator pattern to follow.

#### Files to edit
```
theokit-sdk/packages/di/src/decorators/qualifier.ts (NEW) — @Qualifier decorator
theokit-sdk/packages/di/src/container.ts — add qualifier-aware resolution
theokit-sdk/packages/di/src/internal/metadata.ts — add QUALIFIER metadata key
theokit-sdk/packages/di/src/index.ts — export @Qualifier
theokit-sdk/packages/di/tests/qualifier.test.ts (NEW) — tests
```

#### Deep file dependency analysis
- `container.ts` resolve() chain needs to check qualifier metadata on constructor params.
- `metadata.ts` needs new key `DI_QUALIFIER`.
- No existing callers affected (additive change).

#### TDD
```
RED:     test_qualifier_resolves_named_provider() — @Qualifier('admin') picks AdminUserService
RED:     test_qualifier_throws_if_not_found() — @Qualifier('nonexistent') → TokenNotFoundError
RED:     test_without_qualifier_multiple_providers_throws() — ambiguous resolution error
RED:     test_qualifier_with_string_token() — works with string token + qualifier
GREEN:   Implement @Qualifier decorator + Container resolution
REFACTOR: None expected
VERIFY:  bun test tests/qualifier.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `bun test tests/qualifier.test.ts` exits 0 with 4+ tests GREEN
- [ ] `@Qualifier('admin')` on constructor param selects the admin-qualified provider
- [ ] Ambiguous resolution without qualifier throws descriptive error
- [ ] Pass: size — `qualifier.ts` ≤ 40 LoC

#### DoD
- [ ] Tests passing
- [ ] `tsc --noEmit` exits 0

### T1.2 — @Primary decorator

#### Objective
Add `@Primary` class decorator that marks a provider as the default when multiple match.

#### Why this step
**Action:** The "default implementation" signal for multi-provider scenarios.
**Reasoning:** Per D481, @Primary is simpler than @Qualifier when the consumer doesn't care WHICH impl — just wants the default.

#### Files to edit
```
theokit-sdk/packages/di/src/decorators/primary.ts (NEW) — @Primary decorator
theokit-sdk/packages/di/src/container.ts — add @Primary resolution fallback
theokit-sdk/packages/di/src/internal/metadata.ts — add PRIMARY metadata key
theokit-sdk/packages/di/src/index.ts — export @Primary
theokit-sdk/packages/di/tests/primary.test.ts (NEW) — tests
```

#### TDD
```
RED:     test_primary_wins_ambiguous_resolution() — @Primary class selected over non-primary
RED:     test_primary_with_qualifier_qualifier_wins() — @Qualifier overrides @Primary
RED:     test_multiple_primary_throws() — two @Primary for same token → error
RED:     test_no_primary_no_qualifier_throws() — multiple providers, no hint → error
RED:     test_qualifier_overrides_primary() — EC-4: @Qualifier('x') selects over @Primary (priority: qualifier > primary > error)
GREEN:   Implement
VERIFY:  bun test tests/primary.test.ts
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `bun test tests/primary.test.ts` exits 0 with 4+ tests GREEN
- [ ] @Primary wins over non-primary in ambiguous resolution
- [ ] @Qualifier overrides @Primary when both present
- [ ] Pass: size — `primary.ts` ≤ 30 LoC

#### DoD
- [ ] Tests passing

### T1.3 — @PostConstruct + @PreDestroy lifecycle hooks

#### Objective
Add lifecycle method decorators that the Container invokes after resolve (PostConstruct) and during dispose (PreDestroy).

#### Why this step
**Action:** Lifecycle hooks for initialization and cleanup — the Spring Boot `@PostConstruct`/`@PreDestroy` (JSR-250) pattern.
**Reasoning:** Per D482, method decorators are non-invasive. The Container discovers them via metadata scan. Works alongside existing Disposable interface.

#### Files to edit
```
theokit-sdk/packages/di/src/decorators/lifecycle.ts (NEW) — @PostConstruct + @PreDestroy
theokit-sdk/packages/di/src/container.ts — invoke hooks after resolve / during dispose
theokit-sdk/packages/di/src/internal/metadata.ts — add POSTCONSTRUCT + PREDESTROY keys
theokit-sdk/packages/di/src/index.ts — export both
theokit-sdk/packages/di/tests/lifecycle.test.ts (NEW) — tests
```

#### TDD
```
RED:     test_postconstruct_called_after_resolve() — method decorated with @PostConstruct called once
RED:     test_postconstruct_called_with_deps_injected() — this.dep is available in @PostConstruct
RED:     test_predestroy_called_on_dispose() — method decorated with @PreDestroy called during container.dispose()
RED:     test_predestroy_with_disposable() — both @PreDestroy and Disposable.dispose() called (PreDestroy first)
RED:     test_no_lifecycle_hooks_no_error() — class without hooks resolves normally
RED:     test_postconstruct_only_called_once_singleton() — singleton resolved 2x, PostConstruct called 1x
RED:     test_postconstruct_async_awaited() — EC-1: async @PostConstruct method awaited; deps fully initialized before first use
RED:     test_predestroy_before_disposable() — EC-3: @PreDestroy called BEFORE Disposable.dispose()
RED:     test_postconstruct_per_request_scope() — EC-5: REQUEST-scoped provider triggers @PostConstruct per request
GREEN:   Implement with Promise detection: if (result instanceof Promise) await result
VERIFY:  bun test tests/lifecycle.test.ts
```

#### Concurrency tests
(none — single-threaded; PostConstruct is sync per D482/UQ1)

#### Acceptance Criteria
- [ ] `bun test tests/lifecycle.test.ts` exits 0 with 6+ tests GREEN
- [ ] @PostConstruct method called exactly once after first resolve
- [ ] @PreDestroy method called during dispose, before Disposable.dispose()
- [ ] Singleton: PostConstruct called once regardless of resolve count
- [ ] Pass: size — `lifecycle.ts` ≤ 40 LoC

#### DoD
- [ ] Tests passing

---

## Phase 2: TheoApp Container Integration

**Objective:** Replace TheoApp.create()'s manual Map with real Container from @theokit/di.

### T2.1 — Replace manual DI with Container

#### Objective
Rewrite TheoApp.create() lines 46-93 to use `new Container()` + `container.register()` + `container.resolve()`.

#### Why this step
**Action:** The manual Map<Function, object> is replaced by the real IoC container with scopes, lifecycle, and typed errors.
**Reasoning:** Per D483, the Container already solves everything the Map does manually but poorly. DRY.

#### Files to edit
```
theokit/packages/http-decorators/src/app.ts — rewrite DI section
theokit/packages/http-decorators/tests/integration/theo-app.test.ts — update tests
```

#### Deep file dependency analysis
- `app.ts` lines 46-93 (the entire DI block) are replaced.
- Tests that use TheoApp.create() still pass — API is unchanged, only internals changed.
- Controllers gain automatic @PostConstruct support.

#### TDD
```
RED:     test_theoapp_uses_container() — providers resolved via Container (not Map)
RED:     test_theoapp_typed_error_on_missing_dep() — TokenNotFoundError instead of generic Error
RED:     test_theoapp_postconstruct_called() — provider with @PostConstruct method called after create
RED:     test_theoapp_dispose_calls_predestroy() — app.close() calls @PreDestroy on providers
RED:     test_theoapp_request_scope() — request-scoped provider isolated between requests
GREEN:   Implement Container integration
VERIFY:  bun test tests/integration/theo-app.test.ts
```

#### Concurrency tests
```
test_theoapp_concurrent_requests_isolated() — 2 parallel requests get separate REQUEST-scoped instances
```

#### Acceptance Criteria
- [ ] `bun test tests/integration/theo-app.test.ts` exits 0 with all tests GREEN
- [ ] Zero `new Map<Function, object>()` in app.ts
- [ ] TheoApp.create() API unchanged (backward compatible)
- [ ] Pass: size — app.ts ≤ 300 LoC

#### DoD
- [ ] Tests passing
- [ ] All existing theo-app tests still GREEN

---

## Phase 3: Agent Auto-Wiring

**Objective:** `@Agent` classes become DI-managed async factory providers — zero manual wiring.

### T3.1 — Agent factory provider registration

#### Objective
When `TheoApp.create({ agents: [PlannerAgent] })` is called, each `@Agent` class is registered as an async factory that: walks metadata → resolves toolboxes from Container → compiles tools → calls SDK `Agent.create()`.

#### Why this step
**Action:** The "SpringApplication.run()" moment — agents wired automatically.
**Reasoning:** Per D484, the #1 gap was manual wiring. Factory providers are the DI-idiomatic solution. The Container handles async (Agent.create() is async) via `resolveAsync()`.

#### Files to edit
```
theokit/packages/http-decorators/src/app.ts — add agent auto-wiring in TheoApp.create()
theokit/packages/http-decorators/tests/integration/theo-app-agents.test.ts (NEW)
```

#### Deep file dependency analysis
- `app.ts` gains agent registration logic after controller registration.
- Imports from `@theokit/agents` (walkAgentMetadata, compileAgent, generateAgentRoutes).
- Toolbox classes resolved from Container, not manually `new`'d.

#### TDD
```
RED:     test_agents_auto_registered() — TheoApp.create({ agents: [Agent] }) registers agent routes
RED:     test_toolbox_resolved_from_container() — toolbox constructor deps injected via DI
RED:     test_agent_sse_route_auto_mounted() — POST /agents/planner/chat returns SSE
RED:     test_agent_guards_applied() — @UseGuards on agent enforced via DI context
RED:     test_zero_manual_wiring() — no compileAgent/createRunFactory/generateAgentRoutes in consumer code
RED:     test_registration_order_providers_before_agents() — EC-2: providers registered before agents; agents resolve toolbox deps without error
GREEN:   Implement with guaranteed order: providers → toolboxes(@Mixin) → controllers → agents
VERIFY:  bun test tests/integration/theo-app-agents.test.ts
```

#### Concurrency tests
(none — single-threaded; agent is singleton, per-request isolation via SSE stream)

#### Acceptance Criteria
- [ ] `bun test tests/integration/theo-app-agents.test.ts` exits 0 with 5+ tests GREEN
- [ ] Consumer code: `TheoApp.create({ agents: [PlannerAgent], providers: [ProjectTools] })` — ZERO manual wiring
- [ ] Agent SSE endpoint auto-mounted at `@Agent({ route })` path + `/chat`
- [ ] Toolbox deps injected from Container

#### DoD
- [ ] Tests passing
- [ ] Demo fixture updated to use zero-wiring pattern

---

## Phase 4: Integration Validation (MANDATORY)

### Execution

```bash
# DI package tests
bun test theokit-sdk/packages/di/tests/

# http-decorators tests (includes TheoApp)
bun test packages/http-decorators/tests/

# agents tests
bun test packages/agents/tests/

# Demo fixture
bun fixtures/demo-faang/demo-launcher.ts &
curl http://localhost:4000/api/projects
curl -N -X POST http://localhost:4000/api/agents/planner/chat -H "Content-Type: application/json" -H "x-role: user" -d '{"message":"List tasks"}'
```

### Acceptance Criteria

- [ ] DI: all existing tests GREEN + 14+ new tests
- [ ] http-decorators: all existing tests GREEN + 6+ new tests
- [ ] agents: all existing tests GREEN
- [ ] Demo: zero manual wiring, agent SSE works
- [ ] Zero type errors

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | @Qualifier decorator | T1.1 | Parameter decorator + Container resolution |
| 2 | @Primary decorator | T1.2 | Class decorator + ambiguous resolution fallback |
| 3 | @PostConstruct lifecycle hook | T1.3 | Method decorator + post-resolve invocation |
| 4 | @PreDestroy lifecycle hook | T1.3 | Method decorator + pre-dispose invocation |
| 5 | TheoApp uses real Container | T2.1 | Replace manual Map with Container |
| 6 | REQUEST scope per HTTP request | T2.1 | container.runInRequest() wrapping handler |
| 7 | Agent auto-wiring (zero plumbing) | T3.1 | Async factory provider + auto route mount |

**Coverage: 7/7 gaps covered (100%)**

## Global Definition of Done

- [ ] All tests passing: DI 5+ existing + 14 new, http-decorators 201 existing + 6 new, agents 186 existing
- [ ] Zero type errors
- [ ] File-size budget: every file ≤ 500 LoC
- [ ] CHANGELOG.md updated under `[Unreleased]`
- [ ] TheoApp.create() API backward compatible (controllers + providers still work without agents)
- [ ] Zero manual wiring in demo fixture
- [ ] @PostConstruct/@PreDestroy work alongside existing Disposable interface

## Failure scenarios

(none — no external I/O touched. Container is in-process. Agent.create() mock in tests.)

## Final Phase: Integration Validation (MANDATORY)

See Phase 4 above.
