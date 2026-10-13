/**
 * An ACP agent streams its reply as `session/update` notifications: JSON-RPC messages with a
 * `method` and no `id`. `AcpClient` dispatched only responses and server requests, so an id-less
 * message fell through `dispatch` and the reply text was lost. These tests pin the hook that
 * delivers notifications, and that delivering one never touches a pending request.
 */
import { describe, expect, it, vi } from 'vitest'

import { AcpClient, type AcpTransport } from '../../src/acp/client.js'
import { encodeAcpMessage } from '../../src/acp/protocol.js'

/** A fake transport that captures sent lines and lets the test push incoming lines. */
function fakeTransport() {
  const sent: string[] = []
  let sink: ((line: string) => void) | undefined
  const transport: AcpTransport = {
    send: (line) => sent.push(line),
    subscribe: (cb) => (sink = cb),
  }
  return { transport, sent, push: (msg: unknown) => sink?.(encodeAcpMessage(msg)) }
}

describe('AcpClient notifications', () => {
  it('test_an_id_less_notification_reaches_its_registered_handler', () => {
    const { transport, push } = fakeTransport()
    const client = new AcpClient(transport)
    const handler = vi.fn()
    client.onNotification('session/update', handler)

    push({ jsonrpc: '2.0', method: 'session/update', params: { n: 1 } })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith({ n: 1 })
  })

  it('test_a_notification_with_no_handler_is_ignored', () => {
    const { transport, sent, push } = fakeTransport()
    const client = new AcpClient(transport)
    const handler = vi.fn()
    client.onNotification('session/update', handler)

    expect(() => push({ jsonrpc: '2.0', method: 'nobody/listens', params: { n: 1 } })).not.toThrow()

    expect(handler).not.toHaveBeenCalled()
    expect(sent).toEqual([])
  })

  it('test_a_notification_does_not_settle_a_pending_request', async () => {
    const { transport, sent, push } = fakeTransport()
    const client = new AcpClient(transport)
    const handler = vi.fn()
    client.onNotification('x', handler)
    const pending = client.request('x', {})
    let settled = false
    void pending.then(
      () => (settled = true),
      () => (settled = true),
    )
    const req = JSON.parse(sent[0]) as { id: number }

    push({ jsonrpc: '2.0', method: 'x', params: { n: 2 } })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(handler).toHaveBeenCalledWith({ n: 2 })
    expect(settled).toBe(false)

    push({ jsonrpc: '2.0', id: req.id, result: 'done' })
    await expect(pending).resolves.toBe('done')
  })
})
