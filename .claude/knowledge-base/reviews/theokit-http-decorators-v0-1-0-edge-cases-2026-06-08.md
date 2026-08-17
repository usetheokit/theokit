# Edge Case Review — theokit-http-decorators-v0-1-0

**Date:** 2026-06-08
**Plan analyzed:** `.claude/knowledge-base/plans/theokit-http-decorators-v0-1-0-plan.md` (v1.0)
**Tasks analyzed:** 14 (T0.1 + T1.1-T1.5 + T2.1-T2.2 + T3.1-T3.4 + T4.1-T4.2 + T5.1 + T6.1 + T-final.1)
**Edge cases found:** 14 (MUST FIX: 5, SHOULD TEST: 6, DOCUMENT: 3)

## MUST FIX

### EC-1: `registerControllers([...])` has no mount mechanism — TheoKit's router is file-scan-only, no public runtime `addRoute` API

- **Task afetada:** T3.3 (registerControllers) — affects the entire bridge engine viability
- **Família:** Integration / Boundary
- **Cenário:** Plan's T3.3 returns `RouteRegistration[]` where each entry has `{verb, fullPath, route: defineRoute({...})}`. But TheoKit's request dispatcher only knows about routes discovered via `scanServerRoutes(serverDir)` (file-scan; verified `packages/theo/src/server/scan/scan.ts:102`). The public barrel `theokit/server` exports `scanServerRoutes`, `matchRoute`, `compilePattern` — but ZERO runtime route registration API (no `addRoute`, `mountRoutes`, `routeRegistry`). The user calling `registerControllers([CatsController])` gets back an array that has nowhere to be mounted. The bridge is functionally inert.
- **Impacto:** Entire Phase 3-4 surface ships but produces routes that TheoKit's dispatcher never sees → 404 on every decorated route → Goal-mandated Pattern-2 integration test (T-final.1) FAILS structurally. Cannot be fixed in Phase 6 docs.
- **Fix sugerido:** Plan v1.1 MUST resolve one of three paths in a new ADR D7:
  - (a) Switch to blueprint Q1 strategy (a) — bridge writes `.theo-decorators-cache/server/routes/{...}.ts` files at build time via Vite plugin; existing file-scanner picks them up. Adds Vite plugin scope to v0.1.0 BUT zero core changes. **Recommended** (cleanest).
  - (b) Add a public `mountVirtualRoutes(registrations)` API to `theokit/server` barrel. Contradicts plan's "zero changes to TheoKit core" claim — would require a core ADR.
  - (c) Document `registerControllers` as returning a list the consumer pipes into a hand-written `server/routes/decorators.ts` file that re-exports each `defineRoute`. Manual mount; weakens the "automatic" promise in Goal. Acceptable only as v0.1.0-alpha workaround.

### EC-2: Controller class WITHOUT `@Controller` decorator silently registers route with empty prefix

- **Task afetada:** T3.2 (walkControllerMetadata)
- **Família:** State / Input
- **Cenário:** Plan's T3.2 pseudo-code: `const { prefix, host } = getMeta(CONTROLLER_PREFIX, ControllerClass) ?? { prefix: '', host: undefined }`. If a developer forgets the `@Controller` decorator on a class with `@Get` methods, the bridge silently treats prefix as empty string → routes mount at `/findAll` instead of `/cats`. User wastes 30min debugging "why isn't my route at /cats?".
- **Impacto:** Silent misregistration; debugging cost; symbol of poor DX.
- **Fix sugerido:** In `walkControllerMetadata`, replace `?? { prefix: '', ... }` with: `if (!meta) throw new HttpDecoratorsConfigError('Controller class ${ControllerClass.name} is missing @Controller() decorator')`. Add unit test `test_walk_throws_when_missing_controller_decorator` to T3.2 RED list.

### EC-3: Path joining with leading/trailing slashes produces malformed paths

- **Task afetada:** T3.2 (walkControllerMetadata) — `joinPath` helper
- **Família:** Input
- **Cenário:** `@Controller('cats')` + `@Get('/breed')` → naive `prefix + '/' + path` produces `cats//breed`. Same for `@Controller('/cats')` + `@Get('')` → `/cats/`. NestJS normalizes these silently; user expects same.
- **Impacto:** 404 on routes with mismatched expectations; or duplicate route registration `cats/breed` vs `cats//breed`.
- **Fix sugerido:** `joinPath` helper in T3.2 must normalize: `function joinPath(prefix: string, path: string): string { return ('/' + prefix + '/' + path).replace(/\/+/g, '/').replace(/\/$/, '') || '/' }`. Add 4 RED tests covering `('cats', '/breed')`, `('/cats', 'breed')`, `('cats/', '/breed/')`, `('', '')`.

### EC-4: `emitDecoratorMetadata` requires CONSUMER tsconfig flag — bridge silently fails DTO resolution if missing

