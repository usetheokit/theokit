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
| `./boot`, `./adapters/web-shim`, `./adapters/ws-shim` | Runtime shims |

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

`theokit start` and `theokit dev` run a job worker in the same process whenever jobs are declared
and a backend is set: it polls the backend, runs each job and backs off while the backend is
unreachable. On `SIGTERM`, `start` stops polling and waits up to 20 seconds for the job in progress
before closing storage. `jobs.worker` tunes it (`pollIntervalMs`, `batchSize`, `lockSeconds`), and
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

## Licence

Apache-2.0 — see `LICENSE`.
