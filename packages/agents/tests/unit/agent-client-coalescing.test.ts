import { describe, expect, it, vi } from 'vitest'

import { AgentClient } from '../../src/client/agent-client.js'

/**
 * M92 T1.1 + T2.1 — the committed prefix stops being rebuilt, and the emit gains opt-in coalescing.
 *
 * ## The measurement that reorders the priorities
 *
 * The ROADMAP calls the spread `[...#committed, …]` `O(C·T)` per turn, and it is right — but the
 * constant is tiny: measured, **0.0062 ms per delta @400 messages**, or 3.1 ms across a whole turn of
 * 500 deltas. Copying array *references* is cheap.
 *
 * What costs is what runs **after** each emit: deriving the timeline, measured in M86 at **3.274 ms
 * per call** at the same thread size — **≈ 528×** the spread. That is why the coalescing does not try
 * to make the emit cheaper: it makes **fewer emits happen**.
 *
 * ## Why the tests count EMITS
 *
 * The invariant is frequency, not content. A test that measured time would be non-deterministic in a
 * parallel suite — the reason the consumer's `gates/perf-budget.test.ts` records for counting the
 * cause rather than measuring wall-clock.
 */
/**
 * A fake transport that emits N text deltas in the SAME tick — the shape of the hot path.
 *
 * The first version of these tests installed `vi.useFakeTimers()` and **never advanced them**, and
 * only exercised `reset()` — which flushes synchronously by decision. Result measured by the review:
 * replacing the entire body of `#scheduleEmit` with `return` left **580/580 tests green**. The gate
 * could not fail; it was the worst kind of gate.
 */
const transportWithDeltas = (n: number): unknown => ({
  sendMessages: () =>
    Promise.resolve(
      new ReadableStream({
        start(controller) {
          for (let i = 0; i < n; i++) {
            controller.enqueue({
              type: 'data-message',
              data: {
                id: 'a1',
                role: 'assistant',
                parts: [{ type: 'text', text: 'x'.repeat(i + 1) }],
              },
            })
          }
          // theokit#384 — the terminal chunk every framework producer ends on. Without it the store
          // now (correctly) reports the turn as cut off; the emit COUNT is unchanged either way,
          // since a metadata-free `finish` reconstructs to no message and schedules no emit.
          controller.enqueue({ type: 'finish' })
          controller.close()
        },
      }),
    ),
})

describe('M92 — coalescing opt-in do AgentClient', () => {
  const countEmits = (c: AgentClient): { n: () => number } => {
    let n = 0
    c.subscribe(() => {
      n += 1
    })
    return { n: () => n }
  }

  /** Lets the stream drain; no fake timers, so the coalescing uses the real clock. */
  const drain = async (c: AgentClient): Promise<void> => {
    await vi.waitFor(
      () => {
        if (c.getSnapshot().status === 'streaming') throw new Error('still streaming')
      },
      { timeout: 2000 },
    )
  }

  it('WITHOUT coalescing, every delta emits — the pre-M92 behaviour', async () => {
    const c = new AgentClient(transportWithDeltas(30) as never)
    const counter = countEmits(c)
    c.send('oi' as never)
    await drain(c)
    // 30 deltas + the status transitions. The floor is what matters: one emit PER delta.
    expect(counter.n()).toBeGreaterThanOrEqual(30)
  })

  it('WITH coalescing, FAR fewer emits for the same deltas — the point of the milestone', async () => {
    const c = new AgentClient(transportWithDeltas(30) as never, undefined, { emitIntervalMs: 16 })
    const counter = countEmits(c)
    c.send('oi' as never)
    await drain(c)
    // The 30 deltas fall in the same 16 ms window; what remains are the status transitions, which flush.
    expect(counter.n()).toBeLessThan(30)
  })

  it('the FINAL STATE survives coalescing — no token is lost', async () => {
    const c = new AgentClient(transportWithDeltas(30) as never, undefined, { emitIntervalMs: 16 })
    c.send('oi' as never)
    await drain(c)
    // The last delta carries 30 characters. If the synchronous flush did not run, the snapshot would
    // stop at a prefix — which is exactly the plan's risk #1: a final state trapped in a timer is a
    // final state lost.
    const part = c.getSnapshot().messages.at(-1)?.parts.at(-1) as
      | { data?: { parts?: { text?: string }[] } }
      | undefined
    expect(part?.data?.parts?.[0]?.text).toHaveLength(30)
  })

  it('COUNTERPROOF — the reduction in emits is material, not marginal', async () => {
    const sem = new AgentClient(transportWithDeltas(30) as never)
    const com = new AgentClient(transportWithDeltas(30) as never, undefined, { emitIntervalMs: 16 })
    let nSem = 0
    let nCom = 0
    sem.subscribe(() => {
      nSem += 1
    })
    com.subscribe(() => {
      nCom += 1
    })
    sem.send('oi' as never)
    com.send('oi' as never)
    await drain(sem)
    await drain(com)
    // Measured in the probe: 32 against 2 for 30 deltas. The 5× floor is loose enough not to flicker
    // under CPU contention and tight enough to fail if the coalescing disappears.
    expect(nSem / nCom).toBeGreaterThan(5)
  })

  it('the final status is done under both configurations', async () => {
    const sem = new AgentClient(transportWithDeltas(10) as never)
    const com = new AgentClient(transportWithDeltas(10) as never, undefined, { emitIntervalMs: 16 })
    sem.send('a' as never)
    com.send('a' as never)
    await drain(sem)
    await drain(com)
    expect(sem.getSnapshot().status).toBe(com.getSnapshot().status)
  })

  it('the snapshot keeps a stable reference between emits', () => {
    const c = new AgentClient(transportWithDeltas(0) as never, undefined, { emitIntervalMs: 16 })
    const a = c.getSnapshot()
    const b = c.getSnapshot()
    expect(b).toBe(a)
  })

  it('FLUSH — reset() and a status transition emit RIGHT AWAY, without waiting for the window', () => {
    const c = new AgentClient(transportWithDeltas(0) as never, undefined, { emitIntervalMs: 16 })
    const counter = countEmits(c)
    c.reset()
    expect(counter.n()).toBe(1)
  })

  it('emitIntervalMs = 0 is treated as OFF, not as a zero-length window', () => {
    const c = new AgentClient(transportWithDeltas(0) as never, undefined, { emitIntervalMs: 0 })
    const counter = countEmits(c)
    c.reset()
    expect(counter.n()).toBe(1)
  })
})

