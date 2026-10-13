/**
 * B-408, review finding F-arch-2: the theo ACP tool closes its transport at the end of every call,
 * and the transport reports that close through `onClose`. `AcpClient` routed the close through the
 * same path as a bad stdout line, which warns when no request is in flight, so every successful
 * call ended with a `console.warn` that read like a fault. A close is the normal end of a channel:
 * with nothing in flight there is nobody to tell, and nothing to warn about.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AcpClient, type AcpTransport } from '../../src/acp/client.js'
import { encodeAcpMessage } from '../../src/acp/protocol.js'

/** A fake transport that captures sent lines, lets the test answer them and close the channel. */
function closableTransport() {
  const sent: string[] = []
  const listeners: ((cause: Error) => void)[] = []
  let sink: ((chunk: string) => void) | undefined
  const transport: AcpTransport = {
    send: (line) => sent.push(line),
    subscribe: (onData) => (sink = onData),
    onClose: (listener) => listeners.push(listener),
  }
  return {
    transport,
    sent,
    raw: (chunk: string) => sink?.(chunk),
    close: (cause: Error) => {
      for (const listener of listeners) listener(cause)
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AcpClient closing with nothing in flight', () => {
  it('test_a_close_after_the_last_answer_logs_no_warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { transport, sent, raw, close } = closableTransport()
    const client = new AcpClient(transport)
    const answered = client.request('session/prompt', {})
    const req = JSON.parse(sent[0]) as { id: number }
    raw(encodeAcpMessage({ jsonrpc: '2.0', id: req.id, result: { stopReason: 'end_turn' } }))
    await expect(answered).resolves.toEqual({ stopReason: 'end_turn' })

    close(new Error('was closed by the caller'))

    expect(warn).not.toHaveBeenCalled()
  })

  it('test_a_request_after_a_quiet_close_still_rejects_with_the_closed_error', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { transport, close } = closableTransport()
    const client = new AcpClient(transport)

    close(new Error('was closed by the caller'))

    await expect(client.request('initialize', {})).rejects.toMatchObject({
      name: 'AcpConnectionClosedError',
      message: expect.stringContaining('was closed by the caller') as unknown,
    })
  })
})
