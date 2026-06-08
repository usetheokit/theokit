# Blueprint: TheoKit HTTP Decorators Pattern (NestJS as primary reference)

> **Version 0.1 (in-progress)** — Synthesizes NestJS Controllers chapter spec + Fastify routing dispatch + Hono chain pattern + TheoKit's current `defineRoute` API. Informs the v0.1.0 design of the planned `@theokit/http-decorators` package (P3 backend DX per macro CLAUDE.md).

**Slug:** `theokit-http-decorators-pattern-from-nestjs`
**Source plan:** `.claude/knowledge-base/discoveries/plans/theokit-http-decorators-pattern-from-nestjs-plan.md` (v1.1)
**Owner:** paulohenriquevn
**Generated:** 2026-06-07 via `/discover-execute`
**Confidence verdict:** TBD (updated by `/discover-confidence` after blueprint completion)

## Context

The macro `../CLAUDE.md` § "Backend DX packages" declares `@theokit/http-decorators` as P3 backend DX — NestJS-style decorators (`@Controller`, `@Get`/`@Post`/`@Body`/`@Param`/etc.) on top of `defineRoute`, opt-in for teams migrating from NestJS. The user passed the canonical NestJS Controllers chapter as input to `/discover-plan` (iter 79), establishing the authoritative spec to mirror.

## Objective

Decide the v0.1.0 API surface of `@theokit/http-decorators`: which NestJS decorators to support, the DTO↔Zod bridge mechanism, the middleware-vs-Guards mapping, the dependency cost, and the CLI generator extension.

---

## Coverage Corner 1 — Integration Tests

### NestJS test convention (per user-provided spec + general knowledge)

NestJS testing uses `@nestjs/testing` package's `Test.createTestingModule({...})` builder + `supertest` for HTTP integration:

```typescript
// canonical NestJS controller test
import { Test, TestingModule } from '@nestjs/testing'
import * as request from 'supertest'
import { INestApplication } from '@nestjs/common'
import { CatsController } from './cats.controller'

describe('CatsController (e2e)', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [CatsController],
      providers: [/* mock or real services */],
    }).compile()
    app = moduleRef.createNestApplication()
    await app.init()
  })

  it('/GET cats', () => {
    return request(app.getHttpServer())
      .get('/cats')
      .expect(200)
      .expect('This action returns all cats')
  })

  afterAll(async () => await app.close())
})
```

Key shape:
- `Test.createTestingModule` builds a DI-resolved test module (replaces the full `@Module`)
- `app.createNestApplication()` boots a full HTTP server (real Express/Fastify under the hood)
- `supertest(app.getHttpServer())` provides fluent HTTP assertions
- `app.close()` shutdown in `afterAll`

### TheoKit current test convention (`tests/integration/api-middleware-coverage.test.ts:1-40` + `tests/integration/onda5-mandatory.test.ts:1-25`)

TheoKit uses **two complementary patterns**:

**Pattern 1 — Mock-Vite middleware unit test** (`tests/integration/api-middleware-coverage.test.ts`):
- Mocks only `vite.ssrLoadModule` via vitest `vi.fn()`
- Builds `IncomingMessage` + `ServerResponse` manually (`makeReq()`, `makeRes()` helpers)
- Calls `createApiMiddleware(...)` directly with the mock vite + tmp server dir
- Sub-100ms per spec (no real HTTP server boot), targets uncovered branches (rate-limit 429, batch endpoint, suggestion path)

**Pattern 2 — Real boundary smoke** (`tests/integration/onda5-mandatory.test.ts`):
- Calls `startDevServer(fixtureDir, { port: 0 })` to spin a REAL dev server on random port
- Uses native `fetch(http://localhost:${port}/...)` (NOT supertest)
- Asserts via `expect(res.status).toBe(200)` + `await res.json()`
- `server.close()` in `afterAll`
- Fixture project lives under `fixtures/{fixture-name}/`

### Bridge for `@theokit/http-decorators` v0.1.0

| Concern | NestJS | TheoKit `@theokit/http-decorators` |
|---|---|---|
| Test runner | jest (default) | **vitest** (TheoKit standard per testing.md rule) |
| Module composition | `Test.createTestingModule({ controllers, providers })` | **NOT NEEDED** — bridge generates `defineRoute(...)` files; tests target generated files directly via Pattern 2 (real boundary smoke) |
| HTTP assertion | `supertest(app.getHttpServer()).get('/cats').expect(200)` | **native `fetch()`** per existing TheoKit pattern (per Rule 9 "don't reinvent" — supertest adds a dep with no benefit over native fetch) |
| Controller mounting | `app.createNestApplication()` | `startDevServer(fixtureDir, { port: 0 })` |
| Provider mock | `.overrideProvider(X).useValue(mock)` | Standard vitest `vi.mock()` of imported modules |
| Per-test fixture | One TestingModule per describe | One `fixtures/{name}/` dir per controller surface |

#### Recommendation per Rule 9 (Don't Reinvent the Wheel)

**v0.1.0 ships ZERO new test infrastructure.** Users test `@theokit/http-decorators` controllers via the existing Pattern 2 (real boundary smoke against the auto-generated `defineRoute` files):

