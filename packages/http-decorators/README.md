# @theokit/http-decorators

NestJS-style decorators (`@Controller`, `@Get`, `@Post`, `@Body`, `@UseGuards`) that bridge to TheoKit's `defineRoute` + `defineMiddleware`. Opt-in for teams migrating from NestJS.

## Install

```bash
pnpm add @theokit/http-decorators reflect-metadata
```

Add to your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

## Quick start

```typescript
import { Controller, Get, Post, Body } from '@theokit/http-decorators'
import { z } from 'zod'

const zCreateCat = z.object({ name: z.string(), age: z.number() })

class CreateCatDto {
  static schema = zCreateCat
}

@Controller('cats')
export class CatsController {
  @Get()
  findAll(): string {
    return 'This action returns all cats'
  }

  @Post()
  create(@Body() body: CreateCatDto) {
    return `Added ${(body as z.infer<typeof zCreateCat>).name}`
  }
}
```

## DTO validation (Pattern D2 — Zod static schema)

TheoKit uses Zod as the single source of truth for validation. Attach a `static schema` to your DTO class:

```typescript
const zCreateCat = z.object({
  name: z.string().min(2).max(50),
  age: z.number().min(0),
  breed: z.string(),
})

class CreateCatDto {
  static schema = zCreateCat
}
```

The bridge reads `CreateCatDto.schema` at metadata-walk time and feeds it to `defineRoute({ body: zCreateCat })`. This preserves TheoKit's OpenAPI generation + type inference pipeline.

## Guards and Interceptors

```typescript
import { Controller, Get, UseGuards } from '@theokit/http-decorators'

class AuthGuard {
  canActivate(request: Request): boolean {
    return request.headers.get('authorization') !== null
  }
}

@Controller('admin')
export class AdminController {
  @UseGuards(AuthGuard)
  @Get()
  dashboard() {
    return { status: 'authenticated' }
  }
}
```

Guards that return `false` produce a 401 response. `@UseInterceptors` wraps the handler for post-processing (logging, caching).

## CLI scaffold

```bash
theokit generate controller cats
# Creates server/controllers/cats.controller.ts
```

## registerControllers (low-level API)

For advanced use cases without the Vite plugin:

```typescript
import { registerControllers } from '@theokit/http-decorators'
import { CatsController } from './controllers/cats.controller.js'

const routes = registerControllers([CatsController])
// Returns RouteRegistration[] with verb, fullPath, walkResult per method
```

## Decorators reference

| Decorator | Kind | Purpose |
|---|---|---|
| `@Controller(prefix?, opts?)` | Class | Route prefix scope |
| `@Get(path?)` | Method | GET endpoint |
| `@Post(path?)` | Method | POST endpoint |
| `@Put(path?)` | Method | PUT endpoint |
| `@Patch(path?)` | Method | PATCH endpoint |
| `@Delete(path?)` | Method | DELETE endpoint |
| `@Options(path?)` | Method | OPTIONS endpoint |
| `@Head(path?)` | Method | HEAD endpoint |
| `@All(path?)` | Method | All HTTP methods |
| `@Body(key?)` | Parameter | Request body (or body[key]) |
| `@Param(key?)` | Parameter | Route params (or params[key]) |
| `@Query(key?)` | Parameter | Query string (or query[key]) |
| `@Headers(name?)` | Parameter | Request headers |
| `@Req()` | Parameter | Full Request object |
| `@Res(opts?)` | Parameter | Response object (`passthrough` option) |
| `@Session()` | Parameter | Session object |
| `@Ip()` | Parameter | Client IP |
| `@HostParam(key?)` | Parameter | Host parameters |
| `@HttpCode(status)` | Method | Override response status code |
| `@Header(name, value)` | Method | Set response header |
| `@Redirect(url, status?)` | Method | Redirect response |
| `@UseGuards(...guards)` | Class/Method | Attach guard classes |
| `@UseInterceptors(...interceptors)` | Class/Method | Attach interceptor classes |

## Limitations

### Singleton-scope controllers only (v0.1.0)

Controllers are instantiated once per `registerControllers` call. NestJS request-scoped controllers (`@Injectable({ scope: Scope.REQUEST })`) are not supported. Migration path: v0.2.0+ via `@theokit/di` integration.

### Interceptor wrap semantics simplified

NestJS interceptors can skip calling `next()` (e.g., cache-hit short-circuit). v0.1.0 wraps always call `next()` then post-process. Consumers needing pre-handler short-circuit should use `defineMiddleware` directly.

### Handler returning Response bypasses decorator-set status/headers

If your handler returns a `Response` object directly, `@HttpCode` and `@Header` decorators are not applied. You own the full response. This matches NestJS behavior with `@Res({ passthrough: false })`.

## Troubleshooting

### `HttpDecoratorsConfigError: emitDecoratorMetadata not enabled`

Your `tsconfig.json` is missing the `emitDecoratorMetadata: true` flag. Add both flags:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

### `HttpDecoratorsConfigError: missing @Controller() decorator`

You have `@Get`/`@Post` methods on a class that lacks `@Controller()`. Add the decorator to the class.

## Bundle cost

- Opt-in consumers: ~8-13KB gzipped (`reflect-metadata` ~3KB + this package ~5-10KB)
- Non-opt-in consumers: 0KB
