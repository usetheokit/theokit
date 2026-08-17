# Edge Case Review — theokit-di-spring-boot-parity

Date: 2026-06-10
Tasks analyzed: 5
Edge cases found: 7 (MUST FIX: 2, SHOULD TEST: 3, DOCUMENT: 2)

## MUST FIX

### EC-1: @PostConstruct on async method silently ignores return value
- **Affected task:** T1.3 (@PostConstruct/@PreDestroy)
- **Family:** State / Timing
- **Scenario:** User decorates an async method with `@PostConstruct`. Container calls the method but does NOT await the returned Promise. The init logic appears to complete, but the async work (DB connection, cache warmup) hasn't finished when the first request arrives.
- **Impact:** Race condition — first request hits a partially-initialized provider. Data corruption or crash.
- **Suggested fix:** `const result = instance[methodName](); if (result instanceof Promise) await result;` — detect and await Promises from PostConstruct methods. Makes Container.resolve() async-safe (already has resolveAsync path).

### EC-2: @Agent factory registration order — toolboxes must be registered BEFORE agents
- **Affected task:** T3.1 (Agent auto-wiring)
- **Family:** State / Ordering
- **Scenario:** `TheoApp.create({ agents: [PlannerAgent], providers: [ProjectTools] })` — the agent factory depends on ProjectTools being resolvable from the Container. If agents are registered before providers, `container.resolve(ProjectTools)` inside the factory throws `TokenNotFoundError`.
- **Impact:** TheoApp.create() crashes on startup if provider array is declared after agents.
- **Suggested fix:** Registration order in TheoApp: (1) providers, (2) toolboxes from @Mixin, (3) controllers, (4) agents. Document this ordering guarantee.

## SHOULD TEST

### EC-3: @PreDestroy called before Disposable.dispose() — order guarantee
- **Affected task:** T1.3 (@PostConstruct/@PreDestroy)
- **Suggested test:** `test_predestroy_before_disposable_dispose()` — class implements Disposable AND has @PreDestroy. Assert @PreDestroy called FIRST, then Disposable.dispose(). If reversed, cleanup hooks may reference already-released resources.

### EC-4: @Primary with @Qualifier — qualifier takes precedence
- **Affected task:** T1.2 (@Primary) + T1.1 (@Qualifier)
- **Suggested test:** `test_qualifier_overrides_primary()` — provider A is @Primary, provider B has qualifier 'special'. Consumer uses @Qualifier('special'). Assert B is resolved, not A. Documents the resolution priority chain: qualifier > primary > error.

### EC-5: Container.runInRequest() with @PostConstruct on REQUEST-scoped provider
- **Affected task:** T2.1 (TheoApp Container) + T1.3 (lifecycle)
- **Suggested test:** `test_postconstruct_called_per_request_in_request_scope()` — REQUEST-scoped provider with @PostConstruct. Two concurrent requests each get their own instance AND each triggers @PostConstruct independently.

## DOCUMENT

### EC-6: @PostConstruct async support — v1 awaits Promises (upgraded from UQ1)
- **Accepted risk:** UQ1 asked "should PostConstruct support async?" — EC-1 shows it MUST await Promises to prevent race conditions. V1 detects Promises and awaits them. This means `container.resolve()` becomes effectively async when PostConstruct is async — consumers should prefer `resolveAsync()` when PostConstruct methods exist. Document: "@PostConstruct supports async methods. Use resolveAsync() for providers with async initialization."

### EC-7: TheoApp.create() becomes async (breaking change for TheoApp but not for createDecoratorServer)
- **Accepted risk:** Currently `TheoApp.create()` is sync. With async Container resolution (Agent.create() factory + async PostConstruct), it MUST become `await TheoApp.create()`. This is a breaking change for TheoApp users — but since the system is not in production (per user), this is acceptable. `createDecoratorServer()` remains unaffected (sync, no DI). Document: "TheoApp.create() is now async. Use `const app = await TheoApp.create({...})`."

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 0 | 0 | 0 | 0 |
| T1.2 | 1 | 0 | 1 (EC-4) | 0 |
| T1.3 | 2 | 1 (EC-1) | 1 (EC-3) | 1 (EC-6) |
| T2.1 | 1 | 0 | 1 (EC-5) | 1 (EC-7) |
| T3.1 | 1 | 1 (EC-2) | 0 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT — 2 MUST FIX (async PostConstruct + registration order) need absorption.