```typescript
// User's controller (with decorators)
@Controller('cats')
export class CatsController {
  @Get()
  findAll() { return 'all cats' }
}

// User's test (uses existing TheoKit Pattern 2)
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startDevServer } from 'theokit/server/testing'
import path from 'node:path'

describe('CatsController integration', () => {
  let server, port

  beforeAll(async () => {
    server = await startDevServer(path.join('fixtures', 'cats-controller'), { port: 0 })
    port = server.httpServer!.address().port
  })

  it('GET /cats returns all', async () => {
    const res = await fetch(`http://localhost:${port}/cats`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('all cats')
  })

  afterAll(async () => await server?.close())
})
```

#### Conclusion for Q4

**No new test harness in v0.1.0.** Pattern 2 (real boundary smoke via `startDevServer` + native `fetch`) covers the decorator-generated routes identically to how it covers `defineRoute`-authored routes. Users migrating from NestJS swap `Test.createTestingModule` → `startDevServer` and `supertest` → `fetch`. Documentation guide ships with v0.1.0 showing the migration. Honest finding: the bridge layer DOES need contract tests itself (decorator metadata → generated `defineRoute` shape), shipped in `@theokit/http-decorators/tests/contract.test.ts`.

---

## Coverage Corner 2 — Dependencies

### NestJS-style decorator runtime cost

#### Pre-validated state at HEAD (per plan Q5 § PRE-VALIDATED STATE + EC-3)

| Probe | Result | Source |
|---|---|---|
| `experimentalDecorators` in `packages/theo/tsconfig.json` | NOT present (0 hits) | grep verification iter 2026-06-07 |
| `emitDecoratorMetadata` in `packages/theo/tsconfig.json` | NOT present (0 hits) | grep verification iter 2026-06-07 |
| `experimentalDecorators` in root `tsconfig.json` | NOT present | `tsconfig.json:1-22` (cf. `.claude/knowledge-base/references/fastify/fastify.d.ts` for comparison; Fastify ships `.d.ts` instead of `tsconfig.json` — uses plain JS source) — only target/module/strict + paths |
| `target` in root tsconfig | `ES2022` | `tsconfig.json:3` |
| `module` in root tsconfig | `ESNext` | `tsconfig.json:4` |
| `reflect-metadata` anywhere in deps tree | NOT present (0 hits) | grep -l verification across all package.json |
| TheoKit base tsconfig file (`tsconfig.base.json`) | DOES NOT EXIST | `ls tsconfig*.json` returns only `tsconfig.json` |

**Implication:** the new `@theokit/http-decorators` package OWNS decorator-related config in its OWN tsconfig (NOT in core's tsconfig). Decorators are an OPT-IN surface; non-decorator consumers continue with the current factory-function `defineRoute` API + zero new deps.

#### Dependency table for v0.1.0

| Dependency | Current state | Required state for `@theokit/http-decorators` v0.1.0 | Bundle delta on consumer apps that opt in |
|---|---|---|---|
| `reflect-metadata@^0.2.2` | NOT installed | **peer dep** of `@theokit/http-decorators` (consumer installs); imported at the consumer's bootstrap once (`import 'reflect-metadata'`) | ~3KB minified + gzipped at consumer build time |
| `@theokit/http-decorators@0.1.0` | Doesn't exist yet | NEW package — declares its OWN `tsconfig.json` with `experimentalDecorators: true` + `emitDecoratorMetadata: true` | depends on package size at publish; estimated ~5-10KB minified (small surface) |
| `class-validator@^0.14` | NOT installed | **OPTIONAL peer dep** — only required if user uses `class-validator` decorators on DTOs (per Q2 strategy b: not required, since explicit Zod is canonical path) | 0KB if user follows Q2 strategy b (explicit Zod); ~22KB if user opts into class-validator codemod path |
| `class-transformer@^0.5` | NOT installed | **OPTIONAL peer dep** — needed alongside class-validator for `@ValidateNested` instance hydration | 0KB if user uses Zod schema |

#### Consumer-app tsconfig delta

Users opting into `@theokit/http-decorators` add to their `tsconfig.json`:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

**No change required to `packages/theo/tsconfig.json` or root `tsconfig.json`.** TheoKit core remains decorator-free.

#### Stage-3 vs Legacy decorators (per ADR-D3 + ADR-D6 — 30min cap honored)

| Aspect | TC39 Stage-3 (TS 5.x native) | Legacy (`experimentalDecorators`) |
|---|---|---|
| TS support | Stable since TS 5.0 (March 2023) | Stable since TS 1.5 (2015) |
| `emitDecoratorMetadata` runtime type emission | **NOT supported** — Stage-3 spec deliberately excludes runtime type emit | **Supported** — emits `Reflect.metadata('design:paramtypes', [...])` per method param |
| `reflect-metadata` requirement | NOT applicable | Required as peer dep |
| NestJS itself | Uses Legacy (still as of mid-2026) | — |
| `@Body() body: CreateCatDto` runtime DTO injection | **NOT possible** in pure Stage-3 — would require parsing decorator AST at build time + emitting metadata via a custom transformer (e.g., `unplugin-typescript-transform-paths` family) | **Works** — `Reflect.getMetadata('design:paramtypes', ...)` returns the class reference at runtime |

**Decision (per ADR-D6):** `@theokit/http-decorators` v0.1.0 ships **Legacy** decorators. Documented migration path: when TC39 advances Stage-3 metadata emit AND TS 6.x ships compatible support, a v0.2.0+ release re-evaluates. Per Q5 pre-validated state: this is consumer-app-side migration only; core TheoKit unaffected.

#### Honest bundle sizing

For a consumer app that opts into `@theokit/http-decorators`:
- `reflect-metadata` ~3KB gzipped (peer dep)
- `@theokit/http-decorators` ~5-10KB gzipped (estimated; new package, not yet built)
- Total added: **~8-13KB gzipped** to the consumer's runtime bundle (production)
- Build-time: tsc with `emitDecoratorMetadata: true` adds ~5-15% compile time per Microsoft TypeScript perf docs (acceptable for opt-in)

For a consumer app that does NOT opt in: **0 KB delta**. The factory-function `defineRoute` path remains primary.

#### Conclusion for Q5

`@theokit/http-decorators` v0.1.0 ships as a NEW package with:
- `reflect-metadata` declared as required peer dep
- `class-validator` + `class-transformer` declared as OPTIONAL peer deps (only if user opts into class-validator codemod path)
- Its own tsconfig with `experimentalDecorators` + `emitDecoratorMetadata` enabled
- Consumer app tsconfig delta: 2 lines (the same two flags)
- Total opt-in bundle cost: ~8-13KB gzipped
- TheoKit core: **0 changes** to tsconfig or deps (per pre-validated state — decorators are opt-in only)

This aligns with type-safety.md rule "Zod is the Single Source of Truth" (Zod schema attached via `static schema` per Q2 strategy b — class-validator codemod is opt-in only).

---

## Coverage Corner 3 — Tools

### CLI generator extension proposal

#### NestJS CLI shape (per user-provided spec)

NestJS ships `@nestjs/cli` with the canonical scaffold:

```bash
$ nest g controller cats     # generates src/cats/cats.controller.ts + spec + module wiring
$ nest g service cats         # generates src/cats/cats.service.ts
$ nest g module cats          # generates src/cats/cats.module.ts
$ nest g resource cats        # generates ALL of the above + DTOs + CRUD methods
```

The `nest g controller` scaffold emits a class skeleton with `@Controller('cats')` + one sample `@Get()` method + automatic wiring into the parent `@Module({ controllers: [CatsController] })`.

#### TheoKit current `theokit generate` shape (`packages/theo/src/cli/commands/generate.ts:9-11` + `:124-141`)

```typescript
export const VALID_TYPES = ['route', 'action', 'page', 'ws'] as const
```

Current verbs:
- `theokit generate route <name>` → writes `server/routes/<name>.ts` via `generateRouteTemplate(name)` (`generate.ts:129`)
- `theokit generate action <name>` → writes `server/actions/<name>.ts` + co-located test (`generate.ts:134, 262`)
- `theokit generate page <name>` → writes `app/<name>/page.tsx` (`generate.ts:137`)
- `theokit generate ws <name>` → writes `server/ws/<name>.ts` (`generate.ts:141`)

Templates are **inline TypeScript string functions** (`generateRouteTemplate(name)`, etc.) inside the same file — NOT separate `.tmpl` files. Inline-string strategy keeps the generator simple + deterministic + ~150 LOC total per generator.

#### Bridge proposal for `@theokit/http-decorators` v0.1.0

| NestJS verb | `@theokit/http-decorators` v0.1.0 equivalent | Output | Mechanism |
|---|---|---|---|
| `nest g controller cats` | `theokit generate controller cats` (new verb) | `server/controllers/cats.controller.ts` with `@Controller('cats')` class + 1 sample `@Get()` | Extend `VALID_TYPES` (`generate.ts:9`) from 4 → 5; add `generateControllerTemplate(name)` inline function; add resolver entry in switch table (`generate.ts:124-141`) |
| `nest g service cats` | NOT shipped in v0.1.0 — out of HTTP-decorators scope per ADR-D4 | — | DI service surface delegated to `@theokit/di` per ADR-D4 |
| `nest g module cats` | NOT shipped in v0.1.0 — out of scope per ADR-D4 | — | Module surface deferred |
| `nest g resource cats` (CRUD scaffold) | DEFERRED to v0.2.0+ — needs Q2 DTO bridge + Q3 Guards/Interceptors first | — | v0.2.0 scoped — emits 1 controller class + 1 DTO class + 5 CRUD methods (`@Get`/`@Post`/`@Put`/`@Patch`/`@Delete`) |

#### Worked example: `theokit generate controller cats`

```bash
$ theokit generate controller cats
  ✓ Created controller: /home/.../server/controllers/cats.controller.ts
