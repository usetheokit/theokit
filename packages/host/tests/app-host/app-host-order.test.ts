import { describe, expect, it } from 'vitest'
import { createAppHost } from '../../src/app-host/index.js'

describe('app host order', () => {
  it('starts in registration order and stops in reverse', async () => {
    const log: string[] = []
    const host = createAppHost()
    const a = host.service(
      'A',
      () => {
        log.push('start A')
        return 1
      },
      () => {
        log.push('stop A')
      },
    )
    host.service(
      'B',
      async () => {
        log.push('start B')
      },
      () => {
        log.push('stop B')
      },
    )
    host.service(
      'C',
      () => {
        log.push('start C')
      },
      () => {
        log.push('stop C')
      },
    )
    await host.start()
    expect(a()).toBe(1)
    expect(await host.close()).toEqual({ ok: true })
    expect(log).toEqual(['start A', 'start B', 'start C', 'stop C', 'stop B', 'stop A'])
  })

  it('passes the started value to stop', async () => {
    const host = createAppHost()
    let seen: unknown
    host.service(
      'A',
      () => 'v',
      (value) => {
        seen = value
      },
    )
    await host.start()
    await host.close()
    expect(seen).toBe('v')
  })
})
