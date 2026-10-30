import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CronLock } from '../../packages/theo/src/server/cron/cron-lock.js'
import { createCronScheduler } from '../../packages/theo/src/server/cron/cron-runtime-node.js'
import type { CronDefinition } from '../../packages/theo/src/server/cron/cron-types.js'

/**
 * Every process running `theokit start` scheduled every cron with only an in-memory flag, so two
 * replicas fired each tick twice, 1 ms apart (usetheokit/theokit#1016). With a lock, each tick asks
 * it first and only the process that wins runs the handler.
 *
 * The schedule carries a seconds field so a tick arrives within a second; `defineCron` validates
 * five fields, the scheduler itself parses either.
 */
const everySecond = (handler: () => void): CronDefinition => ({
  name: 'probe',
  schedule: '* * * * * *',
  concurrency: 'forbid',
  handler,
})

const schedulers: { stop(): void }[] = []
afterEach(() => {
  for (const s of schedulers.splice(0)) s.stop()
  vi.restoreAllMocks()
})

function until(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  return new Promise((ok, fail) => {
    const poll = (): void => {
      if (check()) return ok()
      if (Date.now() > deadline) return fail(new Error('condition not met in time'))
      setTimeout(poll, 10)
    }
    poll()
  })
}

describe('createCronScheduler with a lock', () => {
  it('two schedulers sharing a lock fire each tick once between them', async () => {
    const won = new Set<string>()
    const lock: CronLock = {
      acquire: (name, scheduledAt) => {
        const key = `${name}@${scheduledAt.toISOString()}`
        if (won.has(key)) return Promise.resolve(false)
        won.add(key)
        return Promise.resolve(true)
      },
    }
    const fired: string[] = []
    const a = createCronScheduler([everySecond(() => fired.push('a'))], { lock })
    const b = createCronScheduler([everySecond(() => fired.push('b'))], { lock })
    schedulers.push(a, b)
    a.start()
    b.start()
    await until(() => won.size >= 2)
    await new Promise((r) => setTimeout(r, 50))
    expect(fired).toHaveLength(won.size)
  })

  it('a lock that fails skips the tick and logs why, instead of firing unguarded', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    let attempts = 0
    const lock: CronLock = {
      acquire: () => {
        attempts++
        return Promise.reject(new Error('connection refused'))
      },
    }
    const handler = vi.fn()
    const s = createCronScheduler([everySecond(handler)], { lock })
    schedulers.push(s)
    s.start()
    await until(() => attempts >= 1)
    await new Promise((r) => setTimeout(r, 50))
    expect(handler).not.toHaveBeenCalled()
    expect(error.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('connection refused')
  })

  it('without a lock the scheduler fires as before', async () => {
    const handler = vi.fn()
    const s = createCronScheduler([everySecond(handler)])
    schedulers.push(s)
    s.start()
    await until(() => handler.mock.calls.length >= 1)
    expect(handler).toHaveBeenCalled()
  })
})
