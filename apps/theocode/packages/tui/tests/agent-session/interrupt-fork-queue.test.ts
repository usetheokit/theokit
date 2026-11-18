import { describe, expect, it, vi } from 'vitest'

import { makeInterruptTurn, newForkGate } from '../../src/agent-session/interrupt.js'

const setup = (active: { v: boolean }) => {
  const releases: Array<() => void> = []
  const forkSession = vi.fn(
    () =>
      new Promise<{ newId: string; copied: boolean }>((r) =>
        releases.push(() => r({ newId: 'x', copied: true })),
      ),
  )
  const gate = newForkGate()
  const interrupt = makeInterruptTurn(
    {
      abort: vi.fn(),
      forkSession,
      hasActiveTurn: () => active.v,
      hasPendingApproval: () => false,
      onForkFailure: vi.fn(),
      onInterrupted: vi.fn(),
    },
    gate,
  )
  return { releases, forkSession, interrupt }
}

describe('interrupt fork queue', () => {
  it('runs a second fork for a second interrupted turn after the first settles', async () => {
    const active = { v: true }
    const { releases, forkSession, interrupt } = setup(active)
    interrupt() // turn A
    active.v = true // turn B starts and is interrupted while A's fork copies
    interrupt()
    interrupt()
    expect(forkSession).toHaveBeenCalledTimes(1)
    active.v = false // B has been aborted by the time A's fork settles
    releases[0]!()
    await vi.waitFor(() => expect(forkSession).toHaveBeenCalledTimes(2))
    releases[1]!()
    await new Promise((r) => setTimeout(r, 0))
    expect(forkSession).toHaveBeenCalledTimes(2)
  })

  it('does not start the queued fork while a third turn is running', async () => {
    const active = { v: true }
    const { releases, forkSession, interrupt } = setup(active)
    interrupt() // A
    interrupt() // B, queued
    active.v = true // C is live when A's fork settles
    releases[0]!()
    await new Promise((r) => setTimeout(r, 0))
    expect(forkSession).toHaveBeenCalledTimes(1)
  })
})
