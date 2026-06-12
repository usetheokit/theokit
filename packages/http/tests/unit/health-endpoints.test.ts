import { describe, it, expect } from 'vitest'
import 'reflect-metadata'
import { TheoApp } from '../../src/app.js'
import { Controller, Get } from '../../src/index.js'

// Bun lacks emitDecoratorMetadata support (same as esbuild). Tests using
// decorator syntax require SWC compilation provided by vitest. Skip on Bun.
const isVitest = typeof process !== 'undefined' && !!process.env.VITEST

// Minimal controller for TheoApp.create()
@Controller('/api/noop')
class NoopController {
  @Get('/')
  index() {
    return 'ok'
  }
}

async function createApp(opts: Record<string, unknown> = {}) {
  return TheoApp.create({ controllers: [NoopController], ...opts })
}

async function fetch(
  app: TheoApp,
  path: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const handle = app.getServerHandle()
  await new Promise<void>((r) => handle.listen(0, r))
  const addr = handle.address()
  const port = addr?.port ?? 0
  const res = await globalThis.fetch(`http://localhost:${port}${path}`)
  const body = (await res.json()) as Record<string, unknown>
  await new Promise<void>((r) => handle.close(r))
  return { status: res.status, body }
}

describe.skipIf(!isVitest)('Health & Readiness Endpoints', () => {
  it('test_health_returns_200_ok', async () => {
    const app = await createApp()
    const { status, body } = await fetch(app, '/__theo/health')
    expect(status).toBe(200)
    expect(body.status).toBe('ok')
    expect(typeof body.uptime).toBe('number')
    expect(typeof body.timestamp).toBe('number')
  })

  it('test_health_custom_path', async () => {
    const app = await createApp({ healthPath: '/custom-health' })
    const { status, body } = await fetch(app, '/custom-health')
    expect(status).toBe(200)
    expect(body.status).toBe('ok')
  })

  it('test_ready_no_checks', async () => {
    const app = await createApp()
    const { status, body } = await fetch(app, '/__theo/ready')
    expect(status).toBe(200)
    expect(body.status).toBe('ready')
    expect(body.checks).toEqual([])
  })

  it('test_ready_all_healthy', async () => {
    const app = await createApp({
      readinessChecks: [
        async () => ({ name: 'db', healthy: true }),
        async () => ({ name: 'redis', healthy: true }),
      ],
    })
    const { status, body } = await fetch(app, '/__theo/ready')
    expect(status).toBe(200)
    expect(body.status).toBe('ready')
    const checks = body.checks as { name: string; healthy: boolean }[]
    expect(checks).toHaveLength(2)
    expect(checks.every((c) => c.healthy)).toBe(true)
  })

  it('test_ready_one_failing', async () => {
    const app = await createApp({
      readinessChecks: [
        async () => ({ name: 'db', healthy: true }),
        async () => ({ name: 'redis', healthy: false, message: 'connection refused' }),
      ],
    })
    const { status, body } = await fetch(app, '/__theo/ready')
    expect(status).toBe(503)
    expect(body.status).toBe('not_ready')
  })

  it('test_ready_check_timeout', async () => {
    const app = await createApp({
      readinessChecks: [
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ name: 'slow', healthy: true }), 10_000),
          ),
      ],
    })
    const start = Date.now()
    const { status, body } = await fetch(app, '/__theo/ready')
    const elapsed = Date.now() - start
    expect(status).toBe(503)
    expect(body.status).toBe('not_ready')
    expect(elapsed).toBeLessThan(7000) // 5s timeout + overhead
  }, 10_000)

  it('test_ready_check_sync_throw', async () => {
    // EC-3: readiness check that throws synchronously should not crash server
    const app = await createApp({
      readinessChecks: [
        () => {
          throw new Error('sync boom')
        },
      ],
    })
    const { status, body } = await fetch(app, '/__theo/ready')
    expect(status).toBe(503)
    expect(body.status).toBe('not_ready')
    const checks = body.checks as { healthy: boolean; message?: string }[]
    expect(checks[0].healthy).toBe(false)
    expect(checks[0].message).toContain('sync boom')
  })

  it('test_ready_checks_run_parallel', async () => {
    // Two checks each taking 1s should complete in ~1s (parallel), not 2s
    const app = await createApp({
      readinessChecks: [
        () => new Promise((r) => setTimeout(() => r({ name: 'a', healthy: true }), 1000)),
        () => new Promise((r) => setTimeout(() => r({ name: 'b', healthy: true }), 1000)),
      ],
    })
    const start = Date.now()
    const { status } = await fetch(app, '/__theo/ready')
    const elapsed = Date.now() - start
    expect(status).toBe(200)
    expect(elapsed).toBeLessThan(2000) // parallel: ~1s, not 2s
  }, 5000)
})
