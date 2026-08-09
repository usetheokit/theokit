import { describe, expect, it } from 'vitest'

import { ApprovalAbortedError, InProcessTransport } from '../../src/client/in-process-transport.js'

/**
 * M92 T3.1 — an approval parked in an aborted turn stops hanging the tool call.
 *
 * ## The defect
 *
 * `#pending` kept only the `resolve`, and nothing erased the entry when the turn aborted. The promise
 * stayed pending **forever** and the SDK's tool call hung with it.
 *
 * A promise that neither resolves **nor** rejects is the quietest way to swallow an error: there is
 * no `catch` that sees it, no stack trace, no timeout. `error-handling.md § 2` forbids swallowing;
 * this case was worse than a `catch {}`, because a `catch {}` at least leaves a trace in the code.
 *
 * ## Why REJECT and not `resolve(false)`
 *
 * `false` is indistinguishable from *"the user denied"*. Denying is a decision; aborting is an
 * interruption. The SDK needs both to unwind the call correctly, and a consumer that records decisions
 * would record a denial that never happened.
 */
describe('M92 — the in-process transport evicts approvals from an aborted turn', () => {
  const build = (): {
    transporte: InProcessTransport
    aprovar: () => Promise<unknown>
    abortar: () => void
  } => {
    let park: (() => Promise<unknown>) | undefined
    const controller = new AbortController()
    const transporte = new InProcessTransport({
      run: (opts: { awaitApproval: (r: { approvalId: string }) => Promise<unknown> }) => {
        park = () => opts.awaitApproval({ approvalId: 'ap-1' })
        return (async function* () {
          await new Promise(() => undefined)
          yield undefined as never
        })()
      },
    } as never)
    void transporte.sendMessages({
      messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'oi' }] }],
      abortSignal: controller.signal,
    } as never)
    return {
      transporte,
      aprovar: () => park!(),
      abortar: () => {
        controller.abort()
      },
    }
  }

  it('abort REJECTS the parked approval with a TYPED error', async () => {
    const { aprovar, abortar } = build()
    const p = aprovar()
    abortar()
    await expect(p).rejects.toBeInstanceOf(ApprovalAbortedError)
  })

  it('the entry is EVICTED — it does not leak in the Map', async () => {
    const { transporte, aprovar, abortar } = build()
    const p = aprovar()
    expect(transporte.pendentes).toBe(1)
    abortar()
    await expect(p).rejects.toThrow()
    expect(transporte.pendentes).toBe(0)
  })

  it('the error names the approval and the reason — diagnostic, not just the type', async () => {
    const { aprovar, abortar } = build()
    const p = aprovar()
    abortar()
    await expect(p).rejects.toThrow(/ap-1/)
    await expect(p).rejects.toThrow(/aborted/)
  })

  it('a DECIDED approval stays distinct from an aborted one', async () => {
    const { transporte, aprovar } = build()
    const p = aprovar()
    await transporte.approve('ap-1', 'approve' as never)
    await expect(p).resolves.toBe('approve')
  })

  it('a NEW send() sweeps the previous turn', async () => {
    const { transporte, aprovar } = build()
    const p = aprovar()
    expect(transporte.pendentes).toBe(1)
    void transporte.sendMessages({
      messages: [{ id: 'u2', role: 'user', parts: [{ type: 'text', text: 'again' }] }],
    } as never)
    await expect(p).rejects.toBeInstanceOf(ApprovalAbortedError)
    expect(transporte.pendentes).toBe(0)
  })
})

/**
 * M92 — the three holes the adversarial review measured, each with the scenario that exposes it.
 *
 * None is hypothetical: the reviewer ran all three and reported the observed state.
 */
describe('M92 — holes in the first version of the eviction', () => {
  const buildWith = (opts: { jaAbortado?: boolean } = {}) => {
    let park: ((id?: string) => Promise<unknown>) | undefined
    const controller = new AbortController()
    if (opts.jaAbortado === true) controller.abort()
    const transporte = new InProcessTransport({
      run: (o: { awaitApproval: (r: { approvalId: string }) => Promise<unknown> }) => {
        park = (id = 'ap-1') => o.awaitApproval({ approvalId: id })
        return (async function* () {
          await new Promise(() => undefined)
          yield undefined as never
        })()
      },
    } as never)
    void transporte.sendMessages({
      messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'oi' }] }],
      abortSignal: controller.signal,
    } as never)
    return {
      transporte,
      park: (id?: string) => park!(id),
      abortar: () => {
        controller.abort()
      },
    }
  }

  it('AN ALREADY ABORTED SIGNAL — the approval is not left hanging', async () => {
    // `addEventListener('abort')` does NOT fire on a signal that has already aborted. Without the
    // check, the promise stayed pending forever — the hang the milestone exists to close, still
    // reachable.
    const { transporte, park } = buildWith({ jaAbortado: true })
    const p = park()
    await expect(p).rejects.toBeInstanceOf(ApprovalAbortedError)
    expect(transporte.pendentes).toBe(0)
  })

  it('the turn is captured at SEND — an OLD runner parking after a new send', async () => {
    // The distinguishing scenario, which this test's first version did NOT exercise: keep turn 1's
    // runner `awaitApproval` and use it **after** turn 2's `send`.
    //
    // Reading `#turn` at approval time, that entry was labelled turn 2 — and turn 1's abort did not
    // sweep it. M92's review measured `pending=1` in that state. Captured at `send`, it is born
    // labelled turn 1 and the corresponding abort reaches it.
    const runners: ((id: string) => Promise<unknown>)[] = []
    const c1 = new AbortController()
    const transporte = new InProcessTransport({
      run: (o: { awaitApproval: (r: { approvalId: string }) => Promise<unknown> }) => {
        runners.push((id) => o.awaitApproval({ approvalId: id }))
        return (async function* () {
          await new Promise(() => undefined)
          yield undefined as never
        })()
      },
    } as never)
    void transporte.sendMessages({
      messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'um' }] }],
      abortSignal: c1.signal,
    } as never)
    // Turn 2 starts BEFORE turn 1's runner parks.
    void transporte.sendMessages({
      messages: [{ id: 'u2', role: 'user', parts: [{ type: 'text', text: 'two' }] }],
    } as never)
    const ofTurn1 = runners[0]!('ap-of-turn-1')
    expect(transporte.pendentes).toBe(1)
    // Turn 1's abort has to reach it. If the label were turn 2's, this would hang.
    c1.abort()
    await expect(ofTurn1).rejects.toBeInstanceOf(ApprovalAbortedError)
  })

  it('the rejection does NOT take down the process when nobody handles it — a handler exists', async () => {
    // Node ≥ 15 exits on `unhandledRejection`. Before M92 the promise hung; afterwards, if nobody
    // awaited it, it could KILL the process — trading a hang for a crash is not a fix.
    const { transporte, park, abortar } = buildWith()
    const abandoned = park('ap-abandoned')
    abandoned.catch(() => undefined) // what a runner that gives up would do
    abortar()
    await new Promise((r) => setTimeout(r, 10))
    expect(transporte.pendentes).toBe(0)
  })
})
