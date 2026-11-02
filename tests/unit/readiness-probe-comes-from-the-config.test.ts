import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  READY_PATH,
  serveReservedRoute,
} from '../../packages/theo/src/server/define/health-route.js'
import type { JobBackend } from '../../packages/theo/src/server/jobs/job-backend.js'
import { reservedRoutesFromConfig } from '../../packages/theo/src/server/reserved-routes-from-config.js'

/**
 * `/__theo/ready` answered 200 with the job database down: `theokit start` registered only the
 * liveness route, and no config key could supply a readiness probe (usetheokit/theokit#1071).
 * Readiness is now built from the config: the `ready` probe the app declares, and the configured
 * `jobs.backend` when it can be pinged.
 */
function backendWithPing(ping: () => Promise<void>): JobBackend {
  return {
    name: 'fake',
    enqueue: () => Promise.resolve({ jobId: 'x' }),
    dequeue: () => Promise.resolve([]),
    ack: () => Promise.resolve(),
    nack: () => Promise.resolve(),
    ping,
  }
}

async function readiness(config: Parameters<typeof reservedRoutesFromConfig>[0]) {
  return serveReservedRoute(READY_PATH, reservedRoutesFromConfig(config))
}

describe('the readiness route is built from theo.config.ts', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('test_an_app_with_nothing_to_probe_is_ready', async () => {
    expect(await readiness({})).toEqual({ status: 200, body: { status: 'ready' } })
  })

  it('test_an_unreachable_job_backend_makes_the_app_not_ready', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const down = backendWithPing(() => Promise.reject(new Error('connect ECONNREFUSED')))
    expect(await readiness({ jobs: { backend: down } as never })).toEqual({
      status: 503,
      body: { status: 'not-ready' },
    })
  })

  it('test_the_declared_ready_probe_decides_when_dependencies_are_up', async () => {
    const up = backendWithPing(() => Promise.resolve())
    expect(await readiness({ ready: () => false })).toMatchObject({ status: 503 })
    expect(await readiness({ ready: () => Promise.resolve(true) })).toMatchObject({ status: 200 })
    expect(await readiness({ jobs: { backend: up } as never, ready: () => false })).toMatchObject({
      status: 503,
    })
    expect(await readiness({ jobs: { backend: up } as never, ready: () => true })).toMatchObject({
      status: 200,
    })
  })
})