- **Task afetada:** T3.2 (walkControllerMetadata) — `Reflect.getMetadata('design:paramtypes', ...)` call
- **Família:** Boundary / Type
- **Cenário:** Plan's T3.2 reads `Reflect.getMetadata('design:paramtypes', ControllerClass.prototype, propertyKey)`. This metadata is emitted by tsc ONLY when the CONSUMER's tsconfig has `emitDecoratorMetadata: true`. Package's own tsconfig (ADR D1) doesn't help — the consumer's tsc compiles the consumer's controller class. If consumer adds package but forgets the tsconfig flag, `paramtypes` returns `undefined` → all `@Body() body: CreateCatDto` parameter types are `undefined` → `resolveDtoSchema(undefined)` returns `undefined` → routes mount with NO validation. Silent and dangerous.
- **Impacto:** Silent data validation bypass; security risk (unvalidated body); only surfaces in production when bad payload arrives.
- **Fix sugerido:** In T3.2 `walkControllerMetadata`, when ANY `@Body`/`@Query`/`@Param` decorator exists on a method AND `Reflect.getMetadata('design:paramtypes', ...)` returns `undefined`, throw `HttpDecoratorsConfigError('emitDecoratorMetadata not enabled in consumer tsconfig — add "emitDecoratorMetadata": true. See migration guide.')`. Add to README "Troubleshooting" section. Add RED test `test_walk_throws_when_design_paramtypes_missing`.

### EC-5: Duplicate controller registration silently produces duplicate routes

