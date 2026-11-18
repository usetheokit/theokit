import { describe, expect, it, vi } from 'vitest'

import { makeInterruptTurn } from '../../src/agent-session/interrupt.js'

describe('interrupt fork queue', () => {
  it('runs a second fork for a second interrupted turn after the first settles', async () => {
    const releases: Array<() => void> = []
    const forkSession = vi.fn(
      () =>
        new Promise<{ newId: string; copied: boolean }>((r) =>
          releases.push(() => r({ newId: 'x', copied: true })),
        ),
    )
    const interrupt = makeInterruptTurn({
      abort: vi.fn(),
      forkSession,
      hasActiveTurn: () => true,
      hasPendingApproval: () => false,
      onForkFailure: vi.fn(),
      onInterrupted: vi.fn(),
    })
    interrupt()
    interrupt()
    interrupt()
    expect(forkSession).toHaveBeenCalledTimes(1)
    releases[0]!()
    await vi.waitFor(() => expect(forkSession).toHaveBeenCalledTimes(2))
    releases[1]!()
    await new Promise((r) => setTimeout(r, 0))
    expect(forkSession).toHaveBeenCalledTimes(2)
  })
})
