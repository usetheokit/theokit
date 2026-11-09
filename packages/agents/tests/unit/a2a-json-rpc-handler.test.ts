/**
 * B-394 (OC-13) — the A2A JSON-RPC `message/send` handler.
 *
 * `createA2AJsonRpcHandler({ authorize, respond, maxBodyBytes, timeoutMs })` owns the wire: it
 * refuses an unauthorized request before reading its body, bounds the body, answers every malformed
 * request with its JSON-RPC 2.0 code, and answers -32603 the moment its deadline passes even when
 * `respond` never settles. TDD RED-first.
 */
import { describe, expect, it, vi } from 'vitest'

import { createA2AJsonRpcHandler } from '../../src/a2a/a2a-json-rpc-handler.js'

const URL_A2A = 'http://b.test/a2a'

function sendBody(parts: unknown[], id: string | number = 7): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'message/send',
    params: { message: { role: 'user', messageId: 'm1', parts } },
  })
}

function post(body: BodyInit, headers: Record<string, string> = {}): Request {
  return new Request(URL_A2A, {
    method: 'POST',
    headers: { authorization: 'Bearer good', 'content-type': 'application/json', ...headers },
    body,
    // Node's Request needs this for a stream body.
    ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
  } as RequestInit)
}

function handlerWith(
  respond: (text: string, signal: AbortSignal) => Promise<string>,
  overrides: { maxBodyBytes?: number; timeoutMs?: number } = {},
) {
  return createA2AJsonRpcHandler({
    authorize: (header) => header === 'Bearer good',
    respond,
    maxBodyBytes: overrides.maxBodyBytes ?? 65536,
    timeoutMs: overrides.timeoutMs ?? 5000,
  })
}

interface JsonRpcAnswer {
  jsonrpc: string
  id: string | number | null
  result?: {
    kind: string
    role: string
    messageId: string
    parts: { kind: string; text: string }[]
  }
  error?: { code: number; message: string }
}

async function answer(res: Response): Promise<JsonRpcAnswer> {
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('application/json')
  return (await res.json()) as JsonRpcAnswer
}

