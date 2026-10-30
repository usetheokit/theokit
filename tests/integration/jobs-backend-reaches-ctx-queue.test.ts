import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { startDevServer } from '../../packages/theo/src/cli/commands/dev.js'

import { spawnTheokitStart } from './helpers/spawn-theokit-start.js'

/**
 * `jobs: { backend }` in `theo.config.ts` was parsed and then read by nothing: `executeRoute` wires
 * `ctx.queue` only when handed a `jobBackend`, and neither `theokit start` nor `theokit dev` passed
 * one, so `ctx.queue` was undefined and `ctx.queue.enqueue(...)` threw (usetheokit/theokit#1009).
 *
 * The app enqueues from a route and a second route reads the configured backend directly, so the
 * assertion is about the job reaching the backend the config declared, not about a key existing.
 * `theokit start` runs as a real process (the CLI from source through tsx); `theokit dev` boots
 * in-process like `dev-applies-the-storage-config.test.ts`. The app lives under the repository so
 * `react` and `vite` resolve from the workspace.
 */
const REPO = resolve(__dirname, '../..')
const APP = resolve(__dirname, '..', '.tmp-jobs-backend-reaches-ctx-queue')
const JOBS_BARREL = resolve(REPO, 'packages/theo/src/server/jobs/index.ts')

function writeApp(): void {
  rmSync(APP, { recursive: true, force: true })
  mkdirSync(join(APP, 'app'), { recursive: true })
  mkdirSync(join(APP, 'server', 'routes'), { recursive: true })
  mkdirSync(join(APP, '.theokit', 'client'), { recursive: true })
  writeFileSync(join(APP, 'package.json'), '{ "type": "module" }')
  writeFileSync(join(APP, 'app', 'page.tsx'), 'export default function Page() { return null }\n')
  // `theokit start` refuses to boot without a client build; the route table comes from the scan.
  writeFileSync(join(APP, '.theokit', 'client', 'index.html'), '<!doctype html><div id="root">')
  writeFileSync(
    join(APP, 'theo.config.ts'),
    `import { InMemoryJobBackend } from ${JSON.stringify(JOBS_BARREL)}
// On globalThis because \`theokit dev\` loads route modules through Vite's module graph, so a route
// importing this file gets a second evaluation of it. The framework reads the instance the config
// loader evaluated; the probe route must read that same one.
export const backend = (globalThis.__probeJobBackend ??= new InMemoryJobBackend())
export default { jobs: { backend, worker: { enabled: false } } }
`,
  )
  writeFileSync(
    join(APP, 'server', 'routes', 'enqueue.ts'),
    `export const POST = {
  policy: 'public',
  handler: ({ ctx }) => {
    if (ctx.queue === undefined) return { hasQueue: false }
    ctx.queue.enqueue('hello', { who: 'probe' })
    return { hasQueue: true }
  },
}
`,
  )
  writeFileSync(
    join(APP, 'server', 'routes', 'pending.ts'),
    `import { backend } from '../../theo.config.ts'
export const GET = {
  policy: 'public',
  handler: async () => {
    const leases = await backend.dequeue({ batchSize: 10, lockSeconds: 1 })
    return { names: leases.map((l) => l.name), inputs: leases.map((l) => l.input) }
  },
}
`,
  )
}

async function enqueueThenReadBackend(origin: string): Promise<{
  enqueue: unknown
  pending: unknown
}> {
  const enqueue = (await (
    await fetch(`${origin}/api/enqueue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-theo-action': '1' },
      body: '{}',
      signal: AbortSignal.timeout(5000),
    })
  ).json()) as unknown
  // The outbox flushes on the response's `finish` event; give it one turn.
  await new Promise((r) => setTimeout(r, 200))
  const pending = (await (
    await fetch(`${origin}/api/pending`, { signal: AbortSignal.timeout(5000) })
  ).json()) as unknown
  return { enqueue, pending }
}

describe('jobs.backend reaches ctx.queue', () => {
  beforeAll(() => {
    writeApp()
  })

  afterAll(() => {
    rmSync(APP, { recursive: true, force: true })
  })

  it('under theokit start, a route enqueues into the configured backend', async () => {
    const app = await spawnTheokitStart(APP)
    try {
      const { enqueue, pending } = await enqueueThenReadBackend(app.origin)
      expect(enqueue, app.output()).toEqual({ hasQueue: true })
      expect(pending).toEqual({ names: ['hello'], inputs: [{ who: 'probe' }] })
    } finally {
      await app.stop()
    }
  }, 90_000)

  it('under theokit dev, a route enqueues into the configured backend', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const server = await startDevServer(APP, { port: 0 })
    try {
      const address = server.httpServer?.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      const { enqueue, pending } = await enqueueThenReadBackend(`http://localhost:${String(port)}`)
      expect(enqueue).toEqual({ hasQueue: true })
      expect(pending).toEqual({ names: ['hello'], inputs: [{ who: 'probe' }] })
    } finally {
      await server.close()
    }
  }, 90_000)
})
