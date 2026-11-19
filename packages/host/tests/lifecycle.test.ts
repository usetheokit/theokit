import { describe, expect, it } from 'vitest'
import { createHostLifecycle, HostError } from '../src/index.js'

function svc(name: string, log: string[], opts: { failStart?: boolean; failStop?: boolean } = {}) {
  return {
    name,
    start() {
      log.push(`start:${name}`)
      if (opts.failStart) throw new Error('boom')
    },
    stop() {
      log.push(`stop:${name}`)
      if (opts.failStop) throw new Error('stopboom')
    },
  }
}

describe('createHostLifecycle', () => {
  it('starts in order and stops in reverse', async () => {
    const log: string[] = []
    const host = createHostLifecycle([svc('a', log), svc('b', log)])
    await host.start()
    await host.stop()
    expect(log).toEqual(['start:a', 'start:b', 'stop:b', 'stop:a'])
  })

  it('rolls back started services when one fails to start', async () => {
    const log: string[] = []
    const host = createHostLifecycle([svc('a', log), svc('b', log, { failStart: true })])
    const error = await host.start().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(HostError)
    expect((error as HostError).code).toBe('host_start_failed')
    expect(log).toEqual(['start:a', 'start:b', 'stop:a'])
  })

  it('runs every stop even when one fails', async () => {
    const log: string[] = []
    const host = createHostLifecycle([svc('a', log), svc('b', log, { failStop: true })])
    await host.start()
    const error = await host.stop().catch((e: unknown) => e)
    expect((error as HostError).code).toBe('host_stop_failed')
    expect(log.slice(-2)).toEqual(['stop:b', 'stop:a'])
  })

  it('rejects a second start', async () => {
    const host = createHostLifecycle([svc('a', [])])
    await host.start()
    await expect(host.start()).rejects.toMatchObject({ code: 'host_already_started' })
  })
})