describe('createA2AJsonRpcHandler', () => {
  it('answers message/send with an agent message carrying the respond text and the request id', async () => {
    const respond = vi.fn(async (_text: string, _signal: AbortSignal) => 'hello')
    const handle = handlerWith(respond)

    const numeric = await answer(
      await handle(
        post(
          sendBody(
            [
              { kind: 'text', text: 'a' },
              { kind: 'text', text: 'b' },
            ],
            7,
          ),
        ),
      ),
    )
    expect(respond).toHaveBeenCalledTimes(1)
    expect(respond.mock.calls[0]?.[0]).toBe('a\nb')
    expect(numeric.jsonrpc).toBe('2.0')
    expect(numeric.id).toBe(7)
    expect(numeric.result?.kind).toBe('message')
    expect(numeric.result?.role).toBe('agent')
    expect(typeof numeric.result?.messageId).toBe('string')
    expect(numeric.result?.parts).toEqual([{ kind: 'text', text: 'hello' }])

    const textual = await answer(
      await handle(post(sendBody([{ kind: 'text', text: 'x' }], 'req-1'))),
    )
    expect(textual.id).toBe('req-1')
    expect(textual.result?.parts[0]?.text).toBe('hello')
  })

  it('refuses a missing or wrong bearer with 401 before reading the body and never calls respond', async () => {
    const respond = vi.fn(async () => 'never')
    const handle = handlerWith(respond)
    for (const headers of [{ authorization: 'Bearer wrong' }, { authorization: '' }]) {
      let pulled = false
      // highWaterMark 0: the stream pulls only when someone reads it.
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            pulled = true
            controller.enqueue(new TextEncoder().encode(sendBody([{ kind: 'text', text: 'hi' }])))
            controller.close()
          },
        },
        { highWaterMark: 0 },
      )
      const res = await handle(post(body, headers))
      expect(res.status).toBe(401)
      expect(res.headers.get('www-authenticate')).toBe('Bearer')
      expect(await res.text()).toBe('')
      expect(pulled).toBe(false)
    }
    const absent = await handle(
      new Request(URL_A2A, { method: 'POST', body: sendBody([{ kind: 'text', text: 'hi' }]) }),
    )
    expect(absent.status).toBe(401)
    expect(respond).not.toHaveBeenCalled()
  })

  it('answers a method other than POST with 405', async () => {
    const respond = vi.fn(async () => 'never')
    const res = await handlerWith(respond)(new Request(URL_A2A, { method: 'GET' }))
    expect(res.status).toBe(405)
    expect(respond).not.toHaveBeenCalled()
  })

  it('answers parse, request, method and params errors with their JSON-RPC codes and never calls respond', async () => {
    const respond = vi.fn(async () => 'never')
    const handle = handlerWith(respond, { maxBodyBytes: 4096 })

    const parse = await answer(await handle(post('{not json')))
    expect(parse.error?.code).toBe(-32700)
    expect(parse.id).toBeNull()

    const noVersion = await answer(
      await handle(post(JSON.stringify({ id: 1, method: 'message/send', params: {} }))),
    )
    expect(noVersion.error?.code).toBe(-32600)
    expect(noVersion.id).toBeNull()

    const objectId = await answer(
      await handle(post(JSON.stringify({ jsonrpc: '2.0', id: { a: 1 }, method: 'message/send' }))),
    )
    expect(objectId.error?.code).toBe(-32600)
    expect(objectId.id).toBeNull()

    const method = await answer(
      await handle(
        post(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tasks/get', params: {} })),
      ),
    )
    expect(method.error?.code).toBe(-32601)
    expect(method.error?.message).toContain('tasks/get')
    expect(method.id).toBe(3)

    const params = await answer(await handle(post(sendBody([], 4))))
    expect(params.error?.code).toBe(-32602)
    expect(params.id).toBe(4)

    for (const id of [null, true, []]) {
      const badId = await answer(
        await handle(post(JSON.stringify({ jsonrpc: '2.0', id, method: 'message/send' }))),
      )
      expect(badId.error?.code).toBe(-32600)
    }
    const numericMethod = await answer(
      await handle(post(JSON.stringify({ jsonrpc: '2.0', id: 5, method: 42 }))),
    )
    expect(numericMethod.error?.code).toBe(-32600)
    for (const params of [{}, { message: {} }, { message: { parts: 'text' } }]) {
      const badParams = await answer(
        await handle(
          post(JSON.stringify({ jsonrpc: '2.0', id: 6, method: 'message/send', params })),
        ),
      )
      expect(badParams.error?.code).toBe(-32602)
    }
    const emptyText = await answer(await handle(post(sendBody([{ kind: 'text', text: '' }], 8))))
    expect(emptyText.error?.code).toBe(-32602)

    const over = await handle(post('x'.repeat(4097)))
    expect(over.status).toBe(413)
    const atBound = await answer(await handle(post(' '.repeat(4096 - 2) + '{}')))
    expect(atBound.error?.code).toBe(-32600)

    expect(respond).not.toHaveBeenCalled()
  })

  it('answers a batch array with -32600 and id null', async () => {
    const respond = vi.fn(async () => 'never')
    const batch = `[${sendBody([{ kind: 'text', text: 'a' }], 1)}]`
    const res = await answer(await handlerWith(respond)(post(batch)))
    expect(res.error?.code).toBe(-32600)
    expect(res.id).toBeNull()
    expect(respond).not.toHaveBeenCalled()
  })

  it('reads only the text parts of a mixed message', async () => {
    const respond = vi.fn(async (_text: string, _signal: AbortSignal) => 'ok')
    const handle = handlerWith(respond)
    const mixed = await answer(
      await handle(
        post(
          sendBody([
            { kind: 'file', file: { uri: 'https://x/f' } },
            { kind: 'text', text: 'only this' },
            { kind: 'data', data: { a: 1 } },
          ]),
        ),
      ),
    )
    expect(mixed.result?.parts[0]?.text).toBe('ok')
    expect(respond.mock.calls[0]?.[0]).toBe('only this')

    const nonText = await answer(await handle(post(sendBody([{ kind: 'data', data: {} }], 9))))
    expect(nonText.error?.code).toBe(-32602)
    expect(respond).toHaveBeenCalledTimes(1)
  })

  it('answers an empty reply as a message with one empty text part', async () => {
    const res = await answer(
      await handlerWith(async () => '')(post(sendBody([{ kind: 'text', text: 'hi' }]))),
    )
    expect(res.result?.parts).toEqual([{ kind: 'text', text: '' }])
  })

  it('answers -32603 without a stack when respond throws or its signal aborts', async () => {
    const thrown = await answer(
      await handlerWith(async () => {
        throw new Error('secret path /x')
      })(post(sendBody([{ kind: 'text', text: 'hi' }], 11))),
    )
    expect(thrown.error?.code).toBe(-32603)
    expect(thrown.error?.message).toBe('the agent turn failed')
    expect(JSON.stringify(thrown)).not.toContain('/x')
    expect(thrown.id).toBe(11)

    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const pending: { reject?: (err: Error) => void } = {}
      let seenSignal: AbortSignal | undefined
      const stuck = (_text: string, signal: AbortSignal) => {
        seenSignal = signal
        return new Promise<string>((_resolve, reject) => {
          pending.reject = reject
        })
      }
      const started = Date.now()
      const late = await answer(
        await handlerWith(stuck, { timeoutMs: 20 })(post(sendBody([{ kind: 'text', text: 'hi' }]))),
      )
      expect(Date.now() - started).toBeLessThan(500)
      expect(late.error?.code).toBe(-32603)
      expect(late.error?.message).toBe('the agent turn ran out of time after 20 ms')
      expect(seenSignal?.aborted).toBe(true)
      pending.reject?.(new Error('late failure'))
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('aborts the respond signal when the request signal aborts', async () => {
    const controller = new AbortController()
    let seenSignal: AbortSignal | undefined
    const respond = (_text: string, signal: AbortSignal) => {
      seenSignal = signal
      controller.abort()
      return new Promise<string>(() => undefined)
    }
    const request = new Request(URL_A2A, {
      method: 'POST',
      headers: { authorization: 'Bearer good' },
      body: sendBody([{ kind: 'text', text: 'hi' }]),
      signal: controller.signal,
    })
    const res = await answer(await handlerWith(respond)(request))
    expect(res.error?.code).toBe(-32603)
    expect(seenSignal?.aborted).toBe(true)
  })

  it('answers 408 when the body is still being read at the deadline', async () => {
    const respond = vi.fn(async () => 'never')
    const stalled = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"jsonrpc":'))
      },
    })
    const res = await handlerWith(respond, { timeoutMs: 20 })(post(stalled))
    expect(res.status).toBe(408)
    expect(respond).not.toHaveBeenCalled()
  })

  it('answers a result that settled in the same turn as the deadline as a result', async () => {
    const controller = new AbortController()
    const respond = async () => {
      controller.abort()
      return 'made it'
    }
    const request = new Request(URL_A2A, {
      method: 'POST',
      headers: { authorization: 'Bearer good' },
      body: sendBody([{ kind: 'text', text: 'hi' }]),
      signal: controller.signal,
    })
    const res = await answer(await handlerWith(respond)(request))
    expect(res.result?.parts).toEqual([{ kind: 'text', text: 'made it' }])
  })

  it('answers 400 when the body stream errors and never calls respond', async () => {
    const respond = vi.fn(async () => 'never')
    const broken = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('connection reset'))
      },
    })
    const res = await handlerWith(respond)(post(broken))
    expect(res.status).toBe(400)
    expect(respond).not.toHaveBeenCalled()
  })

  it('stops reading an oversized multi-chunk body and cancels the stream', async () => {
    const respond = vi.fn(async () => 'never')
    let pulls = 0
    let cancelled = false
    const endless = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1
          controller.enqueue(new Uint8Array(1024))
        },
        cancel() {
          cancelled = true
        },
      },
      { highWaterMark: 0 },
    )
    const res = await handlerWith(respond, { maxBodyBytes: 4096 })(post(endless))
    expect(res.status).toBe(413)
    expect(cancelled).toBe(true)
    expect(pulls).toBeLessThan(10)
    expect(respond).not.toHaveBeenCalled()
  })
})
