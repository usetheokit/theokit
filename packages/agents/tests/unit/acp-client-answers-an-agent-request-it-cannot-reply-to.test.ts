/**
 * B-408, loop-code-review findings #91 and #105: AcpClient answers a server request (for example
 * `session/request_permission`) from a promise nobody awaits. The reply was encoded and sent after
 * the handler's try block, so a result that cannot be serialized, or a transport whose `send`
 * throws, rejected that promise unhandled and the agent never got an answer. A reply that cannot be
 * encoded is answered with a JSON-RPC error instead, and a reply that cannot be sent at all is
 * reported, never left as an unhandled rejection.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AcpClient, type AcpTransport } from '../../src/acp/client.js'
import { encodeAcpMessage } from '../../src/acp/protocol.js'

/** A fake transport that captures sent lines, lets the test push stdout, and can fail its sends. */
function fakeTransport(options: { failSends?: boolean } = {}) {
  const sent: string[] = []
  let sink: ((chunk: string) => void) | undefined
  const transport: AcpTransport = {
    send: (line) => {
      if (options.failSends) throw new Error('stdin is closed')
      sent.push(line)
    },
    subscribe: (onData) => (sink = onData),
  }
  return { transport, sent, raw: (chunk: string) => sink?.(chunk) }
}

/** Run `work`, then give the event loop time to surface any unhandled rejection it caused. */
async function recordingUnhandled(work: () => void): Promise<unknown[]> {
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason)
  }
  process.on('unhandledRejection', onUnhandled)
  try {
    work()
    await new Promise((resolve) => setTimeout(resolve, 20))
    return unhandled
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
}

const PERMISSION_REQUEST = encodeAcpMessage({
  jsonrpc: '2.0',
  id: 7,
  method: 'session/request_permission',
  params: {},
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AcpClient answering a request from the agent', () => {
  it('test_a_result_that_cannot_be_encoded_is_answered_with_an_internal_error', async () => {
    const { transport, sent, raw } = fakeTransport()
    const client = new AcpClient(transport)
    client.onRequest('session/request_permission', () => ({ size: 10n }))

    const unhandled = await recordingUnhandled(() => raw(PERMISSION_REQUEST))

    expect(unhandled).toEqual([])
    expect(sent.map((line) => JSON.parse(line) as unknown)).toEqual([
      {
        jsonrpc: '2.0',
        id: 7,
        error: { code: -32603, message: expect.stringMatching(/BigInt/) as unknown },
      },
    ])
  })

  it('test_a_reply_the_transport_cannot_send_is_reported_not_left_unhandled', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { transport, raw } = fakeTransport({ failSends: true })
    const client = new AcpClient(transport)
    client.onRequest('session/request_permission', () => ({ outcome: 'cancelled' }))

    const unhandled = await recordingUnhandled(() => raw(PERMISSION_REQUEST))

    expect(unhandled).toEqual([])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]).toContainEqual(
      expect.objectContaining({ message: 'stdin is closed' }),
    )
  })
})
