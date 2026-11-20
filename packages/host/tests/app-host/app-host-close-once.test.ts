import { describe, expect, it } from 'vitest'
import { createAppHost } from '../../src/app-host/index.js'

describe('app host close once', () => {
  it('stops each service once for concurrent close calls', async () => {
    const stops: string[] = []
    const host = createAppHost()
    host.service(
      'A',
      () => 1,
      () => {
        stops.push('A')
      },
    )
    host.service(
      'B',
      () => 1,
      async () => {
        stops.push('B')
      },
    )
    await host.start()
    const [one, two] = await Promise.all([host.close(), host.close()])
    expect(one).toBe(two)
    expect(stops).toEqual(['B', 'A'])
  })

  it('close during start waits and stops what started', async () => {
    const stops: string[] = []
    let open!: () => void
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    const host = createAppHost()
    host.service(
      'A',
      async () => {
        await gate
      },
      () => {
        stops.push('A')
      },
    )
    host.service(
      'B',
      () => 1,
      () => {
        stops.push('B')
      },
    )
    const started = host.start()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const closing = host.close()
    open()
    const closed = await closing
    await started
    expect(closed).toEqual({ ok: true })
    expect(stops).toEqual(['A'])
  })
})
