import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, connect, type Server, type Socket } from 'node:net'
import { join, resolve } from 'node:path'

import { afterAll, describe, expect, it, vi } from 'vitest'

import { startDevServer } from '../../packages/theo/src/cli/commands/dev.js'

import { spawnTheokitStart } from './helpers/spawn-theokit-start.js'

/**
 * `/__theo/ready` answered `{"status":"ready"}` with Postgres stopped, so an orchestrator trusting
 * it sent traffic to an instance whose jobs could not be stored; under `theokit dev` both reserved
 * routes fell through to the SPA's `index.html` with a 200 (usetheokit/theokit#1071).
 *
 * The database is put out of reach through a TCP relay the test owns, so a real Postgres goes away
 * for this server alone, without stopping a container other suites share.
 */
const POSTGRES_URL = process.env.POSTGRES_URL
const REPO = resolve(__dirname, '../..')
const JOBS_BARREL = resolve(REPO, 'packages/theo/src/server/jobs/index.ts')
const ROOT = resolve(__dirname, '..', '.tmp-ready-route-reports-the-job-database')

interface Relay {
  readonly port: number
  /** Refuse new connections and cut the open ones: the database is now unreachable. */
  cut(): Promise<void>
}

async function relayTo(target: URL): Promise<Relay> {
  const sockets = new Set<Socket>()
  const server: Server = createServer((client) => {
    const upstream = connect(Number(target.port || 5432), target.hostname)
    sockets.add(client).add(upstream)
    client.pipe(upstream).pipe(client)
    const drop = (): void => {
      client.destroy()
      upstream.destroy()
    }
    client.on('error', drop).on('close', drop)
    upstream.on('error', drop).on('close', drop)
  })
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  const { port } = server.address() as { port: number }
  return {
    port,
    cut: () =>
      new Promise<void>((ok) => {
        for (const s of sockets) s.destroy()
        server.close(() => {
          ok()
        })
      }),
  }
}

function writeApp(name: string, configBody: string): string {
  const app = join(ROOT, name)
  rmSync(app, { recursive: true, force: true })
  mkdirSync(join(app, '.theokit', 'client'), { recursive: true })
  mkdirSync(join(app, 'app'), { recursive: true })
  writeFileSync(join(app, 'app', 'page.tsx'), 'export default function Page() { return null }\n')
  writeFileSync(join(app, 'package.json'), '{ "type": "module" }')
  writeFileSync(join(app, '.theokit', 'client', 'index.html'), '<!doctype html><div id="root">')
  writeFileSync(join(app, 'theo.config.ts'), configBody)
  return app
}

async function get(origin: string, path: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(10_000) })
  return { status: res.status, body: await res.text() }
}

describe('the readiness route reports the dependencies theo.config.ts declares', () => {
  afterAll(() => {
    rmSync(ROOT, { recursive: true, force: true })
  })

  it.skipIf(!POSTGRES_URL)(
    'test_start_answers_503_on_ready_once_the_job_database_is_unreachable',
    async () => {
      const relay = await relayTo(new URL(POSTGRES_URL!))
      const viaRelay = new URL(POSTGRES_URL!)
      viaRelay.hostname = '127.0.0.1'
      viaRelay.port = String(relay.port)
      const app = writeApp(
        'start',
        `import pg from 'pg'
import { PostgresJobBackend } from ${JSON.stringify(JOBS_BARREL)}
const pool = new pg.Pool({ connectionString: ${JSON.stringify(viaRelay.toString())}, connectionTimeoutMillis: 2000 })
export default {
  jobs: { backend: new PostgresJobBackend({ pool, tableName: 'theokit_jobs_ready_probe' }) },
}
`,
      )
      const server = await spawnTheokitStart(app)
      try {
        expect(await get(server.origin, '/__theo/ready')).toEqual({
          status: 200,
          body: '{"status":"ready"}',
        })
        await relay.cut()
        expect(await get(server.origin, '/__theo/ready')).toEqual({
          status: 503,
          body: '{"status":"not-ready"}',
        })
        expect(await get(server.origin, '/__theo/health')).toEqual({
          status: 200,
          body: '{"status":"ok"}',
        })
      } finally {
        await server.stop()
        await relay.cut()
      }
    },
    120_000,
  )

  it('test_dev_serves_the_reserved_routes_instead_of_the_spa', async () => {
    const app = writeApp('dev', `export default { ready: () => false }\n`)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const server = await startDevServer(app, { port: 0 })
    try {
      const address = server.httpServer?.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      const origin = `http://localhost:${String(port)}`
      expect(await get(origin, '/__theo/ready')).toEqual({
        status: 503,
        body: '{"status":"not-ready"}',
      })
      expect(await get(origin, '/__theo/health')).toEqual({
        status: 200,
        body: '{"status":"ok"}',
      })
    } finally {
      await server.close()
      vi.restoreAllMocks()
    }
  }, 120_000)
})
