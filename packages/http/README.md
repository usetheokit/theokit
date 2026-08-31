# `@theokit/http`

NestJS-style decorators (`@Controller`, `@Get`, `@Post`, `@Body`, `@UseGuards`) over Web Standards —
`Request` and `Response`, not `node:http`. They compile down to the same route registrations
[`theokit`](https://www.npmjs.com/package/theokit) serves, so a decorator controller and a
`route()` builder are two authoring surfaces over one runtime.

> **Renamed.** This package was published as `@theokit/http-decorators` until 0.3.0. That name is
> frozen at the old surface — install `@theokit/http`.

## Install

```bash
pnpm add @theokit/http reflect-metadata
```

The decorators are the TypeScript legacy kind, so the consuming project needs:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

`emitDecoratorMetadata` is only required for the DTO-class form of `@Body` (below). The preferred
form — `@Body(schema)` — works without it.

## Quick start

```typescript
import { Controller, Get, Post, Body, Param, Public } from '@theokit/http'
import { z } from 'zod'

// Convention: @Controller() on CatsController infers the prefix "api/cats".
// Pass a string to override: @Controller('api/v2/cats').
//
// `@Public()` is the access decision "anyone may call this". Every route needs one — a guard or
// this — because a route that declares neither is refused with 403 rather than served. See
// "Every route declares who may call it" below.
@Public()
@Controller()
export class CatsController {
  @Get()
  findAll() {
    return { cats: [] }
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return { id }
  }

  @Post()
  create(@Body(z.object({ name: z.string(), age: z.number().min(0) })) body: unknown) {
    return { created: body }
  }
}
```

## Every route declares who may call it

A route says one of two things, and saying neither is not a third option:

| | how it is said |
|---|---|
| anyone may call it | `@Public()` — on the method, or on the class to cover every route under it |
| someone decides | `@UseGuards(SomeGuard)` — likewise on either |

A route that declares neither is **refused with 403** at dispatch, in every dispatcher this package
ships, and `theokit build` fails on it before that. The reason is that `guards: []` used to mean
both *"open on purpose"* and *"nobody said"*, so the dispatcher took the permissive reading — and a
route nobody thought about is the one that ships open.

`undeclaredRoutes: 'warn'` restores the old behaviour while you migrate, with one warning per route:

```typescript
TheoApp.create({ controllers, undeclaredRoutes: 'warn' }) // also on createDecoratorHandler(...)
```

Guards still run on a `@Public()` route — the decorator answers *who may call it*, not *what else
happens on the way in*. For "any signed-in caller", `theokit/server/auth` exports the guard rather
than leaving every app to write it:

```typescript
import { createSessionManagerWeb, Authenticated } from 'theokit/server/auth'

const sessions = createSessionManagerWeb<{ userId: string }>({ secret: process.env.SESSION_SECRET! })

@Controller('api/tasks')
@UseGuards(Authenticated(sessions))
export class TasksController { … }
```

## Validation — Zod is the single source of truth

Pass the schema to `@Body` directly. The bridge validates the request against it and feeds the same
schema to the OpenAPI emitter and the typed-client codegen:

```typescript
@Post()
create(@Body(z.object({ name: z.string().min(2), breed: z.string() })) body: unknown) { … }
```

A DTO class works too, when a shared, named shape reads better. Attach the schema as a static; this
form needs `emitDecoratorMetadata`, because the bridge finds the class through `design:paramtypes`:

```typescript
class CreateCatDto {
  static schema = z.object({ name: z.string(), age: z.number() })
}

@Post()
create(@Body() body: CreateCatDto) { … }
```

When neither is present the body is passed through raw and the bridge warns — validation is never
silently skipped.

## Pipeline

`middleware → guards → interceptors → handler`, with filters catching what escapes.

```typescript
import { Controller, Get, UseGuards, type CanActivate, type ExecutionContext } from '@theokit/http'

class AuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    return ctx.getRequest().headers.get('authorization') !== null
  }
}

@Controller('api/admin')
export class AdminController {
  @UseGuards(AuthGuard)
  @Get()
  dashboard() {
    return { status: 'authenticated' }
  }
}
```

A guard returning `false` produces **403 Forbidden** (`ForbiddenException`); throw
`UnauthorizedException` from the guard when 401 is what you mean. Class-level guards run before
method-level ones.

An interceptor is `intercept(request, next)` — Web Standard `Request` in, and `next()` wrapping the
handler call only (the body is already parsed by then). Not calling `next()` short-circuits the
handler; calling it twice is memoized to one execution.

An exception filter is `catch(exception, host)` returning a `Response`, where `host.getRequest()` is
the request that failed.

## Serving an agent from a controller

`@Expose` binds an agent built in `agents/<name>.ts` to a controller property, so its route, its
streaming and its auth are visible in one place:

```typescript
import { Controller, Expose, UseGuards } from '@theokit/http'

import supportAgent from '../../agents/support.js'

@Controller('api/agents')
@UseGuards(AuthGuard)
export class AgentsController {
  @Expose(supportAgent)
  support!: unknown // → POST /api/agents/support, behind AuthGuard
}
```

The request is delegated straight to the one agent runtime. Guards run on that route; interceptors
do not.

## Decorators reference

| Decorator | Kind | Purpose |
|---|---|---|
| `@Controller(prefix?, opts?)` | Class | Route prefix scope (inferred from the class name when omitted) |
| `@Get/@Post/@Put/@Patch/@Delete/@Options/@Head/@All(path?)` | Method | HTTP verb endpoints |
| `@Body(schemaOrKey?)` | Parameter | Request body — Zod schema, DTO class, or `body[key]` |
| `@Param(key?)` | Parameter | Route params (or `params[key]`) |
| `@Query(key?)` | Parameter | Query string (or `query[key]`) |
| `@Headers(name?)` | Parameter | Request headers |
| `@Req()` / `@Res(opts?)` | Parameter | The raw `Request` / response (`passthrough` option) |
| `@Session()` / `@Ip()` / `@HostParam(key?)` | Parameter | Session, client IP, host params |
| `@HttpCode(status)` | Method | Override the response status |
| `@Header(name, value)` | Method | Set a response header |
| `@Redirect(url, status?)` | Method | Redirect response |
| `@UseGuards(...)` | Class/Method | Attach guards |
| `@UseInterceptors(...)` | Class/Method | Attach interceptors |
| `@UseFilters(...)` / `@Catch(...)` | Class/Method | Exception filters |
| `@Throttle(opts)` / `@SkipThrottle()` | Class/Method | Rate-limit policy |
| `@SetMetadata(key, value)` / `createDecorator<T>()` | Class/Method | Custom metadata, read back with `Reflector` |
| `@Expose(agent, opts?)` | Property | Serve a built agent from this controller |

Build your own policy decorator with `createDecorator`:

```typescript
const Roles = createDecorator<string[]>()
// @Roles(['admin']) → read it in a guard with reflector.get(Roles, handler)
```

`HttpStatus` ships the 30 status codes the framework uses, alongside an exception class per code
(`BadRequestException`, `ConflictException`, `TooManyRequestsException`, …).

## Subpaths

| Subpath | What lives there |
|---|---|
| `.` | Decorators, metadata, the bridge, exceptions, `TheoApp`, `createTypedClient`, `contract`, static serving |
| `./theokit-plugin` | The plugin that wires controllers into a TheoKit app |
| `./app` | App-level composition |
| `./runtime/node` | The Node runtime adapter |
| `./action-encryption`, `./server-inserted-html`, `./css-resource` | Opt-in capabilities kept off the main bundle |

## `registerControllers` (low-level)

For advanced use without the Vite plugin:

```typescript
import { registerControllers } from '@theokit/http'

const routes = registerControllers([CatsController])
// RouteRegistration[] — verb, fullPath, and the metadata walk per method
```

## Limitations

- **Singleton-scope controllers only.** A controller is instantiated once, when the handler is
  built — NestJS request-scoped controllers (`@Injectable({ scope: Scope.REQUEST })`) have no
  equivalent here. Guards and interceptors are the opposite: a fresh instance per request, unless a
  DI container resolves them.
- **No response object before the handler returns.** `ExecutionContext` exposes the request, the URL,
  the controller class and the handler name — there is nothing to mutate headers on until a
  `Response` exists. Set them with `@Header`, or return a `Response` yourself.
- **A handler returning a `Response` owns it.** `@HttpCode` and `@Header` are not applied on that
  path — the same behaviour as NestJS with `@Res({ passthrough: false })`.

## Troubleshooting

**`HttpDecoratorsConfigError: emitDecoratorMetadata not enabled`** — add both compiler flags shown
under Install, or pass the schema inline as `@Body(schema)`, which does not need them.

**`HttpDecoratorsConfigError: missing @Controller() decorator`** — a class has `@Get`/`@Post`
methods but no `@Controller()`.

## Bundle cost

~8-13KB gzipped for consumers who opt in (`reflect-metadata` ~3KB plus this package); 0KB for those
who do not.

## Licence

Apache-2.0 — see `LICENSE`.
