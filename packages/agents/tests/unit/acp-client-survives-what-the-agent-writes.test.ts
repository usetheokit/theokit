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

/** Settles with the promise's outcome, or with `'pending'` when it is still open after one tick. */
async function outcome(promise: Promise<unknown>): Promise<unknown> {
  const tick = new Promise((resolve) => setTimeout(() => resolve('pending'), 0))
  return Promise.race([
    promise.then(
      (value) => ({ resolved: value }),
      (err: unknown) => err,
    ),
    tick,
  ])
}

describe('AcpClient against lines that are JSON but not a JSON-RPC message', () => {
  it.each(['null', '42', '"text"', '[1]'])(
    'test_a_%s_line_fails_the_request_in_flight_with_a_protocol_error_naming_it',
    async (line) => {
      const { transport, raw } = fakeTransport()
      const client = new AcpClient(transport)
      const pending = client.request('session/prompt', {})

      expect(() => raw(`${line}\n`)).not.toThrow()

      expect(await outcome(pending)).toMatchObject({
        name: 'AcpProtocolError',
        line,
        message: expect.stringContaining(`line: ${line}`) as unknown,
      })
    },
  )
})

describe('AcpClient with one bad line among good ones in a chunk', () => {
  it('test_every_well_formed_message_of_the_chunk_is_dispatched_around_the_bad_line', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { transport, sent, raw } = fakeTransport()
    const client = new AcpClient(transport)
    const updates: unknown[] = []
    client.onNotification('session/update', (params) => {
      updates.push(params)
    })
    client.onRequest('session/request_permission', () => ({ outcome: 'allowed' }))
    const pending = client.request('initialize', {})
    const req = JSON.parse(sent[0]) as { id: number }

    raw(
      encodeAcpMessage({ jsonrpc: '2.0', id: req.id, result: 'ok' }) +
        encodeAcpMessage({
          jsonrpc: '2.0',
          id: 7,
          method: 'session/request_permission',
          params: {},
        }) +
        encodeAcpMessage({ jsonrpc: '2.0', method: 'session/update', params: { n: 1 } }) +
        'banner\n' +
        encodeAcpMessage({ jsonrpc: '2.0', method: 'session/update', params: { n: 2 } }),
    )

    expect(await outcome(pending)).toEqual({ resolved: 'ok' })
    expect(updates).toEqual([{ n: 1 }, { n: 2 }])
    expect(sent.slice(1).map((line) => JSON.parse(line) as unknown)).toEqual([
      { jsonrpc: '2.0', id: 7, result: { outcome: 'allowed' } },
    ])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/ACP decode failed on line: banner/)
  })

  it('test_the_bad_line_fails_only_the_requests_in_flight_when_it_arrives', async () => {
    const { transport, sent, raw } = fakeTransport()
    const client = new AcpClient(transport)
    const first = client.request('initialize', {})
    const second = client.request('session/new', {})
    const [a, b] = sent.map((line) => JSON.parse(line) as { id: number })

    raw(encodeAcpMessage({ jsonrpc: '2.0', id: a.id, result: 'first' }) + 'banner\n')

    expect(await outcome(first)).toEqual({ resolved: 'first' })
    expect(await outcome(second)).toMatchObject({ name: 'AcpProtocolError', line: 'banner' })
    expect(b.id).not.toBe(a.id)
  })
})

describe('AcpClient with an async notification handler', () => {
  it('test_an_async_handler_that_rejects_is_reported_not_left_unhandled', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { transport, raw } = fakeTransport()
    const client = new AcpClient(transport)
    client.onNotification('session/update', async () => {
      await Promise.resolve()
      throw new Error('async handler bug')
    })

    raw(encodeAcpMessage({ jsonrpc: '2.0', method: 'session/update', params: {} }))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]).toContainEqual(
      expect.objectContaining({ message: 'async handler bug' }),
    )
  })
})