```

Generated file (`server/controllers/cats.controller.ts`):

```typescript
// AUTO-GENERATED by `theokit generate controller cats`
// Bridge: at build time, this controller's decorators are walked by
// @theokit/http-decorators/bridge and emitted as server/routes/cats/*.ts
// per Q1 dispatch contract.
import { Controller, Get } from '@theokit/http-decorators'

@Controller('cats')
export class CatsController {
  @Get()
  findAll(): string {
    return 'This action returns all cats'
  }
}
```

Template implementation (inline in `generate.ts`, mirrors existing pattern at `:129`):

```typescript
function generateControllerTemplate(name: string): string {
  const className = toPascalCase(name) + 'Controller'  // 'cats' → 'CatsController'
  return `import { Controller, Get } from '@theokit/http-decorators'

@Controller('${name}')
export class ${className} {
  @Get()
  findAll(): string {
    return 'This action returns all ${name}'
  }
}
`
}
```

#### Packaging decision: extend `theokit generate` vs separate package

| Option | Pro | Con |
|---|---|---|
| **(a) Extend `theokit generate controller`** (verb added to existing CLI) | (i) Discoverable — users find it via `theokit generate --help`; (ii) consistent shape with other verbs; (iii) ~30 LOC addition to `generate.ts` | requires core `theokit` to know about `@theokit/http-decorators` (slight coupling) |
| **(b) Ship as separate `@theokit/http-decorators-cli` package** | core stays decoupled | (i) extra install; (ii) less discoverable; (iii) duplicates template-resolution + validation infrastructure already in `generate.ts` |

**Recommendation:** **Strategy (a) extend `theokit generate`** — the coupling is acceptable because (i) the addition is a SINGLE entry in `VALID_TYPES` array + ONE template function; (ii) the `controller` verb GENERATES code that imports from `@theokit/http-decorators` but doesn't require it to be installed at generate-time (file-emission only); (iii) consumers see one CLI surface, not two. The minor coupling is documented as "non-runtime — core knows the controller verb exists, but doesn't link any code from `@theokit/http-decorators`".

#### Conclusion for Q6

`@theokit/http-decorators` v0.1.0 ships with **one CLI extension**: `theokit generate controller <name>` added to existing `VALID_TYPES` in `packages/theo/src/cli/commands/generate.ts`. Single new template function `generateControllerTemplate(name)` mirroring existing pattern. NO separate CLI package needed. `nest g resource` (CRUD scaffold) deferred to v0.2.0+ since it needs Q2 DTO bridge + Q3 Guards/Interceptors first.

---

## Coverage Corner 4 — Techniques

### Q1 — NestJS internal dispatch pipeline (decorator → handler invocation)

#### NestJS decorator stack (per user-provided spec)

NestJS Controllers chapter declares this decorator stack for each HTTP endpoint:

1. **Class-level** — `@Controller('cats')` declares a route-prefix scope. Optional `{ host: ':account.example.com' }` adds host-matching constraint.
2. **Method-level HTTP-verb decorator** — one of `@Get()`, `@Post()`, `@Put()`, `@Patch()`, `@Delete()`, `@Options()`, `@Head()`, `@All()`. Each takes an optional sub-path (`@Get('breed')` → `GET /cats/breed`). `@All()` matches every HTTP method.
3. **Response shape decorators** — `@HttpCode(204)` overrides default status (200 for non-POST, 201 for POST). `@Header('Cache-Control', 'no-store')` sets a response header. `@Redirect(url, statusCode = 302)` short-circuits to a redirect.
4. **Parameter decorators** — applied to method parameters; pull from the platform Request:
   - `@Req()` → full `req` object
   - `@Res({ passthrough?: boolean })` → full `res` object (puts handler in library-specific mode unless `passthrough: true`)
   - `@Next()` → `next` function
   - `@Session()` → `req.session`
   - `@Param(key?)` → `req.params` or `req.params[key]`
   - `@Body(key?)` → `req.body` or `req.body[key]`
   - `@Query(key?)` → `req.query` or `req.query[key]`
   - `@Headers(name?)` → `req.headers` or `req.headers[name]`
   - `@Ip()` → `req.ip`
   - `@HostParam(key?)` → `req.hosts[key]`

#### Dispatch internals (NestJS reflect-metadata model — per user-provided spec)

NestJS uses **TypeScript Legacy decorators** (`experimentalDecorators` + `emitDecoratorMetadata`) backed by `reflect-metadata`. The `@Controller`, `@Get`, `@Param`, `@Body` decorators are *metadata writers*: they call `Reflect.defineMetadata(KEY, value, target)` to attach routing + parameter-source info to the class prototype. At bootstrap, NestFactory walks all `controllers: [...]` in the `@Module` declaration, reads the attached metadata via `Reflect.getMetadata(KEY, target)`, constructs an Express/Fastify route per (controller, method) pair, and wires the parameter-extraction pipeline.

The runtime invocation per request:

```
[Express/Fastify request arrives]
  → route lookup (path + method + host) via underlying router
  → NestJS's internal RouterProxy invokes the handler:
     1. Resolve provider DI (skipped here per ADR-D4)
     2. Execute Guards (canActivate boolean check) [per ADR-D5 — light treatment]
     3. Run pre-Interceptors (`intercept(context, next)`)
     4. Run Pipes (DTO validation/transform via `metatype` introspection)
     5. Call user method with extracted parameter values
     6. Run post-Interceptors
     7. Serialize return value (default: JSON if object/array; primitives sent raw)
  → response sent (status 200 default; 201 for POST; overridden by @HttpCode)
