# G1 type-test density audit

Date: 2026-06-04 madrugada
Plan: `.claude/knowledge-base/plans/g1-type-test-hardening-plan.md` v1.0 T1

## Baseline (G1-specific)

| File | LoC | `expectTypeOf` | `@ts-expect-error` | Notes |
|---|---:|---:|---:|---|
| `tests/type/theo-fetch.test-d.ts` | 74 | **8** | 0 | InferResponse/InferQuery/InferBody for GET/POST routes |
| `tests/unit/fixture-typed-client.test-d.ts` | 39 | **7** | 0 | Same shape against fixture under `fixtures/typed-client/server/routes/users.ts` |
| `tests/unit/app-client-proxy.test.ts` | 152 | 0 | 0 | RUNTIME tests only (17 it blocks); no compile-time assertions |
| **Total G1 client** | 265 | **15** | **0** | Density: 0.057 expectTypeOf/LoC |

Comparison to peers (per blueprint Q4):
- hono client: 31 expectTypeOf hits in single `types.test.ts` (1944 LoC → density 0.016)
- trpc client: 3 expectTypeOf hits in `internals/types.test.ts`
- G1 today: 15 hits across 2 files (density 0.057 — actually HIGHER per LoC than hono, but WAY less total)

## EC-1 (plan accepted risk) verdict

Plan estimate said "~3-5 hits". Real baseline is **15 hits** — 3-5× higher. Per EC-1 "How to apply":
> Se baseline ≥ 20, ajustar T2 target para "+ 10 a 15" ao invés de "+ 25".

Baseline is 15 (between 5 and 20) — **original target stands at "+25" expectTypeOf**.

## Coverage gaps identified (T2 targets)

### Gap 1 — `createAppClient` Proxy facade type-tests = ZERO

`tests/unit/app-client-proxy.test.ts` has 17 runtime tests but ZERO compile-time assertions. The Proxy return type erases through runtime. We need:
- `createAppClient<TApp>()` return-type test (the Proxy is typed `unknown` by default; consumer must pass generic)
- Property-access chain typing test (`client.users.get` should be a function)
- `CallOptions` discrimination test (`params` accepts `Record<string, string|number>`)

### Gap 2 — `TheoFetchOptions<T>` discrimination = ZERO

`TheoFetchOptions<T>` is a conditional intersection that requires `query` ONLY if `InferQuery<T>` is defined, same for `body`. No type-test exists for this discrimination:
- GET route with no query schema → `TheoFetchOptions<GET>['query']` is `never`
- POST route with body schema → `TheoFetchOptions<POST>['body']` is the inferred shape
- Mixing them in `theoFetch(..., { body: ..., query: ... })` should compile only when both schemas exist

### Gap 3 — Negative cases (`@ts-expect-error`) = ZERO

No test asserts that wrong input types FAIL to compile. Missing:
- Invalid body shape passed to `theoFetch`
- Invalid query value (string where number required)
- Missing required `body` field
- Missing `params` for parameterized route

### Gap 4 — Deep-nesting param extraction

No test covers multi-segment paths (`client.api.v2.posts.[id].comments.[cid].get`). G1 supports arbitrary nesting via Proxy; type-tests should pin the param extraction.

### Gap 5 — Method discrimination

No test asserts that `client.X.get` and `client.X.post` have DIFFERENT shapes (one takes no body, the other requires it).

## T2 plan (mapped to gaps)

| Gap | New assertions | File |
|---|---:|---|
| Gap 1: Proxy facade | 6 expectTypeOf + 1 @ts-expect-error | NEW `tests/type/app-client-proxy.test-d.ts` |
| Gap 2: TheoFetchOptions discrimination | 8 expectTypeOf + 2 @ts-expect-error | NEW `tests/type/theo-fetch-options.test-d.ts` |
| Gap 3: Negative cases | (covered in Gap 1+2+5) | (inline) |
| Gap 4: Deep-nesting | 4 expectTypeOf | NEW `tests/type/proxy-deep-nesting.test-d.ts` |
| Gap 5: Method discrimination | 7 expectTypeOf + 2 @ts-expect-error | NEW `tests/type/method-discrimination.test-d.ts` |
| **Total NEW** | **25 expectTypeOf + 5 @ts-expect-error** | 4 new `.test-d.ts` files |

Hits global density target: **40 expectTypeOf total** (baseline 15 + 25 new) — exceeds hono's 31.

## Top-3 modules with poorest type-test coverage

1. **`app-client.ts`** (`createAppClient` + `makeProxy`) — ZERO compile-time tests today (152 LoC of runtime tests only)
2. **`theo-fetch.ts`** (`TheoFetchOptions<T>` discrimination) — `Infer*` types tested but not `TheoFetchOptions` itself
3. **`batch.ts`** (`Batcher` API) — no type-tests; runtime-only

T2 priorities Gap 1 + Gap 2 + Gap 5 because they cover modules #1 and #2.

## Estimated effort

- T2.1 (Gap 1 + 5 — app-client + method discrimination): 2-3h
- T2.2 (Gap 2 + 4 — TheoFetchOptions + deep-nesting): 2h
- T3 (typecheck + vitest gates): 15min

Total: 4.5-5.5h. Per plan T2 estimate (4-6h). On budget.
