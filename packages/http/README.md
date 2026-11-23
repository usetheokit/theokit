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
pnpm add -D @swc/core
```

`theokit dev` and `theokit build` compile every controller file with SWC, so a theokit app needs
`@swc/core` even when its controllers use no parameter decorators.

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

## Accepting an upload

`request.formData()` buffers the whole body before any size check can run. `readCappedFormData`
refuses the body as soon as more than `maxBytes` have arrived (413), and refuses a declared
`Content-Length` over the cap before the first read. A non-form content type or an unparseable body
is a 400.

```typescript
import { Controller, Post, Req, readCappedFormData } from '@theokit/http'

@Controller('api/upload')
export class UploadController {
  @Post()
  async upload(@Req() request: Request) {
    const form = await readCappedFormData(request, { maxBytes: 25 * 1024 * 1024 })
    const file = form.get('file') as File
    return { name: file.name, size: file.size }
  }
}
```

## `module` and `container`

`TheoApp.create({ module })` resolves providers and controllers through an `@theokit/di`
`Container`: constructor dependencies, scopes, `@PostConstruct` and `@PreDestroy` are honoured, the
whole import graph is loaded, and a missing provider rejects `create()` with the container's typed
error. **`@theokit/di` must be installed for `module`** (it is an optional peer dependency).

Pass `container` to use your own; the module is registered into it and you dispose it yourself.
Without `container`, `create` builds one and `app.close()` disposes it. Inline `providers` without
`module` or `container` are built with `new` only when their constructor takes no parameters;
otherwise `create` throws.

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
| `./guards` | Bearer token and loopback bind guards, and `createGrantStore` (see below) |

## Guards: bearer token and loopback bind

`@theokit/http/guards` is the one reviewed copy of the checks a self-hosted app needs (Node built-ins only).

```ts
import { bearerGuard, readBearerToken, resolveBindAddress, parsePort } from '@theokit/http/guards'

const token = readBearerToken(process.env, 'APP_TOKEN') // undefined = surface off
const guard = token && bearerGuard(token) // (request) => Response | undefined
const host = resolveBindAddress(process.env, { hostVariable: 'APP_HOST', consentVariable: 'APP_PUBLIC_BIND' })
const port = parsePort(process.env, 'APP_PORT')
```

- `readBearerToken(env, variable, { minLength? })`: unset or empty returns `undefined`; padding whitespace or fewer than 32 characters (`minLength`, never below 16) throws `GuardConfigError`, naming the variable and never the value.
- `bearerCheck(token)` compares SHA-256 digests with `timingSafeEqual`; the scheme matches in any case. `bearerGuard(token)` returns `undefined` or a 401 with `www-authenticate: Bearer`.
- `isLoopback(host)` accepts only `localhost`, `::1` and dotted IPv4 in 127.0.0.0/8. `LOCALHOST`, `[::1]`, `::ffff:127.0.0.1` and `127.1` count as public.
- `resolveBindAddress` defaults to `127.0.0.1`; a non-loopback host needs `consentVariable` set to `consentValue` (default `yes`) or it throws `BindRefusedError`. The generic `HOST` is never read.
- `parsePort` accepts digits only, 0 to 65535; otherwise `GuardConfigError`.

## Node server with a disconnect signal

`createNodeServer` from `@theokit/http/runtime/node` serves a Web-standard handler on Node.

```ts
import { createNodeServer, BindError } from '@theokit/http/runtime/node'

const node = createNodeServer(
  async (request) => {
    // Aborts when the client disconnects before the response finished.
    request.signal.addEventListener('abort', () => cancelTurn())
    return streamTurn(request)
  },
  {
    onUpgrade: (req, socket, head) => handleWebSocket(req, socket, head), // omitted: 404 and close
    onError: (error, phase) => log(phase, error),
  },
)

try {
  const { host, port } = await node.listen(3000, '127.0.0.1')
} catch (e) {
  if (e instanceof BindError) console.error(e.code, e.host, e.port)
}
await node.close({ force: true }) // memoized; force ends open and upgraded sockets
```

- The signal follows the response's `close`, not the request's, so it is reliable on Node 23+. A response that finishes normally never aborts it. Pass `abortOnDisconnect: false` to turn it off.
- When the client leaves mid-body, the response body is cancelled so its producer stops.
- `listen` rejects with `BindError` (`code`, `host`, `port`); after binding, server errors go to `onError(error, 'server')`.
- `close()` is memoized: concurrent calls share one promise, and the first call decides whether it is forced.


The server lives in `src/bridge/runtime/node-server.ts`; the request/response conversion and `createNodeAdapter` stay in `node.ts`. Its integration tests run with:

```sh
THEOKIT_TEST_RUN_ID=1 pnpm exec vitest run packages/http/tests/integration/node-server-*.test.ts
```

(Run it from the repository root: the root `vitest.config.ts` owns the package projects.) They cover bind errors, memoized and forced close, client-disconnect aborts and upgrade handling.
### Trusted proxy identity

When a reverse proxy authenticates the user (Tailscale serve, Caddy, nginx with auth) and forwards the identity in a header, believe it only from the proxy's address:

```ts
import { createNodeServer, trustedIdentity, peerAddress } from '@theokit/http/runtime/node'

const node = createNodeServer(
  (request) => new Response(`hello ${trustedIdentity(request) ?? 'anonymous'}`),
  { trustedProxy: { identityHeader: 'tailscale-user-login', addresses: ['127.0.0.1', '::1'] } },
)
```

Caddy: `reverse_proxy 127.0.0.1:3000 { header_up X-Auth-User {http.auth.user.id} }` with `identityHeader: 'x-auth-user'`.

- A request from an allowlisted peer with a non-empty identity header gets `trustedIdentity(request)`; from any other peer it is `undefined`, and the identity header is removed.
- `x-theokit-peer` and `x-theokit-trusted-identity` supplied by a client are always removed; `peerAddress(request)` is the socket address.
- `x-forwarded-proto` is honoured only from an allowlisted peer; otherwise the URL protocol is `http:`.
- `identityHeader` must match `[a-z0-9-]+` and not be `authorization`; `addresses` must be non-empty (`::ffff:` is ignored, case is ignored). Invalid options throw a `TypeError` naming the option.
- `onUpgrade` receives the raw `IncomingMessage`; use `request.socket.remoteAddress` there.

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

## Scoped, revocable credentials

`createGrantStore(file)` keeps named credentials in a file as SHA-256 hashes (mode 0600), never in clear.

```ts
import { createGrantStore } from '@theokit/http/guards'

const grants = createGrantStore('/var/lib/app/grants.json')
const { credential } = await grants.create('alice', ['read_file']) // shown once
await grants.authenticate(credential) // the grant, with its scopes
await grants.revoke('alice')
await grants.authenticate(credential) // undefined
```