```

#### Fastify dispatch comparison (`fastify/lib/handle-request.js`)

For comparison, Fastify's dispatch (per `.claude/knowledge-base/references/fastify/lib/route.js:120` + `handle-request.js:20`):

- `router.lookup.bind(router)` resolves the route (find-my-way router, NOT decorator-based).
- `handle-request.js:20` `handleRequest(err, request, reply)` orchestrates: preValidation hooks → validation → preHandler hooks (via `preHandlerHookRunner` at line 6) → handler call.
- Fastify uses **plain function handlers** with the `(request, reply) => { ... }` shape. Decorators in Fastify's vocabulary (`app.decorate(name, fn)` via `lib/decorate.js:77`) extend the `app`/`request`/`reply` instance with custom methods — fundamentally different from NestJS's metadata-driven controller dispatch.

**Key insight:** Fastify is the imperative-handler model; NestJS is the metadata-driven controller model. TheoKit's `defineRoute` sits closer to Fastify's imperative shape (identity-function over a typed config object).

#### TheoKit `defineRoute` current shape (`packages/theo/src/server/define/define-route.ts:14-25`)

```typescript
export function defineRoute<TQuery, TBody, TParams, TCtx, TResponse>(
  config: RouteConfig<TQuery, TBody, TParams, TCtx, TResponse>,
): RouteConfig<...> {
  return config  // identity function for TS type inference
}
```

The `RouteConfig` contract (`packages/theo/src/core/contracts/route-config.ts:14-40`) is:

- `query?: TQuery` (Zod schema)
- `body?: TBody` (Zod schema)
- `params?: TParams` (Zod schema)
- `status?: number` (response status code)
- `csrf?: false` (per-route CSRF opt-out)
- `handler: (ctx) => TResponse` (handler with extracted `{query, body, params, ...ctx}`)

The route file's path is convention-based (file-system routing per architecture.md v3.1 — e.g., `server/routes/cats/[id].ts`), NOT decorator-prefix-based.

#### Mapping table: NestJS decorator → TheoKit `defineRoute` field

| NestJS decorator | TheoKit equivalent | Bridge mechanism in `@theokit/http-decorators` |
|---|---|---|
| `@Controller('cats')` class | File path `server/routes/cats/...` | Bridge: class-name + `@Controller('prefix')` emits files OR registers virtual routes at startup. **Decision pending Q6 — CLI generator.** |
| `@Get()`, `@Post()`, `@Put()`, `@Patch()`, `@Delete()` method | HTTP method in `defineRoute({ method, ...})` OR file-name suffix | Bridge: each `@Get`/`@Post`/etc. method becomes a separate `defineRoute({...})` call wired via metadata at startup. |
| `@Options()`, `@Head()` | Not currently in `defineRoute` first-class | v0.1.0: emit as plain handler with `method` field; v0.2.0+: first-class. |
| `@All()` | Multiple `defineRoute` exports per HTTP method | Bridge: expand into all 7 verbs at metadata-walk time. |
| `@HttpCode(204)` | `status: 204` in `defineRoute` config | Direct field mapping. |
| `@Header('Cache-Control', 'no-store')` | Not in `defineRoute`; would set via `ctx.response.headers.set(...)` | v0.1.0: bridge collects all `@Header` decorators per method + applies in a wrapper that calls handler. |
| `@Redirect('https://...', 301)` | Handler returns redirect Response | v0.1.0: bridge generates handler that returns `Response.redirect(url, status)`. |
| `@Body() body: CreateCatDto` | `body: zCreateCat` Zod schema | **Q2 — DTO↔Zod bridge — decision pending.** |
| `@Body(key) value: T` | `body.[key]` access in handler | v0.1.0: bridge generates handler that reads `body[key]`. |
| `@Query() query: ListAllEntities` | `query: zList` Zod schema | Same as `@Body` — Q2 applies. |
| `@Param('id') id: string` | `params.id` access in handler | Direct: `params: z.object({ id: z.string() })` + handler reads `ctx.params.id`. |
| `@Headers(name)` | `ctx.request.headers.get(name)` | Bridge generates handler that reads from `ctx.request.headers`. |
| `@Req() request: Request` | `ctx.request` | Direct: TheoKit's ctx exposes the Web `Request` per T5a.2 R3a refactor (Phase 5a). |
| `@Res({ passthrough?: boolean })` | `ctx.response` | Bridge: `passthrough: true` → handler returns value, framework serializes; `passthrough: false` → handler must return `Response` directly. Maps to TheoKit's existing dual-return contract. |
| `@Session() session: T` | `ctx.session` | TheoKit's `createSessionManager` already provides `ctx.session` typed. |
| `@Ip() ip: string` | `ctx.request.headers.get('x-forwarded-for')` OR adapter-provided | Bridge: convention call to adapter. |
| `@HostParam('account')` | Not currently supported | v0.1.0: deferred — host-based routing requires adapter support. v0.2.0+: first-class via adapter contract. |

#### 5 worked examples (one per common shape)

**GET (`@Get()`):**

```typescript
// NestJS
@Controller('cats')
class CatsController {
  @Get()
  findAll(): string { return 'This action returns all cats' }
}

// TheoKit equivalent (today, factory function)
// server/routes/cats/index.ts
import { defineRoute } from 'theokit/server'
export const GET = defineRoute({
  handler: () => 'This action returns all cats',
})

// @theokit/http-decorators (proposed v0.1.0)
// server/controllers/cats.controller.ts
import { Controller, Get } from '@theokit/http-decorators'
@Controller('cats')
export class CatsController {
  @Get()
  findAll(): string { return 'This action returns all cats' }
}
// (bridge wires CatsController → server/routes/cats/index.ts at build time)
```

**POST with @Body() DTO:**

```typescript
// NestJS
@Post()
async create(@Body() createCatDto: CreateCatDto) { return 'added' }

// TheoKit (today)
// server/routes/cats/index.ts
export const POST = defineRoute({
  body: z.object({ name: z.string(), age: z.number(), breed: z.string() }),
  handler: ({ body }) => 'added',
})

// @theokit/http-decorators (v0.1.0 — pending Q2 DTO↔Zod decision)
@Post()
async create(@Body() createCatDto: CreateCatDto) { return 'added' }
// — class-validator decorators in CreateCatDto translate to Zod schema (or user supplies both)
```

**PUT with @Param:**

```typescript
// NestJS
@Put(':id')
update(@Param('id') id: string, @Body() updateCatDto: UpdateCatDto) { ... }

// TheoKit (today)
// server/routes/cats/[id].ts
export const PUT = defineRoute({
  params: z.object({ id: z.string() }),
  body: z.object({ /* ... */ }),
  handler: ({ params, body }) => `updated ${params.id}`,
})
```

**DELETE with @HttpCode:**

```typescript
// NestJS
@Delete(':id')
@HttpCode(204)
remove(@Param('id') id: string) { ... }

// TheoKit (today)
export const DELETE = defineRoute({
  status: 204,
  params: z.object({ id: z.string() }),
  handler: ({ params }) => { /* delete */ },
})
```

**GET with @Query + @Header:**

```typescript
// NestJS
@Get()
@Header('Cache-Control', 'no-store')
async findAll(@Query('age') age: number, @Query('breed') breed: string) { ... }

// TheoKit (today — header set via response object)
export const GET = defineRoute({
  query: z.object({ age: z.coerce.number(), breed: z.string() }),
  handler: ({ query }) => {
    return new Response(JSON.stringify({ /* ... */ }), {
      status: 200,
      headers: { 'Cache-Control': 'no-store', 'content-type': 'application/json' },
    })
  },
})
```

#### Conclusion for Q1

**The bridge mechanism in `@theokit/http-decorators` is a build-time AST transform** (or runtime bootstrap walk) that reads the decorator metadata via `reflect-metadata`, generates one `defineRoute(...)` config per `@Get`/`@Post`/etc. method, and either:
- (a) emits `server/routes/{...}/index.ts` files at build time (file-system-routing alignment), OR
- (b) registers virtual routes at startup via a `registerControllers([...])` API.

Decision (a) vs (b) is deferred to the `/to-plan @theokit/http-decorators` cycle — Q1's job is to map the surface, not pick the implementation strategy.

### Q2 — DTO class → Zod schema bridge

#### NestJS DTO contract (per user-provided spec)

NestJS DTOs are **TypeScript classes** (NOT interfaces — explicitly stated by user-provided spec because "interfaces are removed during transpilation"). Classes survive transpilation as real entities, which Pipes need for `metatype` runtime access. The canonical example:

```typescript
export class CreateCatDto {
  name: string
  age: number
  breed: string
}
```

Validation in NestJS uses `class-validator` decorators (NOT in user-provided spec but documented at `docs.nestjs.com/techniques/validation` — fallback per EC-2):

```typescript
import { IsString, Min, Length } from 'class-validator'
export class CreateCatDto {
  @IsString()
  @Length(2, 50)
  name: string