- **Task afetada:** T3.3 (registerControllers)
- **Família:** State / Idempotency
- **Cenário:** `registerControllers([CatsController, CatsController])` — bridge walks the same class twice, produces two identical `RouteRegistration` entries. Downstream mount (whatever EC-1's resolution is) attempts to register the same `{verb, path}` twice → either silent override OR dispatch ambiguity. User trying to debug a missing route adds the controller to the array a second time "just in case" and breaks everything.
- **Impacto:** Idempotency violation; debugging foot-gun; symbol of weak input validation at API boundary.
- **Fix sugerido:** In `registerControllers`, deduplicate by class reference: `const unique = Array.from(new Set(controllers))`. Emit a `console.warn` if duplicates dropped. Add RED test `test_register_duplicate_controllers_dedupes_with_warn`.

## SHOULD TEST

### EC-6: Same method decorated with `@Get()` AND `@Post()`

- **Task afetada:** T1.5
- **Teste sugerido:** `test_method_with_multiple_verb_decorators` — Given a method decorated with both `@Get()` and `@Post()`, When walkControllerMetadata runs, Then BOTH route entries are produced (one per verb) — NOT just the last one. Mirrors NestJS behavior (both routes register).

### EC-7: Parameter index gap (mixed decorated and undecorated parameters)

- **Task afetada:** T2.1, T3.2
- **Teste sugerido:** `test_walk_handles_param_index_gap` — Given handler `findOne(@Param('id') id: string, ctx: SomeCtx, @Headers('x') hdr: string)` where parameter index 1 has no decorator, When walkControllerMetadata builds paramExtractors, Then index 1 returns `undefined` (or skipped gracefully) and indices 0+2 are correctly extracted. Bridge must not crash on missing decorator at any index.

### EC-8: Inherited controller class

- **Task afetada:** T3.2
- **Teste sugerido:** `test_walk_handles_inheritance` — Given `class AdminCatsController extends CatsController` where parent has `@Controller('cats')` + `@Get()` and child adds `@Post('admin')`, When walkControllerMetadata(AdminCatsController), Then BOTH parent's @Get AND child's @Post register (or document that inheritance is explicitly unsupported in v0.1.0). NestJS supports inheritance; surprise behavior here harms migration.

### EC-9: Class-level + method-level `@UseGuards` composition order

- **Task afetada:** T4.1, T4.2
- **Teste sugerido:** `test_class_and_method_use_guards_compose` — Given `@UseGuards(ClassGuard) class C { @UseGuards(MethodGuard) @Get() handler() {...} }`, When the route is invoked, Then ClassGuard runs BEFORE MethodGuard (NestJS convention: class-level first, method-level second). Test BOTH guards execute on a single request.

### EC-10: Guard's `canActivate` THROWS (not returns false)

- **Task afetada:** T4.2
- **Teste sugerido:** `test_guard_canactivate_throws_propagates_as_500_not_401` — Given a guard whose `canActivate` throws `new Error('boom')` (not auth-related), When the route is invoked, Then the response is 500 with the error envelope (NOT 401 — only false return maps to 401). NestJS distinguishes thrown ForbiddenException (403) vs thrown unknown error (500). v0.1.0 honest behavior: only `return false` → 401; throws propagate.

### EC-11: `reflect-metadata` import side-effect requires explicit import in user code

- **Task afetada:** T1.2
- **Teste sugerido:** `test_consumer_inherits_reflect_metadata_via_package_import` — Given consumer imports `import { Controller, Get } from '@theokit/http-decorators'` WITHOUT `import 'reflect-metadata'` in their own bootstrap, When a decorated class loads, Then `Reflect.defineMetadata` is available (because package's `storage.ts` already did `import 'reflect-metadata'` as a side-effect). Verify via Pattern-2 fixture that consumer has zero explicit `reflect-metadata` import lines.

## DOCUMENT

### EC-12: Singleton-scope controllers only in v0.1.0

- **Risco aceito:** T3.3 instantiates `new (Ctor as new () => any)()` ONCE per `registerControllers` call. NestJS supports request-scoped (`@Injectable({ scope: Scope.REQUEST })`) which builds a fresh instance per request. v0.1.0 ships singleton-only. Document in README "Limitations" section + Drawbacks table. Migration path: v0.2.0+ adds scope support via `@theokit/di` integration (already shipped sibling package).

### EC-13: Interceptor wrap can't skip `next()` (Pattern D3 declared simplification)

- **Risco aceito:** True NestJS Interceptor signature `intercept(context, next): Observable<T>` lets the interceptor DECIDE whether/when to call `next` (e.g., cache-hit short-circuit before calling `next`). Plan's T4.2 pseudo-code always calls `next(request)` first, then post-processes. This is a deliberate simplification consistent with Pattern D3's "(request, next) → Response wrap semantics". Document in README "Interceptor compatibility note" + add to migration guide (consumers using cache-style interceptors must hand-roll as `defineMiddleware`).

### EC-14: Handler returning `Response` makes `@HttpCode`/`@Header` no-ops

- **Risco aceito:** T3.3 pseudo-code `if (result instanceof Response) return result` short-circuits the `Response.json(result, {status, headers})` construction path. Means a handler that constructs its own `Response` bypasses `@HttpCode(204)` + `@Header(...)` decorators. NestJS has the same behavior with `@Res() passthrough: false`. Document in README "Response construction precedence" with the simple rule: "If your handler returns a `Response`, you own the status + headers — decorator-set status/headers are NOT merged in."

## Bonus minor item (SHOULD TEST tier — folded into existing T5.1)

### EC-15: CLI help string at `packages/theo/src/cli/index.ts:52` still says "route, action, page, or ws"

- **Task afetada:** T5.1
- **Teste sugerido:** `test_cli_help_string_lists_5_verbs` — Given `theokit generate --help` invoked, Then output includes the literal string `controller` alongside the other 4 verbs. Verified at `packages/theo/src/cli/index.ts:52` `'Generate a route, action, page, or ws endpoint'` → `'Generate a route, action, page, ws, or controller endpoint'`. Add to T5.1 Files to edit list.

## Resumo

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------|----------|-------------|----------|
| T1.2 | 1 | 0 | 1 (EC-11) | 0 |
| T1.5 | 1 | 0 | 1 (EC-6) | 0 |
| T2.1 | 1 | 0 | 1 (EC-7) | 0 |
| T3.2 | 4 | 3 (EC-2, EC-3, EC-4) | 1 (EC-8) | 0 |
| T3.3 | 3 | 2 (EC-1, EC-5) | 0 | 1 (EC-12) |
| T4.1 | 1 | 0 | 1 (EC-9) | 0 |
| T4.2 | 2 | 0 | 1 (EC-10) | 1 (EC-13) |
| T5.1 | 1 | 0 | 1 (EC-15) | 0 |
| Cross-cutting (T3.3 return value) | 1 | 0 | 0 | 1 (EC-14) |

**Total distinct edge cases: 14.** (EC-1 affects the whole bridge — counted once on T3.3 but its impact cascades.)

**Veredicto:** **PLANO PRECISA DE AJUSTE (5 MUST FIX items)**

The 5 MUST FIX items are NOT cosmetic — EC-1 in particular is structural: the plan's `registerControllers` API as designed has no mount mechanism, making the entire bridge inert. EC-4 is a silent data-validation bypass with security implications. EC-2 + EC-3 + EC-5 are DX foot-guns that surface in the first 10 minutes of consumer use.

## Next steps

1. **Bump plan to v1.1** absorbing the 5 MUST FIX items:
   - Add ADR D7 picking ONE of the 3 mount-mechanism paths in EC-1 (recommended: strategy a — `.theo-decorators-cache/` + Vite plugin emission).
   - Add RED tests for EC-2 (missing @Controller), EC-3 (path joining), EC-4 (missing emitDecoratorMetadata), EC-5 (duplicate registration) to the relevant TDD blocks.
   - Update `walkControllerMetadata` + `joinPath` + `registerControllers` pseudo-code accordingly.
2. **Absorb the 6 SHOULD TEST items** as additional RED tests in the corresponding TDD blocks of T1.2, T1.5, T2.1, T3.2, T4.1, T4.2, T5.1.
3. **Absorb the 3 DOCUMENT items** as explicit subsections in T6.1's README + migration guide.
4. **Run `/plan-confidence theokit-http-decorators-v0-1-0`** on v1.1 to verify structural quality before `/implement`.
