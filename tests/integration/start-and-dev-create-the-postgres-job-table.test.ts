import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { afterAll, describe, expect, it, vi } from 'vitest'

import { startDevServer } from '../../packages/theo/src/cli/commands/dev.js'

import { spawnTheokitStart } from './helpers/spawn-theokit-start.js'

/**
 * A `PostgresJobBackend` configured the way the README shows had no table: nothing called
 * `migrate()`, the worker logged `relation "theokit_jobs" does not exist` on every tick, the route
 * answered 2xx and the outbox dropped the job (usetheokit/theokit#1072). The workaround, a
 * top-level `await backend.migrate()` in `theo.config.ts`, made `theokit build` need a database.
 *
 * `theokit start` and `theokit dev` own the worker, so they create the table at boot, and a boot
 * that cannot create it fails instead of serving requests whose jobs go nowhere.
 *
 * Each app gets its own table so the cases cannot see each other's rows. The job writes a marker
 * file: the evidence that the enqueued job reached the table and was run from it.
 */
const POSTGRES_URL = process.env.POSTGRES_URL
const REPO = resolve(__dirname, '../..')
const JOBS_BARREL = resolve(REPO, 'packages/theo/src/server/jobs/index.ts')
const TSX = resolve(REPO, 'node_modules/.bin/tsx')
const CLI = resolve(REPO, 'packages/theo/src/cli/index.ts')
const ROOT = resolve(__dirname, '..', '.tmp-start-and-dev-create-the-postgres-job-table')

function writeApp(name: string, connectionString: string, table: string): string {
  const app = join(ROOT, name)
  rmSync(app, { recursive: true, force: true })
  mkdirSync(join(app, 'server', 'routes'), { recursive: true })
  mkdirSync(join(app, 'server', 'jobs'), { recursive: true })
  mkdirSync(join(app, '.theokit', 'client'), { recursive: true })
  mkdirSync(join(app, 'app'), { recursive: true })
  writeFileSync(join(app, 'app', 'page.tsx'), 'export default function Page() { return null }\n')
  writeFileSync(join(app, 'package.json'), '{ "type": "module" }')
  writeFileSync(join(app, '.theokit', 'client', 'index.html'), '<!doctype html><div id="root">')
  writeFileSync(
    join(app, 'theo.config.ts'),
    `import pg from 'pg'
import { PostgresJobBackend } from ${JSON.stringify(JOBS_BARREL)}
const pool = new pg.Pool({ connectionString: ${JSON.stringify(connectionString)}, connectionTimeoutMillis: 3000 })
export default {
  jobs: {
    backend: new PostgresJobBackend({ pool, tableName: ${JSON.stringify(table)} }),
    worker: { pollIntervalMs: 50 },
  },
}
`,
  )
  writeFileSync(
    join(app, 'server', 'jobs', 'hello.ts'),
    `import { writeFileSync } from 'node:fs'
import { defineJob } from ${JSON.stringify(JOBS_BARREL)}
export default defineJob('hello', {
  handler: async ({ input }) => {
    writeFileSync(${JSON.stringify(join(app, 'job-ran.json'))}, JSON.stringify(input))
  },
})
`,
  )
  writeFileSync(
    join(app, 'server', 'routes', 'enqueue.ts'),
    `export const POST = {
  policy: 'public',
  handler: ({ ctx }) => {
    ctx.queue.enqueue('hello', { who: 'probe' })
    return { ok: true }
  },
}
`,
  )
  writeFileSync(
    join(app, '.theokit', 'jobs.json'),
    JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      jobs: [
        { name: 'hello', filePath: 'server/jobs/hello.ts', maxAttempts: 1, hasInputSchema: false },
      ],
    }),
  )
  return app
}

async function enqueue(origin: string): Promise<void> {
  const res = await fetch(`${origin}/api/enqueue`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-theo-action': '1' },
    body: '{}',
    signal: AbortSignal.timeout(5000),
  })
  expect(res.status).toBe(200)
}

async function waitForFile(path: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(path)) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return false
}

/** Run `theokit start` until it exits on its own; a boot that keeps serving is killed and fails. */
function runStartToExit(cwd: string): Promise<{ code: number | null; output: string }> {
  return new Promise((ok, fail) => {
    let output = ''
    const child: ChildProcess = spawn(TSX, [CLI, 'start', '--port', '0'], {
      cwd,
      env: { ...process.env, NODE_ENV: 'production' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout?.on('data', (d: Buffer) => (output += d.toString()))
    child.stderr?.on('data', (d: Buffer) => (output += d.toString()))
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      fail(new Error(`theokit start kept running with an unreachable job database:\n${output}`))
    }, 60_000)
    child.once('exit', (code) => {
      clearTimeout(timer)
      ok({ code, output })
    })
  })
}

const uniqueTable = (label: string): string =>
  `theokit_jobs_boot_${label}_${String(Date.now())}_${String(process.pid)}`

describe.skipIf(!POSTGRES_URL)('theokit start and dev create the Postgres job table', () => {
  const tables: string[] = []

  afterAll(async () => {
    rmSync(ROOT, { recursive: true, force: true })
    const pg = (await import('pg')).default
    const pool = new pg.Pool({ connectionString: POSTGRES_URL })
    try {
      for (const t of tables) await pool.query(`DROP TABLE IF EXISTS ${t}`)
    } finally {
      await pool.end()
    }
  })

  it('test_start_runs_a_job_enqueued_into_a_fresh_database_without_a_migrate_call', async () => {
    const table = uniqueTable('start')
    tables.push(table)
    const app = writeApp('start', POSTGRES_URL!, table)
    const server = await spawnTheokitStart(app)
    try {
      expect(server.output()).not.toMatch(/does not exist/)
      await enqueue(server.origin)
      expect(await waitForFile(join(app, 'job-ran.json'), 10_000), server.output()).toBe(true)
      expect(JSON.parse(readFileSync(join(app, 'job-ran.json'), 'utf-8'))).toEqual({ who: 'probe' })
      expect(server.output()).not.toMatch(/does not exist/)
    } finally {
      await server.stop()
    }
  }, 120_000)

  it('test_dev_runs_a_job_enqueued_into_a_fresh_database_without_a_migrate_call', async () => {
    const table = uniqueTable('dev')
    tables.push(table)
    const app = writeApp('dev', POSTGRES_URL!, table)
    const errors = vi.spyOn(console, 'error')
    const warnings = vi.spyOn(console, 'warn')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const server = await startDevServer(app, { port: 0 })
    try {
      const address = server.httpServer?.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      await enqueue(`http://localhost:${String(port)}`)
      expect(await waitForFile(join(app, 'job-ran.json'), 10_000)).toBe(true)
      const logged = [...errors.mock.calls, ...warnings.mock.calls].flat().map(String).join('\n')
      expect(logged).not.toMatch(/does not exist/)
    } finally {
      await server.close()
      vi.restoreAllMocks()
    }
  }, 120_000)

  it('test_start_refuses_to_boot_when_it_cannot_create_the_job_table', async () => {
    const unreachable = new URL(POSTGRES_URL!)
    unreachable.port = '1'
    const app = writeApp('unreachable', unreachable.toString(), uniqueTable('unreachable'))
    const ended = await runStartToExit(app)
    expect(ended.code, ended.output).not.toBe(0)
    expect(ended.output).toMatch(/jobs\.backend/)
    expect(ended.output).toMatch(/ECONNREFUSED/)
    expect(ended.output).not.toMatch(/Theo production server/)
  }, 120_000)
})