  @Min(0)
  age: number

  @IsString()
  breed: string
}
```

The `ValidationPipe` reads decorator metadata via `reflect-metadata`, builds a validator at runtime, and rejects requests that fail.

#### TheoKit Zod contract (`packages/theo/src/server/http/action-execute.ts:34-59`)

TheoKit uses a **minimal Zod-shaped structural contract** (NOT the full Zod API):

```typescript
interface ZodLike {
  safeParse: (value: unknown) => {
    success: boolean
    data?: unknown
    error?: { issues: z.ZodIssue[] }
  }
}
```

Per `.claude/rules/type-safety.md` "Zod is the Single Source of Truth": schema defined ONCE in Zod, types derived via `z.infer<typeof schema>`, runtime validation from the SAME schema, OpenAPI generated from the SAME schema. The factory-function call `defineRoute({ body: zCreateCat, handler: ({ body }) => ... })` produces typed `body: z.infer<typeof zCreateCat>` for the handler.

Parsing at the boundary uses `actionConfig.input.safeParse(bodyOutcome.body)` (`action-execute.ts:361`).

#### Decision tree: auto-bridge vs explicit

| Strategy | Mechanism | Pro | Con |
|---|---|---|---|
| **(a) Auto-bridge DTO class → Zod schema at runtime** | Bridge reads `Reflect.getMetadata('design:paramtypes', target, methodName)` + class-validator decorator metadata + auto-generates a Zod schema at startup | Mirrors NestJS migration ergonomics 1:1 — devs paste their existing DTOs + class-validator decorators and it Just Works | (i) class-validator decorators DON'T map 1:1 to Zod (`@Matches(regex)` vs `z.string().regex()` differ on capture groups + flags; `@ValidateNested` vs `z.lazy()` differ on inference); (ii) loses TheoKit's "Zod is the Single Source of Truth" invariant — Zod is no longer the source, it's a derivation; (iii) OpenAPI generation (per G2) would lose precision for advanced decorator semantics |
| **(b) Explicit — user supplies BOTH DTO class (for type) + Zod schema (for validation)** | User writes `class CreateCatDto extends Z.classOf(zCreateCat) {}` OR `class CreateCatDto { static schema = z.object({...}) }`. Bridge reads the static schema and feeds it to `defineRoute` | (i) Preserves "Zod is SSoT" invariant; (ii) no decorator-semantic translation errors; (iii) OpenAPI precision retained; (iv) class still satisfies Pipes-style `metatype` for compatibility | Higher migration friction — NestJS teams must convert class-validator decorators to Zod by hand (1-time cost) |

**Recommendation:** **Strategy (b) explicit** for v0.1.0, with optional `@theokit/http-decorators-class-validator-codemod` as a separate package shipped alongside that translates ~80% of class-validator decorators to Zod schemas automatically (one-time codemod, NOT runtime bridge). Strategy (b) accomplishes:

1. Preserves Zod SSoT invariant (per type-safety.md rule)
2. Avoids the 1:1 mapping trap
3. Provides a migration on-ramp for NestJS teams (codemod handles common cases; manual cleanup for the long tail)
4. Keeps OpenAPI generation precise (G2 plugin still gets pure Zod schemas)

#### Worked example (strategy b)

```typescript
// @theokit/http-decorators v0.1.0
import { z } from 'zod'
import { Controller, Post, Body } from '@theokit/http-decorators'

const zCreateCat = z.object({
  name: z.string().min(2).max(50),
  age: z.number().min(0),
  breed: z.string(),
})

class CreateCatDto {
  static schema = zCreateCat
}
type CreateCatDto = z.infer<typeof zCreateCat>  // structural type for handler

@Controller('cats')
export class CatsController {
  @Post()
  async create(@Body() createCatDto: CreateCatDto) {
    return `added ${createCatDto.name}`
  }
}

// Bridge generates (effectively):
// export const POST = defineRoute({
//   body: zCreateCat,
//   handler: ({ body }) => `added ${body.name}`,
// })
```

#### Honest limitations of any DTO↔Zod bridge

1. **class-validator's `@Matches(regex, modifiers)`** vs Zod's `z.string().regex(regex)` — modifiers differ; the bridge MUST normalize or document the gap.
2. **Nested DTOs via `@ValidateNested + @Type(() => OtherDto)`** vs Zod's `z.lazy(() => zOther)` — class-validator uses `class-transformer` for instance hydration; Zod produces plain objects. Bridge MUST decide: hydrate to class instances post-validation (breaks Zod SSoT for the result type) OR keep plain objects (breaks NestJS-style class-method calls on the DTO).
3. **`@Optional()`/`@IsOptional()`** vs `z.optional()` vs `z.nullable()` — semantically: NestJS "optional" allows undefined; Zod has both `optional` (undefined-allowed) and `nullable` (null-allowed) AND `nullish` (both). Bridge MUST pick a convention + document.
4. **Class methods on DTOs** (NestJS allows `createCatDto.fullDescription()`) — Zod produces plain objects. Bridge does NOT support DTO methods; users must extract behavior into pure functions.

These limitations make strategy (b) explicit superior — the user writes the Zod schema directly, knows exactly what they're getting.

#### Conclusion for Q2

v0.1.0 ships strategy (b) — explicit Zod schema attached via `static schema` on the DTO class. Codemod ships as separate optional package. Preserves type-safety.md "Zod is SSoT" invariant. Migration friction acknowledged + mitigated via codemod.

### Q3 — Guards/Interceptors vs `defineMiddleware`

Per plan ADR-D5: light treatment in v0.1.0 (1-paragraph + "v0.2.0+ follow-up `/discover-plan`"). Q1's NestJS dispatch pipeline (now COMPLETE — see Q1 conclusion above) provides the shared vocabulary needed per halt-loop checkpoint EC-4.

#### NestJS Guards + Interceptors (per user-provided spec context + general knowledge)

NestJS request pipeline (per Q1 dispatch section above):
```
request → router lookup → Guards (canActivate boolean) → Interceptors (pre) → Pipes → Handler → Interceptors (post) → Filters
```

- **Guards** (`@UseGuards(AuthGuard)`): pre-handler check returning `boolean | Promise<boolean>`. Throws `UnauthorizedException` if false. Stops the pipeline before Pipes/Handler run.
- **Interceptors** (`@UseInterceptors(LoggingInterceptor)`): wrap the handler call. `intercept(context, next): Observable<T>` — can run logic before AND after the handler, transform the response, swallow errors, etc.

#### TheoKit `defineMiddleware` shape (`packages/theo/src/server/define/define-middleware.ts:1-12`)

```typescript
export type MiddlewareHandler = (
  request: Request,
  next: (request: Request) => Promise<Response>,
) => Response | Promise<Response>

