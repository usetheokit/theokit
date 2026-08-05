import { describe, expect, it } from 'vitest'

import { AgentClient } from '../../src/client/agent-client.js'

/**
 * theokit-sdk#145 — `abort()` must finalize the status, and nothing protected that until now.
 *
 * `#drive` early-returns on `aborted()` WITHOUT touching `#status`, deliberately: a stale drive must
 * not clobber a newer turn's state. The consequence is that somebody else has to own the
 * `streaming -> done|idle` transition on a user abort, and that somebody is the aborter. When it did
 * not, a first-turn Esc/Ctrl-C left `status` on `'streaming'` forever — a spinner that never stops
 * and a surface the user cannot type into. Mandatory Codex-parity control, so it is not a corner.
 *
 * The fix shipped in db67da7b (2026-07-18, first released in `@theokit/agents@0.44.5`) with no test.
 * These are the regression tests it should have had: a fix nothing pins is a fix waiting to be
 * refactored away.
 */

/** A transport whose stream never closes — the in-flight turn state an abort has to interrupt. */
const neverEndingTransport = (): unknown => ({
  sendMessages: () =>
    Promise.resolve(
      new ReadableStream({
        start() {
          // Deliberately no enqueue and no close: the turn stays in flight until aborted.
        },
      }),
    ),
})

/** A transport that emits one assistant delta and closes — a turn with content to keep. */
const oneDeltaTransport = (): unknown => ({
  sendMessages: () =>
    Promise.resolve(
      new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: 'data-message',
            data: { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'partial' }] },
          })
          // No close: the turn is still streaming when the user aborts it.
        },
      }),
    ),
})

/** Let the stream reader loop run: `#drive` awaits the transport, then each chunk. */
const tick = async (times = 1): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('theokit-sdk#145 — abort() finalizes the turn status', () => {
  it('test_first_turn_abort_leaves_idle_not_streaming', async () => {
    const client = new AgentClient(neverEndingTransport() as never)
    client.send('hello' as never)
    await tick()
    expect(client.getSnapshot().status, 'precondition: the turn is in flight').toBe('streaming')

    client.abort()

    // The exact hang: a spinner with no turn behind it. Nothing had produced content, so there is
    // no transcript to show — `idle`, not `done`.
    expect(client.getSnapshot().status).toBe('idle')
  })

  it('test_abort_after_partial_output_leaves_done_so_the_text_stays_readable', async () => {
    const client = new AgentClient(oneDeltaTransport() as never)
    client.send('hello' as never)
    await tick(5)
    expect(
      client.getSnapshot().messages.length,
      'precondition: the delta reached the store before the abort',
    ).toBeGreaterThan(0)

    client.abort()

    // `done` rather than `idle`: the user interrupted a turn that had already said something, and
    // the surface must keep showing it.
    expect(client.getSnapshot().status).toBe('done')
    expect(client.getSnapshot().messages.length).toBeGreaterThan(0)
  })

  it('test_abort_notifies_subscribers_so_the_spinner_actually_stops', async () => {
    // Finalizing `#status` without emitting would fix the value and not the symptom: a
    // `useSyncExternalStore` surface only re-renders on notification.
    const client = new AgentClient(neverEndingTransport() as never)
    client.send('hello' as never)
    await tick()

    let notifications = 0
    client.subscribe(() => {
      notifications += 1
    })
    client.abort()

    expect(notifications).toBeGreaterThan(0)
  })

  it('test_COUNTERPROOF_abort_on_an_idle_client_does_not_fabricate_a_transition', async () => {
    // The finalization is guarded on `streaming` on purpose. Without the guard, `send`'s internal
    // `abort()` (and `reset`'s) would emit spurious transitions on every turn.
    const client = new AgentClient(neverEndingTransport() as never)
    let notifications = 0
    client.subscribe(() => {
      notifications += 1
    })

    client.abort()

    expect(client.getSnapshot().status).toBe('idle')
    expect(notifications, 'nothing was in flight — there is nothing to announce').toBe(0)
  })
})
