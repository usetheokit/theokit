/**
 * M17 (theokit-ai-first) — ACP client: JSON-RPC request/response correlation over the stdio framing.
 *
 * `AcpClient` drives a coding agent over an INJECTED transport (the subprocess spawn is a Node API
 * and lives in the adapter layer per G8 — here the transport is abstract + testable). It correlates
 * responses to requests by `id`, and dispatches server→client requests (e.g. permission requests) to
 * a registered handler, replying with the handler's decision.
 *
 * TDD RED-first.
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

describe('AcpClient', () => {
  it('correlates a response to its request by id', async () => {
    const { transport, sent, push } = fakeTransport()
    const client = new AcpClient(transport)

    const promise = client.request('session/prompt', { message: 'hi' })
    // The client sent a JSON-RPC request with an id.
    const req = JSON.parse(sent[0]) as { id: number; method: string }
    expect(req.method).toBe('session/prompt')

    push({ jsonrpc: '2.0', id: req.id, result: { text: 'done' } })
    await expect(promise).resolves.toEqual({ text: 'done' })
  })

  it('rejects when the response carries a JSON-RPC error', async () => {
    const { transport, sent, push } = fakeTransport()
    const client = new AcpClient(transport)
    const promise = client.request('x', {})
    const req = JSON.parse(sent[0]) as { id: number }
    push({ jsonrpc: '2.0', id: req.id, error: { code: -32000, message: 'boom' } })
    await expect(promise).rejects.toThrow(/boom/)
  })

  it('dispatches a server→client request to the registered handler and replies', async () => {
    const { transport, sent, push } = fakeTransport()
    const client = new AcpClient(transport)
    const onPermission = vi.fn(() => ({ granted: true }))
    client.onRequest('session/request_permission', onPermission)

    push({ jsonrpc: '2.0', id: 99, method: 'session/request_permission', params: { tool: 'write_file' } })

    // Give the microtask queue a tick for the async dispatch to flush.
    await Promise.resolve()
    await Promise.resolve()

    expect(onPermission).toHaveBeenCalledWith({ tool: 'write_file' })
    const reply = JSON.parse(sent[sent.length - 1]) as { id: number; result: unknown }
    expect(reply.id).toBe(99)
    expect(reply.result).toEqual({ granted: true })
  })
})
