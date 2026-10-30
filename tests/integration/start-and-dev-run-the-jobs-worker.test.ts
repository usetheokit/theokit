import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { afterAll, describe, expect, it, vi } from 'vitest'

import { startDevServer } from '../../packages/theo/src/cli/commands/dev.js'

import { spawnTheokitStart } from './helpers/spawn-theokit-start.js'

/**
 * `theokit build` scans `server/jobs/` and writes `.theokit/jobs.json`, and `theokit start` never
 * read it: no job module was imported and no runner loop existed, so an enqueued job sat in the
 * backend forever (usetheokit/theokit#1010).
 *
 * `theokit dev` gets the same worker, loading the job files through Vite, so a job can be exercised
 * without a production build.
 *
 * The job writes a marker file, which is the only evidence that crosses the process boundary
 * without trusting the server's own report. The manifest is written by hand in the shape
 * `writeJobManifest` produces, so the test does not pay for a full build.
 */
const REPO = resolve(__dirname, '../..')
const JOBS_BARREL = resolve(REPO, 'packages/theo/src/server/jobs/index.ts')
const ROOT = resolve(__dirname, '..', '.tmp-start-and-dev-run-the-jobs-worker')

function writeApp(name: string, worker: string): string {
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
    `import { InMemoryJobBackend } from ${JSON.stringify(JOBS_BARREL)}
export default { jobs: { backend: new InMemoryJobBackend(), worker: ${worker} } }
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

describe('theokit start and theokit dev run server/jobs', () => {
  afterAll(() => {
    rmSync(ROOT, { recursive: true, force: true })
  })

  it('runs an enqueued job, and stops the worker on SIGTERM with exit 0', async () => {
    const app = writeApp('worker-on', '{ pollIntervalMs: 50 }')
    const server = await spawnTheokitStart(app)
    let ended: Awaited<ReturnType<typeof server.stop>> | undefined
    try {
      expect(server.output()).toMatch(/Jobs: 1 declared, worker polling the memory backend/)
      await enqueue(server.origin)
      expect(await waitForFile(join(app, 'job-ran.json'), 5000), server.output()).toBe(true)
      expect(JSON.parse(readFileSync(join(app, 'job-ran.json'), 'utf-8'))).toEqual({ who: 'probe' })
    } finally {
      ended = await server.stop()
    }
    expect(ended.code, server.output()).toBe(0)
    expect(server.output()).toContain('jobs worker stopped')
  }, 90_000)

  it('leaves jobs in the backend when jobs.worker.enabled is false, and says so', async () => {
    const app = writeApp('worker-off', '{ enabled: false }')
    const server = await spawnTheokitStart(app)
    try {
      expect(server.output()).toMatch(/Jobs: 1 declared, worker disabled \(jobs\.worker\.enabled/)
      await enqueue(server.origin)
      expect(await waitForFile(join(app, 'job-ran.json'), 1500)).toBe(false)
    } finally {
      await server.stop()
    }
  }, 90_000)

  it('theokit dev runs an enqueued job through the same worker', async () => {
    const app = writeApp('dev-worker', '{ pollIntervalMs: 50 }')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const server = await startDevServer(app, { port: 0 })
    try {
      const address = server.httpServer?.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      await enqueue(`http://localhost:${String(port)}`)
      expect(await waitForFile(join(app, 'job-ran.json'), 5000)).toBe(true)
    } finally {
      await server.close()
    }
  }, 90_000)
})