export function defineMiddleware(handler: MiddlewareHandler): MiddlewareHandler {
  return handler
}
```

TheoKit middleware is **single-pattern Chain of Responsibility** (per Phase 3 arch-review classification — `middleware-runner.ts:72` `runMiddlewareAndContext` and `:57` `runOneMiddleware`). Each middleware receives `(request, next)`. To run logic AFTER the handler, the middleware awaits `next(request)` and decorates the returned Response. The shape SUBSUMES both Guards (return Response early to short-circuit) AND Interceptors (await next + transform):

```typescript
// TheoKit middleware = Guard equivalent (short-circuit)
export const authGuard = defineMiddleware(async (request, next) => {
  const session = await getSession(request)
  if (!session) return new Response('Unauthorized', { status: 401 })
  return next(request)  // pipeline continues
})

// TheoKit middleware = Interceptor equivalent (wrap)
export const loggingInterceptor = defineMiddleware(async (request, next) => {
  const start = performance.now()
  const response = await next(request)
  console.log(`${request.method} ${request.url} → ${response.status} (${performance.now() - start}ms)`)
  return response
})
```

#### Bridge proposal for v0.1.0

| NestJS surface | `@theokit/http-decorators` v0.1.0 | Mechanism |
|---|---|---|
| `@UseGuards(AuthGuard)` method/class | Same decorator — translates to `defineMiddleware` wrap of the route handler | At metadata-walk time: collect all `@UseGuards` per method + emit a wrapping middleware that short-circuits on `canActivate=false` with the documented exception → HTTP-status mapping |
| `@UseInterceptors(LoggingInterceptor)` method/class | Same decorator — translates to `defineMiddleware` wrap | At metadata-walk time: collect all `@UseInterceptors` per method + emit a wrapping middleware that awaits the handler's response and applies `intercept(context, next).pipe(...)` semantics |
| `AuthGuard` class with `canActivate(context): boolean \| Promise<boolean>` | Class with `canActivate(request: Request): boolean \| Promise<boolean>` | Bridge passes `request` as `context.switchToHttp().getRequest()` equivalent |
| `LoggingInterceptor` class with `intercept(context, next): Observable<T>` | Class with `intercept(request, next): Promise<Response>` OR `Observable<Response>` (RxJS optional peer dep) | Bridge calls `intercept(request, () => next(request))` — Observable vs Promise both supported |
| `@Catch(HttpException)` Filter class | DEFERRED to v0.2.0+ (per ADR-D5) | v0.1.0: users wrap in `try/catch` inside the middleware OR rely on TheoKit's existing error middleware chain |

#### Sequence-diagram comparison

```
NestJS:                          TheoKit (factory-function today):
─────────                        ─────────────────────────────────
request                          request
  ↓                                ↓
[Guards canActivate]             [middleware chain item 1]
  ↓                                ↓ next(request)
[Interceptors pre]               [middleware chain item 2]
  ↓                                ↓ next(request)
[Pipes validate]                 [route handler — Zod validates]
  ↓                                ↓ Response
[Handler]                        [middleware chain item 2 post-processing]
  ↓                                ↓ Response
[Interceptors post]              [middleware chain item 1 post-processing]
  ↓                                ↓ Response
[Filters on error]               [error middleware on throw]
  ↓                                ↓
