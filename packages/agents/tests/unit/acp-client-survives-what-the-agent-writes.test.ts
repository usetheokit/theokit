/**
 * The ACP client reads the stdout of a process it does not control, and with the Node transport its
 * stdout callback runs inside a `data` listener: anything thrown there is an uncaught exception that
 * ends the host process. A coding agent that prints one log line that is not JSON, or a host
 * notification handler that throws, must fail the requests in flight or be reported, never take the
 * host down.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AcpClient, type AcpTransport } from '../../src/acp/client.js'
import { encodeAcpMessage } from '../../src/acp/protocol.js'

/** A fake transport that captures sent lines and lets the test push raw stdout chunks. */
function fakeTransport() {
  const sent: string[] = []
  let sink: ((chunk: string) => void) | undefined
  const transport: AcpTransport = {
    send: (line) => sent.push(line),
    subscribe: (cb) => (sink = cb),
  }
  return { transport, sent, raw: (chunk: string) => sink?.(chunk) }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AcpClient against what the agent writes', () => {
  it('test_a_line_that_is_not_json_fails_the_request_in_flight_instead_of_throwing', async () => {
    const { transport, raw } = fakeTransport()
    const client = new AcpClient(transport)
    const pending = client.request('session/prompt', {})

    expect(() => raw('Starting agent v1.2\n')).not.toThrow()

    await expect(pending).rejects.toThrow(/ACP decode failed on line: Starting agent v1\.2/)
  })

  it('test_a_line_that_is_not_json_with_nothing_in_flight_is_reported', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { transport, raw } = fakeTransport()
    const client = new AcpClient(transport)

    expect(() => raw('banner\n')).not.toThrow()
    expect(client).toBeInstanceOf(AcpClient)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/ACP decode failed on line: banner/)
  })

  it('test_a_request_sent_after_a_bad_line_still_gets_its_answer', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { transport, sent, raw } = fakeTransport()
    const client = new AcpClient(transport)
    raw('banner\n')

    const pending = client.request('initialize', {})
    const req = JSON.parse(sent[0]) as { id: number }
    raw(encodeAcpMessage({ jsonrpc: '2.0', id: req.id, result: 'ok' }))

    await expect(pending).resolves.toBe('ok')
  })

  it('test_a_throwing_notification_handler_is_reported_and_the_rest_of_the_chunk_dispatches', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { transport, sent, raw } = fakeTransport()
    const client = new AcpClient(transport)
    client.onNotification('session/update', () => {
      throw new Error('handler bug')
    })
    const pending = client.request('session/prompt', {})
    const req = JSON.parse(sent[0]) as { id: number }

    const chunk =
      encodeAcpMessage({ jsonrpc: '2.0', method: 'session/update', params: {} }) +
      encodeAcpMessage({ jsonrpc: '2.0', id: req.id, result: 'done' })
    expect(() => raw(chunk)).not.toThrow()

    await expect(pending).resolves.toBe('done')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]).toContainEqual(expect.objectContaining({ message: 'handler bug' }))
  })
})
