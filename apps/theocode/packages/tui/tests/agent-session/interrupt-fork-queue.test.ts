import { describe, expect, it, vi } from 'vitest'

import { makeInterruptTurn, newForkGate } from '../../src/agent-session/interrupt.js'
import { noteTurnStart } from '../../src/persistence/fork-session.js'

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
    noteTurnStart()
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

  it('does not start the queued fork when a third turn started before React showed it', async () => {
    // `hasActiveTurn` is render state and still says false: only the turn-start tracking knows.
    const active = { v: true }
    const { releases, forkSession, interrupt } = setup(active)
    interrupt() // A
    noteTurnStart() // B
    interrupt() // B, queued
    active.v = false
    noteTurnStart() // C submitted; streaming not yet published
    releases[0]!()
    await new Promise((r) => setTimeout(r, 0))
    expect(forkSession).toHaveBeenCalledTimes(1)
  })

  it('does not fork again for repeated Escape on the same turn', async () => {
    const active = { v: true }
    const { releases, forkSession, interrupt } = setup(active)
    interrupt()
    interrupt()
    interrupt()
    releases[0]!()
    await new Promise((r) => setTimeout(r, 0))
    expect(forkSession).toHaveBeenCalledTimes(1)
  })
})
