/**
 * B-434: when the agent process dies, its transport closes and no reply will ever come. `AcpClient`
 * used to leave every request in flight pending forever, so a consumer other than the theo ACP tool
 * waited on `initialize`, `session/new` or `session/prompt` with nothing to end the wait. A
 * transport that reports its own close through `onClose` now fails every pending request, and every
 * later one, with a typed error naming the cause.
 */
import { describe, expect, it } from 'vitest'

import { AcpClient, type AcpTransport } from '../../src/acp/client.js'

/** A fake transport that captures sent lines and lets the test close the channel. */
function closableTransport() {
  const sent: string[] = []
  const listeners: ((cause: Error) => void)[] = []
  const transport: AcpTransport = {
    send: (line) => sent.push(line),
    subscribe: () => undefined,
    onClose: (listener) => listeners.push(listener),
  }
  return {
    transport,
    sent,
    close: (cause: Error) => {
      for (const listener of listeners) listener(cause)
    },
  }
}

/** Settles with the rejection, or with `'pending'` when the promise is still open after one tick. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  const tick = new Promise((resolve) => setTimeout(() => resolve('pending'), 0))
  return Promise.race([
    promise.then(
      () => 'resolved',
      (err: unknown) => err,
    ),
    tick,
  ])
}

describe('AcpClient when its transport closes', () => {
  it('test_every_pending_request_rejects_with_a_typed_error_naming_the_cause', async () => {
    const { transport, close } = closableTransport()
    const client = new AcpClient(transport)
    const initialize = client.request('initialize', {})
    const prompt = client.request('session/prompt', {})
    const cause = new Error('the agent process exited with code 3')

    close(cause)

    for (const pending of [initialize, prompt]) {
      const err = await rejection(pending)
      expect(err).toMatchObject({
        name: 'AcpConnectionClosedError',
        message: expect.stringContaining('the agent process exited with code 3') as unknown,
        cause,
      })
    }
  })

  it('test_a_request_after_the_close_rejects_with_the_same_error_and_sends_nothing', async () => {
    const { transport, sent, close } = closableTransport()
    const client = new AcpClient(transport)
    const cause = new Error('stdin closed')
    close(cause)

    const err = await rejection(client.request('session/new', {}))

    expect(err).toMatchObject({ name: 'AcpConnectionClosedError', cause })
    expect(sent).toEqual([])
  })
})
