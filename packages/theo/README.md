# `theokit`

**Build the app your agent lives in.** Routing, auth, real-time, deploy — wired.

This is the framework core: the file-based router, the server surfaces, the Vite plugin, the CLI,
the deploy adapters and the devtools. The agent pipeline lives in
[`@theokit/agents`](https://www.npmjs.com/package/@theokit/agents), the decorator pipeline in
[`@theokit/http`](https://www.npmjs.com/package/@theokit/http), and the runtime in
[`@theokit/sdk`](https://www.npmjs.com/package/@theokit/sdk) — TheoKit compiles and serves; the SDK
runs the agent.

Full documentation, examples and the changelog live in the
[repository](https://github.com/usetheokit/theokit#readme).

## Install

Scaffold rather than install by hand — the app layout is a convention the framework reads:

```bash
npx create-theokit my-app
cd my-app
pnpm dev
```

Node `>= 22.12.0`. Peers: `react`, `react-dom`, `react-router`, `zod`, and — where you use them —
`@theokit/sdk`, `@theokit/ui`, `@theokit/studio`, `ws`, `db0`, `unstorage`.

## The conventions

| Put a file here | Get |
|---|---|
| `app/page.tsx` | the `/` route (`layout` · `loading` · `error` · `not-found` beside it) |
| `app/(group)/pricing/page.tsx` | `/pricing` — the group organizes without entering the URL |
| `agents/support.ts` | `POST /api/agents/support`, bound on the client by `useAgent` |
| `server/routes/users.ts` | `/api/users`, one export per HTTP verb |
| `server/actions/*.ts` | server actions, with CSRF and validation handled |
| `server/controllers/*.ts` | `@Controller` classes |
| `server/ws/chat.ts` | `ws://…/ws/chat` |
| `server/middleware/01-cors.ts` | request middleware, in filename order |

### `next` is supported on one of the two paths

A middleware receives `(request, context, next)`. What `next` does depends on which runner is
executing it, and the two differ today:

| path | `next` |
|---|---|
| `executeWebRequest` — the Web runner | runs the rest of the chain **and the route**, so code after `await next()` observes the route's response |
| `server/middleware/*.ts` — the file-scan runner | **refuses.** It runs BEFORE routing, so there is no downstream to await |

The file-scan path throws `MiddlewareNextUnavailableError`, naming the alternative. It used to
accept the call and continue silently, which meant the code after `await next()` never ran and
nothing said so.

**This is a real limitation, not a bug being hidden.** Closing it means either folding the
file-scan path so the chain wraps the route, or retiring this contract for a single one; both are
large and the choice is open — `docs/adr/0003` § *AMENDED 2026-09-21* records what each costs.

Write a `server/middleware/*.ts` middleware that returns a `Response` to answer the request, or
returns nothing to continue. Use the Web path when you need code to run after the route.

## Posting a file to a server action

An action reads `multipart/form-data` through its Zod schema. `objectToFormData` (from `theokit/client`) is
the matching encoder: dot paths for nested objects, a repeated key for arrays, `'true'`/`'false'` for booleans.

```ts
import { objectToFormData } from 'theokit/client'
import { z } from 'zod'

// server/actions/profile.ts — served at /api/__actions/profile/uploadAvatar
import { action } from 'theokit/server'

export const uploadAvatar = action()
  .input(z.object({ title: z.string(), avatar: z.instanceof(File) }))
  .accept('form')
  .handler(async ({ input }) => ({ name: input.avatar.name }))
  .build()

// browser
const schema = z.object({ title: z.string(), avatar: z.instanceof(File) })

await fetch('/api/__actions/profile/uploadAvatar', {
  method: 'POST',
  headers: { 'X-Theo-Action': '1' }, // required by the default strict CSRF check
  body: objectToFormData({ title: 'Me', avatar: input.files![0] }, schema),
})
```

An array of objects, or an array of arrays, throws `FormDataEncodingError`, because the server cannot read it back.

## Authoring surfaces

Every surface is a fluent builder whose `.build()` is a compile error while a required link is
missing:

```typescript
import { route, action, websocket, middleware, tool, plugin } from 'theokit/server'

export const GET = route()
  .policy('public')
  .query(z.object({ search: z.string().optional() }))
  .handler(({ query }) => ({ results: search(query.search) }))
  .build()
```

## Subpaths

| Subpath | What lives there |
|---|---|
| `.` | `config()` and the framework entry |
| `./server` | The authoring builders plus every `server/*` capability re-exported |
| `./server/{agent,auth,cost,cron,define,http,jobs,observability,plugins,rate-limit,realtime,scan,security,storage,webhook}` | The capabilities on their own doors |
| `./client` | `theoFetch`, `useAgent`, `Link`, `Metadata`, `Image`, the transports |
| `./client/core` | The framework-agnostic client (no React) |
| `./react-query` | The TanStack Query adapter over `theoFetch` |
| `./vite-plugin` | The plugin that makes all of the above work |
| `./testing` | `startTestServer`: boot the app as a real process from a test |
| `./boot`, `./adapters/web-shim`, `./adapters/ws-shim` | Runtime shims |

## OIDC discovery

`discoverOidcProvider(issuer)` from `theokit/server/auth` fetches and caches a provider's
metadata. The issuer and every endpoint it returns (`authorization_endpoint`, `token_endpoint`,
and `userinfo_endpoint`, `jwks_uri`, `end_session_endpoint` when present) must be https, or http
on a loopback host (`localhost`, `[::1]`, `127.0.0.0/8`; never `0.0.0.0`). Endpoints need not
share the issuer's host. Otherwise it throws `OidcInsecureEndpointError` (`code:
'oidc_insecure_endpoint'`, with `field` and `url`), and the failure is not cached.
`isSafeOidcUrl(url)` applies the same rule.

## Testing

`theokit/testing` starts the app's own `theokit dev` (or `theokit start`) on a free port and resolves
once `/__theo/ready` answers. No stdout parsing, no `npx`, no hand-rolled process-group kill.

```ts
import { afterAll, beforeAll, expect, it } from 'vitest'
import { startTestServer, type TestServer } from 'theokit/testing'

let server: TestServer
beforeAll(async () => {
  server = await startTestServer({ cwd: process.cwd() }) // mode: 'dev' by default
})
afterAll(async () => {
  await server.close()
})

it('is healthy', async () => {
  expect((await fetch(`${server.origin}/__theo/health`)).status).toBe(200)
})
```

If the child exits or the deadline (`timeoutMs`, default 60 s) passes, `startTestServer` throws
`TestServerBootError` with the child's output. `mode: 'start'` expects a prior `theokit build`.

## Storage

`theo.config.ts > storage` declares servers and databases; route code gets a cached client from
`getStorageManager()` in `theokit/server/storage`, built by a factory you write so the driver stays
optional:

```typescript
import pg from 'pg'
import { getStorageManager } from 'theokit/server/storage'

const pool = getStorageManager().usePostgres('main', (server, db) => {
  const { host, port, user, password } = server
  const p = new pg.Pool({ host, port, user, password, database: db.database })
  p.on('error', (err) => console.warn('[pg] idle client error:', err.message))
  return p
}) as pg.Pool
```

A `pg.Pool` emits `error` when Postgres drops an idle connection (restart, failover,
`pg_terminate_backend`, a proxy timeout), and Node exits on an `error` event with no listener. If
the factory attaches none, `usePostgres` attaches one that logs a structured warning, so the process
stays up and the next query reconnects. Attach your own, as above, to handle it differently.

## Jobs

Declare a backend in `theo.config.ts` and every file route and server action gets `ctx.queue`:

```typescript
import { config } from 'theokit'
import { PostgresJobBackend } from 'theokit/server/jobs'

export default config()
  .set({ jobs: { backend: new PostgresJobBackend({ pool }) } })
  .build()
```

`ctx.queue.enqueue('send-email', input)` hands the job to the backend when the response succeeds
(a 4xx, a 5xx or an aborted request discards it). A job is a file under `<serverDir>/jobs/`
exporting `defineJob(name, { handler })`.

A route or action handler's `ctx` is a `RouteContext` (from `theokit/server/define`), whose keys are
`unknown` until the app declares them. `ctx.queue` is there only when `jobs.backend` is set, so
declare it yourself in a `.d.ts` file, together with the job names in `JobRegistry` (the scaffold's
`types/jobs.d.ts` has both blocks):

```typescript
declare module 'theokit/server/jobs' {
  interface JobRegistry {
    'send-email': { to: string; subject: string }
  }
}
declare module 'theokit/server/define' {
  interface RouteContext {
    queue: import('theokit/server/jobs').QueueClient
  }
}
export {}
```

`theokit start` and `theokit dev` call the backend's `migrate()` once at boot, so the
`theokit_jobs` table is created (or upgraded) before the first request. If that fails, for example
because the database is unreachable, the boot fails rather than serving routes whose jobs would be
lost. Do not call `migrate()` from `theo.config.ts`: `theokit build` loads that file too, and the
build would then need a database.

The outbox hands jobs over after the response, on a different connection from the one your route
wrote with, so a route can commit a row and then lose its job to a failure in between. When the job
table lives in your own database, write the job inside your transaction instead:

```typescript
const client = await pool.connect()
try {
  await client.query('BEGIN')
  const task = await client.query('INSERT INTO task (title) VALUES ($1) RETURNING id', [title])
  await ctx.queue.enqueueInTransaction(client, 'process-task', { taskId: task.rows[0].id })
  await client.query('COMMIT')
} catch (err) {
  await client.query('ROLLBACK')
  throw err
} finally {
  client.release()
}
```

The job commits or rolls back with the row, and workers cannot see it before the commit. It needs a
backend with `enqueueInTransaction` (`PostgresJobBackend` has it); any other backend rejects with
`TransactionalEnqueueUnsupportedError` instead of enqueueing outside the transaction.

`PostgresJobBackend` also moves pending jobs in the caller's transaction, skipping jobs a worker has
leased: `defer(client, { name, where, until })` moves the jobs whose input matches `where` (top-level
keys, compared as text) to `until` (a `Date` or `'infinity'`) and remembers the time each had;
`restore(client, { name, where })` gives that time back; `reschedule(client, jobId, { availableAt })`
sets one job's time, to bring it ahead of others.

To take back a queued job in a transaction, call
`ctx.queue.cancelInTransaction(client, 'process-task', { idempotencyKey })`. It removes the job
only while no worker ever leased it and resolves `true` if it removed one; a leased job (even with
an expired lease) or a failed one is left alone. A backend without `cancelInTransaction` rejects
with `TransactionalCancelUnsupportedError`.

`theokit start` and `theokit dev` run a job worker in the same process whenever jobs are declared
and a backend is set: it polls the backend, runs each job and backs off while the backend is
unreachable. On `SIGTERM`, `start` stops polling and waits for the job in progress before closing
storage, up to `jobs.worker.shutdownTimeoutMs` (20 seconds by default). Jobs that run longer need a
larger value, and a process manager that waits as long before it kills the process (systemd
`TimeoutStopSec`, Kubernetes `terminationGracePeriodSeconds`). `jobs.worker` also takes
`pollIntervalMs`, `batchSize` and `lockSeconds`, and
`enabled: false` turns it off in a process that should only serve requests, for example
`enabled: process.env.ROLE !== 'web'`. Several workers can share one Postgres backend; each job is
leased to one of them. To run a worker on its own, call `createJobWorker(createJobRunner(backend,
definitions)).start()` from `theokit/server/jobs`.

A job leases for `lockSeconds`, and `ctx.signal` aborts when the lease runs out, so a handler that
may run longer than that calls `await ctx.extendLease(seconds)` while it makes progress. The
deadline of `signal` moves with it, and the call rejects with `JobLeaseLostError` (and aborts the
signal) if another worker holds the job by then. `PostgresJobBackend` and `InMemoryJobBackend` can
extend a lease; a custom backend opts in with `extendLease`, and without it the call rejects with
`JobLeaseExtensionUnsupportedError`.

The pool you pass is yours, and so is its `error` listener if you attach one. A `pg.Pool` emits
`error` when Postgres drops an idle connection, and the worker keeps idle clients in the pool. If
the pool has no `error` listener when the backend is constructed, `PostgresJobBackend` attaches one
that logs a structured warning (`component: "theokit:jobs"`), the process stays up and the next
query reconnects. `createPostgresCronLock(pool)` does the same with `component: "theokit:cron"`.
Attach `pool.on('error', ...)` before passing the pool to handle it yourself; theokit then adds
nothing.

In `theokit dev`, route modules load through Vite, so a route that imports the backend from
`theo.config.ts` gets a second instance of it. Use `ctx.queue` to enqueue. Deploy targets other
than `node` do not wire `ctx.queue`; `theokit build` says so when `jobs` is set.

## Crons

A cron is a file under `<serverDir>/crons/` (or `<agentsDir>/schedules/`) exporting
`defineCron(name, { schedule, handler })`. On the `node` target, `theokit start` schedules them in
the same process; serverless targets translate them to the platform's scheduler.

Every process running `theokit start` runs the scheduler, so with two replicas each tick fires
twice unless they share a lock. When `jobs.backend` is a `PostgresJobBackend`, `start` takes a lock
on its pool: one row per tick in `theokit_cron_runs`, and only the replica that inserts it runs the
handler. To pick the lock yourself, or to opt out:

```typescript
import { createPostgresCronLock } from 'theokit/server/cron'

export default config()
  .set({ cron: { lock: createPostgresCronLock(pool) } }) // or { lock: false }
  .build()
```

If the lock cannot be reached, that tick is skipped and logged rather than run on every replica.
With no lock, a single process behaves as before, and the boot line says the crons are not guarded.

`theokit dev` does not schedule crons unless asked, so a cron that sends mail does not do it on
every dev boot. It prints how many are declared; `theokit dev --crons` schedules them. Cron files
are loaded once at boot, so an edit takes effect after restarting `dev`.

## CLI

```bash
theokit dev | build | start          # build takes --target <adapter>, dev takes --crons
theokit generate <type> <name>       # page, route, action, ws, controller, agent, toolbox, …
theokit agent <name> [message]       # run an agent in the terminal, approvals included
theokit routes | check | doctor | info
theokit openapi | db <action> | migrate <kind> | docker | add <package>
theokit mcp <agent>                  # serve an agent as an MCP server over stdio
```

## Deploy

`theokit build --target <name>`: `node` (default), `theo-cloud`, `vercel`, `netlify`,
`cloudflare`, `bun`, `deno-deploy`, `aws-lambda`, `static`.

`theokit start` and `theokit dev` answer two reserved routes ahead of your own:
`GET /__theo/health` is always 200 while the process is up, and `GET /__theo/ready` is 200 only
when the app's dependencies answer, 503 otherwise. Readiness pings a `jobs.backend` that supports
it (`PostgresJobBackend` runs `SELECT 1`) and calls the `ready` probe you declare:

```typescript
export default config()
  .set({ ready: async () => (await pool.query('SELECT 1')).rowCount === 1 })
  .build()
```

The entries the `vercel`, `netlify`, `cloudflare`, `bun`, `deno-deploy` and `aws-lambda` targets
emit answer the same two routes. A `ready` probe is a function, which a generated entry cannot
carry, so on those targets `theokit build` names it as not applied and `GET /__theo/ready` answers
503 while it stays in the config. Remove `ready`, or build for `node`, to get a 200 there.

Cloudflare Workers, step by step: [`docs/wiki/sops/cloudflare-deploy.md`](https://github.com/usetheokit/theokit/blob/main/docs/wiki/sops/cloudflare-deploy.md).

## Guarding MCP tool calls with plugins

`handleMcpToolsJsonRpc`, `handleMcpJsonRpc` and `handleMcpStdioLine` from `theokit/server/agent` take a trailing `McpToolsOptions`: `plugins` (the `pre_tool_call` hooks of these plugins run before each `tools/call`) and `hookContext` (`{ agentId }`; a `runId` is generated per call). A blocking hook, or one that throws, answers the call with `isError: true` and the plugin message, and the tool does not run. `tools/list` is not filtered. Without options nothing changes.

## Licence

Apache-2.0 — see `LICENSE`.

## Serving tools over MCP (HTTP)

`theokit/server/agent` exports two helpers for serving a list of `CustomTool`s as an MCP server:

- `handleMcpToolsHttp(tools, name, request, options?)` handles a whole HTTP request: 405 with `allow: POST` for other methods, 400 with `-32700` for bad JSON, 400 with `-32600` for a batch, and 202 with an empty body for a notification such as `notifications/initialized`. `initialize` echoes the client's `protocolVersion` when it is in `options.protocolVersions` (default `2025-06-18`, `2025-03-26`, `2024-11-05`), else the newest.
- `handleMcpToolsJsonRpc(tools, name, body)` takes an already parsed body. A message without `id` (notification) gets a 202 with an empty body, `ping` returns `{}`, and a successful `tools/call` carries `isError: false`. The agent MCP route and stdio (which writes no line for a notification) behave the same.

## Durable human-in-the-loop approvals

By default a pending `@HumanInTheLoop` approval lives in the memory of the process that holds the paused run, so a restart loses it and the listing answers `scope: 'instance'`. To keep approvals in a store instead, configure a durable registry once at startup:

```ts
import {
  configureApprovalRegistry,
  createDurableApprovalRegistry,
  createFileApprovalStore,
} from 'theokit/server/agent'

configureApprovalRegistry(createDurableApprovalRegistry(createFileApprovalStore('.theokit/approvals')))
```

A gated call is then written to the store and the run ends deferred; `GET /api/agents/<name>/approvals` lists from the store (`scope: 'shared'`), and `POST /api/agents/<name>/approve/<id>` resumes the same session with the decision. An expired record is settled by its `onTimeout`. Instances share approvals only when they share the store directory (and the agent's session storage); implement `ApprovalStore` for Redis or a database otherwise.