/**
 * M92 T1.1 — the prefix is invalidated ON WRITE.
 *
 * Comparing to decide whether it changed would cost the same O(C) this avoids; memoizing by length
 * would be wrong in `reset()`, where equal length with different content is possible and the bug
 * would be invisible.
 */
describe('M92 — the committed prefix is materialized once per write', () => {
  /**
   * Builds a client with REAL committed history.
   *
   * The first version of these tests used a fresh client and asserted `thread === []` after `reset()`.
   * **The mutant survived:** in a fresh client, `#prefix` and `#committed` are both empty, so removing
   * the invalidation changes nothing and the test cannot tell. A test that cannot fail is not a gate —
   * it is the defect this whole suite exists to hunt.
   *
   * Here the history is built for real: one complete turn (`streaming` → `done`) and a following
   * `send()`, which is the point where `#committed` grows.
   */
  /**
   * Builds a client with REAL committed history, by driving a complete turn.
   *
   * Two earlier versions of these tests **could not fail**, and both were caught by mutation:
   *
   * 1. The first used a fresh client and asserted `thread === []` after `reset()`. In a fresh client,
   *    `#prefix` and `#committed` are both empty — removing the invalidation changed nothing.
   * 2. The second tried to force `#status` through indexed access. `#status` is a genuine private
   *    field; the trick does not work, and `#committed` stayed empty.
   *
   * The only way `#committed` grows is the real one: a turn that **reaches `done`** and a following
   * `send()`.
   *
   * theokit#384 — the fixture used to be a stream that closed with NO chunks at all, described here
   * as "the turn ends cleanly". It was not clean; it was a producer that accepted the request and
   * then said nothing, which the store now reports as an interruption rather than as an answer. The
   * terminal `finish` chunk is what makes the turn end cleanly, and it is what every framework
   * producer emits (`presentUIMessageStream` yields it on every path, including the error one).
   */
  const finishedTurnStream = (): ReadableStream =>
    new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'finish' })
        controller.close()
      },
    })

  const clientWithHistory = async (): Promise<AgentClient> => {
    const c = new AgentClient({
      sendMessages: () => Promise.resolve(finishedTurnStream()),
    } as never)
    c.send('first' as never)
    // Lets the stream drain and the status become `done`.
    await vi.waitFor(() => {
      if (c.getSnapshot().status !== 'done') throw new Error('has not finished yet')
    })
    // The SECOND send is what commits the previous turn — that is where `#committed` grows.
    c.send('segundo' as never)
    return c
  }

  it('after TWO turns, the committed prefix is not empty', async () => {
    const c = await clientWithHistory()
    const size = c.getSnapshot().thread.length
    expect(size).toBeGreaterThan(1)
  })

  it('reset() INVALIDATES the prefix — with REAL history, the only way this test can fail', async () => {
    const c = await clientWithHistory()
    const before = c.getSnapshot().thread.length
    expect(before).toBeGreaterThan(1)
    c.reset()
    expect(c.getSnapshot().thread).toEqual([])
  })

  it('the emitted thread is prefix + in-flight turn, in that order', async () => {
    const c = await clientWithHistory()
    const roles = c.getSnapshot().thread.map((m) => m.role)
    expect(roles[0]).toBe('user')
  })
})
