/**
 * B-394 (OC-13) — `createA2ATool({ protocol: 'jsonrpc' })` speaks A2A's JSON-RPC `message/send`.
 *
 * The request is a JSON-RPC 2.0 body with one text part; the answer is a `Message` or a `Task`
 * whose text parts the tool returns, or a JSON-RPC error that rejects naming the tool and the code.
 * Without `protocol` the tool sends today's `{ message }` stream request (its own tests). TDD RED-first.
 */
import { describe, expect, it, vi } from 'vitest'

import { createA2ATool } from '../../src/a2a/a2a-client.js'

function jsonFetch(body: unknown, init: ResponseInit = {}, capture?: (init: RequestInit) => void) {
  return vi.fn(async (_url: string, requestInit: RequestInit) => {
    capture?.(requestInit)
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
      ...init,
    })
  })
}

function peer(fetchImpl: (url: string, init: RequestInit) => Promise<Response>) {
  return createA2ATool({
    url: 'http://127.0.0.1:7300/a2a',
    name: 'peer_b',
    description: 'Peer b',
    auth: { bearer: 'tok' },
    protocol: 'jsonrpc',
    fetchImpl,
  })
}

const message = (texts: string[]) => ({
  jsonrpc: '2.0',
  id: 'x',
  result: {
    kind: 'message',
    role: 'agent',
    messageId: 'r',
    parts: texts.map((text) => ({ kind: 'text', text })),
  },
})

describe('createA2ATool with protocol jsonrpc', () => {
  it('posts message/send and returns the result text, and rejects naming a JSON-RPC error code', async () => {
    let sent: RequestInit | undefined
    const ok = peer(jsonFetch(message(['one', 'two']), {}, (init) => (sent = init)))
    await expect(ok.handler({ message: 'hi there' })).resolves.toBe('one\ntwo')

    const body = JSON.parse(String(sent?.body)) as {
      jsonrpc: string
      id: unknown
      method: string
      params: { message: { role: string; messageId: unknown; parts: unknown[] } }
    }
    expect(body.jsonrpc).toBe('2.0')
    expect(typeof body.id).toBe('string')
    expect(body.method).toBe('message/send')
    expect(body.params.message.role).toBe('user')
    expect(typeof body.params.message.messageId).toBe('string')
    expect(body.params.message.parts).toEqual([{ kind: 'text', text: 'hi there' }])
    const headers = sent?.headers as Record<string, string>
    expect(headers.accept).toBe('application/json')
    expect(headers['content-type']).toBe('application/json')
    expect(headers.authorization).toBe('Bearer tok')
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain('x-theo-action')

    const task = peer(
      jsonFetch({
        jsonrpc: '2.0',
        id: 'x',
        result: {
          kind: 'task',
          id: 't1',
          status: {
            state: 'completed',
            message: { kind: 'message', role: 'agent', parts: [{ kind: 'text', text: 'done' }] },
          },
        },
      }),
    )
    await expect(task.handler({ message: 'hi' })).resolves.toBe('done')

    const artifacts = peer(
      jsonFetch({
        jsonrpc: '2.0',
        id: 'x',
        result: {
          kind: 'task',
          id: 't2',
          status: { state: 'completed' },
          artifacts: [{ artifactId: 'a', parts: [{ kind: 'text', text: 'from artifact' }] }],
        },
      }),
    )
    await expect(artifacts.handler({ message: 'hi' })).resolves.toBe('from artifact')

    const silentTask = peer(
      jsonFetch({ jsonrpc: '2.0', id: 'x', result: { kind: 'task', id: 't3', status: {} } }),
    )
    await expect(silentTask.handler({ message: 'hi' })).rejects.toThrow(
      'A2A call to "peer_b" failed: the task answered no text',
    )

    const rpcError = peer(
      jsonFetch({ jsonrpc: '2.0', id: 'x', error: { code: -32601, message: 'method not found' } }),
    )
    await expect(rpcError.handler({ message: 'hi' })).rejects.toThrow(
      'A2A call to "peer_b" failed: -32601 method not found',
    )

    const bareError = peer(jsonFetch({ jsonrpc: '2.0', id: 'x', error: {} }))
    await expect(bareError.handler({ message: 'hi' })).rejects.toThrow(
      'A2A call to "peer_b" failed: the remote answered an error',
    )

    const scalar = peer(jsonFetch('[1]'))
    await expect(scalar.handler({ message: 'hi' })).rejects.toThrow(
      'A2A call to "peer_b" failed: the answer was not a JSON-RPC response',
    )

    const noResult = peer(jsonFetch({ jsonrpc: '2.0', id: 'x' }))
    await expect(noResult.handler({ message: 'hi' })).rejects.toThrow(
      'A2A call to "peer_b" failed: the result was neither a message nor a task',
    )

    const notJson = peer(jsonFetch('<html>'))
    await expect(notJson.handler({ message: 'hi' })).rejects.toThrow(
      'A2A call to "peer_b" failed: the answer was not JSON',
    )

    const other = peer(jsonFetch({ jsonrpc: '2.0', id: 'x', result: { kind: 'status-update' } }))
    await expect(other.handler({ message: 'hi' })).rejects.toThrow(
      'A2A call to "peer_b" failed: the result was neither a message nor a task',
    )

    const refused = peer(jsonFetch('', { status: 401, statusText: 'Unauthorized' }))
    await expect(refused.handler({ message: 'hi' })).rejects.toThrow(
      'A2A call to "peer_b" failed: 401 Unauthorized',
    )
  })

  it('returns an empty string for a result message whose only text part is empty', async () => {
    await expect(peer(jsonFetch(message(['']))).handler({ message: 'hi' })).resolves.toBe('')
  })

  it('rejects with the abort reason when the caller cancels a JSON-RPC call', async () => {
    const controller = new AbortController()
    const reason = new Error('run cancelled')
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason as Error)
          })
        }),
    )
    const call = peer(fetchImpl).handler({ message: 'hi' }, { signal: controller.signal })
    controller.abort(reason)
    await expect(call).rejects.toBe(reason)
  })
})