response                         response
```

**Key insight:** TheoKit's `MiddlewareHandler` is a SUPER-SET of both NestJS Guards AND Interceptors — the `(request, next) → Response` shape gives you both pre-check (return early) and post-wrap (await next + transform). The bridge in `@theokit/http-decorators` simply maps NestJS's separated concepts back to TheoKit's unified middleware shape.

#### Conclusion for Q3

`@theokit/http-decorators` v0.1.0 supports `@UseGuards` + `@UseInterceptors` by translating each to a TheoKit `defineMiddleware` wrap at metadata-walk time. The unified `(request, next) → Response` shape makes the bridge mechanical. `@Catch` Filter class deferred to v0.2.0 (per ADR-D5 light treatment). Pipes' validation role is already covered by TheoKit's Zod schema in `defineRoute({ body, query, params })` — no separate Pipe surface needed in v0.1.0.

---

## Cross-cutting Comparison

Side-by-side mapping across all 4 reference inputs synthesizes the bridge decisions:

| Concern | NestJS (user-provided spec) | Fastify (`.claude/knowledge-base/references/fastify/`) | Hono (`.claude/knowledge-base/references/hono/`) | TheoKit current (`packages/theo/src/server/define/`) | `@theokit/http-decorators` v0.1.0 |
|---|---|---|---|---|---|
| **Routing model** | Class + decorator metadata (`@Controller`/`@Get` write to `reflect-metadata`) | Imperative `app.get(path, handler)` (router-driven) — see `fastify/lib/route.js:120` | Chain pattern `app.get(path, handler).post(path, handler)` (per `.claude/knowledge-base/references/hono/src/hono.ts`) | File-system convention `server/routes/{path}.ts` + factory `defineRoute({...})` — see `packages/theo/src/server/define/define-route.ts:14` | Bridge: walks decorator metadata → emits `defineRoute(...)` per `@Get`/`@Post`/etc. |
| **Request handler shape** | Class method with parameter decorators (`@Body()`, `@Param()`) | `(request, reply) => { ... }` plain function — see `.claude/knowledge-base/references/fastify/lib/handle-request.js:20` | `(c) => c.json(...)` context-object (per `.claude/knowledge-base/references/hono/src/context.ts`) | `({query, body, params, ctx}) => Response \| value` — see `packages/theo/src/core/contracts/route-config.ts:30` | Bridge: maps decorated params to ctx-destructured handler at metadata-walk time |
| **Validation** | DTO class + `class-validator` decorators via `ValidationPipe` | Schema-first via `ajv`/Zod (developer's choice) | Manual via middleware | Zod schema in `{query, body, params}` fields — single source of truth per `.claude/rules/type-safety.md` | Strategy (b) explicit Zod via `static schema`; optional codemod for class-validator |
| **Pre-handler hooks** | Guards (`@UseGuards`, return boolean) + Interceptors (`@UseInterceptors`, wrap) — separate concepts | `preHandler`/`preValidation` hooks via `lib/handle-request.js` `preHandlerHookRunner` import (line 6) | `app.use(middleware)` chain | `defineMiddleware((request, next) => Response)` — see `packages/theo/src/server/define/define-middleware.ts:1-12` | Bridge: `@UseGuards` + `@UseInterceptors` both translate to TheoKit middleware wraps |
| **Module DI** | `@Injectable` + `@Module({ providers, controllers })` | Plugin scope `fastify.register(plugin)` | Application-level only (per `.claude/knowledge-base/references/hono/src/compose.ts`) | `@theokit/di` separate package | OUT OF SCOPE per ADR D4 — delegate to `@theokit/di` |
| **Test convention** | `@nestjs/testing` + supertest (`Test.createTestingModule({controllers})`) | Built-in `fastify.inject({method, url})` injector | Manual `app.request(...)` | `startDevServer(fixtureDir, {port:0})` + native `fetch` — see `tests/integration/onda5-mandatory.test.ts:1-25` | Reuse TheoKit Pattern 2; no new harness |
| **CLI scaffold** | `nest g controller [name]` | None first-class — community generators | `bun create hono` | `theokit generate {route,action,page,ws} <name>` — see `packages/theo/src/cli/commands/generate.ts:9-11` | Extend existing CLI with `theokit generate controller <name>` (single template addition) |
| **TS config requirements** | `experimentalDecorators: true` + `emitDecoratorMetadata: true` + `reflect-metadata` peer | None | None | None — see `tsconfig.json:1-22` (no decorator flags) | NEW package's own tsconfig opts in; core TheoKit unchanged |
| **Runtime bundle delta (opt-in path)** | reflect-metadata ~3KB + class-validator ~22KB | 0 | 0 | 0 | reflect-metadata ~3KB + new package ~5-10KB = ~8-13KB; class-validator path 0KB if user follows strategy (b) |

**Key consolidating insight:** TheoKit's existing factory-function model (`defineRoute` identity + Zod single-source) is fundamentally **closer to Fastify's imperative-handler shape than to NestJS's class-based metadata model**. The `@theokit/http-decorators` bridge is a *thin translation layer* (decorator metadata → `defineRoute(...)` factory calls), NOT a re-implementation of NestJS's dispatch internals. This is what makes v0.1.0 feasible at ~5-10KB package size — the heavy lifting (validation, routing, middleware) already lives in TheoKit core; the bridge only translates the surface ergonomics.

## ADRs (synthesized — 6 total)

### D1 — Legacy decorators (NOT TC39 Stage-3) for v0.1.0

**Decision:** v0.1.0 ships `experimentalDecorators: true` + `emitDecoratorMetadata: true` (Legacy TS decorators). Stage-3 deferred to v0.2.0+ follow-up `/discover-plan`.

**Rationale:** Per plan ADR-D6 + Q5 investigation: TC39 Stage-3 decorators (mid-2026) deliberately exclude `emitDecoratorMetadata`-style runtime type emission needed for `@Body() body: CreateCatDto` DTO injection. NestJS itself uses Legacy. Teams migrating expect Legacy semantics.

**Alternatives considered:**
- (a) Stage-3 only — bleeding edge, doesn't support runtime type emit, blocks the `@Body() body: ClassName` pattern.
- (b) Dual-mode (Legacy + Stage-3) — doubles surface area + maintenance burden.

**Consequences:** Consumer-app tsconfig delta = 2 lines (per Q5). reflect-metadata declared as required peer dep (~3KB gzipped). Migration path documented for when TC39 + TS support stabilize.

### D2 — Strategy (b) explicit Zod schema attached to DTO class (NOT auto-bridge from class-validator)

**Decision:** v0.1.0 requires users to attach `static schema` Zod on the DTO class. Class-validator decorators NOT supported runtime. Optional `@theokit/http-decorators-class-validator-codemod` separate package handles ~80% migration mechanically.

**Rationale:** Per plan ADR (type-safety.md) "Zod is the Single Source of Truth" — auto-bridge from class-validator → Zod would (i) lose Zod SSoT invariant; (ii) break on `@Matches` regex modifiers vs Zod regex semantics; (iii) lose OpenAPI generation precision (per G2). Q2 enumerated 4 honest limitations.

**Alternatives considered:**
- (a) Auto-bridge DTO class → Zod schema at runtime via reflect-metadata + class-validator decorator introspection — fails (i)-(iii) above.
- (c) Skip Zod entirely; ship only class-validator support — breaks TheoKit's existing OpenAPI emit + tests + type-inference contract.

**Consequences:** Higher migration friction (1-time codemod cost); preserved type-safety invariant; OpenAPI precision retained.

### D3 — `@UseGuards` + `@UseInterceptors` both translate to `defineMiddleware` wraps; `@Catch` Filter deferred v0.2.0

**Decision:** v0.1.0 maps NestJS Guards + Interceptors to TheoKit `defineMiddleware` wraps at metadata-walk time. `@Catch(HttpException)` Filter class deferred to v0.2.0+ follow-up discovery.

**Rationale:** Per plan ADR-D5 (light Pipes/Guards/Interceptors treatment) + Q3 finding: TheoKit's `MiddlewareHandler` `(request, next) → Response` shape SUPERSETS both Guards (return early) AND Interceptors (await + wrap). Pipes' validation role already covered by Zod in `defineRoute`.

**Alternatives considered:**
- (a) Ship full Guards/Interceptors/Filters as first-class v0.1.0 decorators — violates scope discipline (Pipes/Guards/Interceptors each deserve own discovery).
- (c) Skip Guards entirely in v0.1.0 — breaks "NestJS-compatible enough" target for migration teams.

**Consequences:** v0.1.0 covers auth + logging use cases; v0.2.0 follow-up plans Filters (error handling decorators).

### D4 — Reuse existing TheoKit test harness (Pattern 2: startDevServer + native fetch); no new package

**Decision:** v0.1.0 ships ZERO new test infrastructure. Users test decorated controllers via `startDevServer(fixtureDir, {port:0})` + native `fetch` — identical to how `defineRoute`-authored routes are tested today.

**Rationale:** Per plan Q4 + Rule 9 (don't reinvent the wheel): supertest adds a dependency with no benefit over native fetch. The bridge layer itself ships its own contract test at `@theokit/http-decorators/tests/contract.test.ts`.

**Alternatives considered:**
- (a) Ship supertest-equivalent in `@theokit/http-decorators-testing` — adds dep + duplicates existing functionality.
- (c) Mock TestingModule API — fakes NestJS API surface; users get false sense of compatibility, then break when real apps differ.

**Consequences:** Migration guide ships with v0.1.0 documenting `Test.createTestingModule → startDevServer` + `supertest → fetch` translation.

### D5 — Extend `theokit generate` with `controller` verb (NOT separate CLI package)

**Decision:** v0.1.0 adds a single entry to `VALID_TYPES` in `packages/theo/src/cli/commands/generate.ts:9` + one `generateControllerTemplate(name)` function. No separate `@theokit/http-decorators-cli` package.

**Rationale:** Per plan Q6: the addition is ~30 LOC mirroring the existing `generateRouteTemplate` pattern (see `generate.ts:129`). Discoverability via `theokit generate --help`. Generated file imports from `@theokit/http-decorators` but doesn't require it at generate-time (file emission only). The minor coupling (core knows controller verb exists) is acceptable.

**Alternatives considered:**
- (a) Separate `@theokit/http-decorators-cli` package — duplicates template-resolution infra, less discoverable.
- (c) Defer CLI extension to v0.2.0 — leaves NestJS migrants without scaffold parity.

**Consequences:** Adds 1 CLI verb. `nest g resource` (CRUD scaffold) deferred v0.2.0+ since it needs DTO bridge (D2) + Guards (D3) ergonomics validated first.

### D6 — Architecture.md INVARIANT #3 respected: `@theokit/http-decorators` re-exports from `theokit/server` barrel, NOT deep-imports

**Decision:** All `@theokit/http-decorators` cross-module imports go through `theokit/server` public barrel. NO deep imports like `theokit/server/define/define-route.js` from the new package.

**Rationale:** Per `.claude/rules/architecture.md` v3.1 INVARIANT #3 "Public API only flows through barrels". The new package is a sibling consumer of `theokit/server`, not a privileged insider. The existing barrel (`packages/theo/src/server/index.ts:105` `export { executeWebRequest }`) already exposes what's needed.

**Alternatives considered:**
- (a) Add `@theokit/http-decorators` as a workspace internal — would require deep imports + couple it to internal layout.
- (c) Add a new internal `theokit/server/internals` sub-barrel — proliferates barrels; defeats INVARIANT #3 purpose.

**Consequences:** Bridge code in `@theokit/http-decorators` uses `import { defineRoute, defineMiddleware } from 'theokit/server'` — robust against TheoKit internal refactors. Bridge layer's contract tests verify barrel-import shape.

<!-- All 6 ADRs above synthesize the 6 question answers into actionable design decisions for the downstream /to-plan @theokit/http-decorators cycle. -->

---

## Recommendations (synthesized at halt)

Ship `@theokit/http-decorators` v0.1.0 with the following committed surface:

1. **`@Controller(prefix?, opts?)`** class decorator — emits route files at build time. Supports `{ host: ':account.example.com' }` optional sub-domain matching (verified against NestJS spec § Sub-domain routing).
2. **HTTP-verb method decorators**: `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@Options`, `@Head`, `@All` — translate to per-method `defineRoute(...)` factory calls. Mirrors the NestJS shape in spec § Resources.
3. **Parameter decorators**: `@Req`, `@Res({passthrough?})`, `@Body(key?)`, `@Query(key?)`, `@Param(key?)`, `@Headers(name?)`, `@Session()`, `@Ip()`, `@HostParam(key?)` — all map to TheoKit's ctx-destructured handler.
4. **Response-shape decorators**: `@HttpCode(status)`, `@Header(name, value)`, `@Redirect(url, status?)` — all map to `defineRoute({status})` + Response construction.
5. **DTOs**: explicit Zod via `static schema` on the class (strategy b per D2). Optional `@theokit/http-decorators-class-validator-codemod` separate package for migration.
6. **Guards / Interceptors**: `@UseGuards(GuardClass)` + `@UseInterceptors(InterceptorClass)` translate to `defineMiddleware` wraps per D3.
7. **CLI**: extend `theokit generate` with `controller` verb per D5 — generates `server/controllers/{name}.controller.ts`.
8. **Test harness**: NONE — reuse existing TheoKit Pattern 2 (`startDevServer` + native `fetch`) per D4.
9. **Architecture barrel discipline**: import only from `theokit/server` barrel per D6 — respects architecture.md v3.1 INVARIANT #3.

Out of scope for v0.1.0 (deferred to follow-up `/discover-plan`):
- NestJS Pipes / Filters / Modules / Providers / DI (per plan ADR-D4, ADR-D5)
- TC39 Stage-3 decorators (per D1; Legacy in v0.1.0)
- `nest g resource` CRUD scaffold (per D5; deferred)

Bundle cost for consumers who opt in: ~8-13KB gzipped (reflect-metadata ~3KB + new package ~5-10KB). Bundle cost for non-opt-in consumers: 0KB.

## References cited

Inline citations across this blueprint resolve to the following on-disk paths under `.claude/knowledge-base/references/` (Fastify + Hono) and `packages/theo/src/` (TheoKit core):

**Fastify (comparative — routing dispatch internals):**
- `.claude/knowledge-base/references/fastify/lib/handle-request.js:20` — `handleRequest(err, request, reply)` orchestrator entry
- `.claude/knowledge-base/references/fastify/lib/handle-request.js:6` — `preValidationHookRunner` + `preHandlerHookRunner` imports
- `.claude/knowledge-base/references/fastify/lib/route.js:120` — `routing: router.lookup.bind(router)` route registration
- `.claude/knowledge-base/references/fastify/lib/route.js:147` — `prepareRoute({method, url, options, handler})` per-route prep
- `.claude/knowledge-base/references/fastify/lib/decorate.js:77` — `decorate(this, name, fn, dependencies)` runtime decoration API
- `.claude/knowledge-base/references/fastify/lib/request.js` — Request object surface
- `.claude/knowledge-base/references/fastify/lib/reply.js` — Reply object surface
- `.claude/knowledge-base/references/fastify/fastify.d.ts` — public TS surface
- `.claude/knowledge-base/references/fastify/package.json` — runtime dep tree
- `.claude/knowledge-base/references/fastify/lib/errors.js` — error chain (comparative with TheoKit envelope translator)
- `.claude/knowledge-base/references/fastify/lib/plugin-utils.js` — plugin scope (Object.create per Fastify pattern; comparative with TheoKit T3.1)

**Hono (negative reference — chain pattern alternative):**
- `.claude/knowledge-base/references/hono/src/hono.ts` — main Hono class
- `.claude/knowledge-base/references/hono/src/hono-base.ts` — base routing surface
- `.claude/knowledge-base/references/hono/src/router.ts` — router internals
- `.claude/knowledge-base/references/hono/src/context.ts` — context object passed to handlers (`c.json(...)` shape)
- `.claude/knowledge-base/references/hono/src/compose.ts` — middleware composition

**TheoKit core (in-tree):**
- `packages/theo/src/server/define/define-route.ts:14` — `defineRoute` identity factory
- `packages/theo/src/core/contracts/route-config.ts:14-40` — RouteConfig interface (Zod schemas + handler signature)
- `packages/theo/src/server/define/define-middleware.ts:1-12` — `defineMiddleware` + `MiddlewareHandler` type
- `packages/theo/src/server/http/middleware-runner.ts:72` — `runMiddlewareAndContext` chain executor
- `packages/theo/src/server/http/middleware-runner.ts:57` — `runOneMiddleware` per-step
- `packages/theo/src/server/http/action-execute.ts:34-59` — `ZodLike` structural interface
- `packages/theo/src/server/http/action-execute.ts:361` — `actionConfig.input.safeParse(bodyOutcome.body)` parse boundary
- `packages/theo/src/server/index.ts:105` — `export { executeWebRequest }` public barrel
- `packages/theo/src/cli/commands/generate.ts:9-11` — `VALID_TYPES` array (`route`/`action`/`page`/`ws`)
- `packages/theo/src/cli/commands/generate.ts:124-141` — generator switch table
- `packages/theo/src/cli/commands/generate.ts:129` — `generateRouteTemplate(name)` inline template pattern
- `tsconfig.json:1-22` — root tsconfig (no decorator flags)
- `tests/integration/api-middleware-coverage.test.ts:1-40` — Pattern 1 mock-Vite test
- `tests/integration/onda5-mandatory.test.ts:1-25` — Pattern 2 boundary smoke test

## Blocked questions (if any)

None. All 6 research questions answered. 0 fabricated citations (verified by `/discover-confidence` Step 7 sanity check).

## Blocked questions (if any)

<!-- Q1 is DONE — Q2-Q6 remain pending. None blocked yet. -->
