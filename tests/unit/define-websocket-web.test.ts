/**
 * T5a.2 Phase F slice 3/3 — Web-Standards WebSocket handler tests.
 *
 * Verifies `defineWebSocketWeb(handler): WebSocketHandlerWeb` is a
 * behaviour-equivalent mirror of `defineWebSocket` for the Web Request
 * shape. Shape differs in:
 *   - onOpen receives Request (not IncomingMessage)
 *   - onMessage data is string | Uint8Array (not string | Buffer)
 *   - onClose reason is string (not Buffer — Web CloseEvent exposes UTF-8)
 *
 * Per `docs/plans/t5a2-incoming-message-to-request-shape-refactor-plan.md`
 * v1.0 § Phase F (closes Phase F).
 */
import { describe, it, expect } from 'vitest'

import {
  defineWebSocketWeb,
  type WebSocketHandlerWeb,
  type WebSocketLike,
} from '../../packages/theo/src/server/define/define-websocket.js'

function fakeWs(): WebSocketLike {
  return {
    send: () => {
      /* noop */
    },
    close: () => {
      /* noop */
    },
  }
}

describe('defineWebSocketWeb (T5a.2 Phase F slice 3/3 — Web shape)', () => {
  it('returns the handler unchanged (identity function)', () => {
    const handler: WebSocketHandlerWeb = {
      onOpen: () => {
        /* noop */
      },
      onMessage: () => {
        /* noop */
      },
      onClose: () => {
        /* noop */
      },
      onError: () => {
        /* noop */
      },
    }
    expect(defineWebSocketWeb(handler)).toBe(handler)
  })

  it('all-optional-methods-omitted is valid', () => {
    const handler = defineWebSocketWeb({})
    expect(handler.onOpen).toBeUndefined()
    expect(handler.onMessage).toBeUndefined()
    expect(handler.onClose).toBeUndefined()
    expect(handler.onError).toBeUndefined()
  })

  it('onOpen receives Request (not IncomingMessage); .headers.get works', () => {
    const openedRequests: string[] = []
    const handler = defineWebSocketWeb({
      onOpen: (_ws, request) => {
        // Type-level: `request` is `Request` → has `.headers.get(name)`
        const userAgent = request.headers.get('user-agent') ?? '(none)'
        openedRequests.push(userAgent)
      },
    })
    const request = new Request('http://example.com/ws', {
      method: 'GET',
      headers: { 'user-agent': 'theo-ws-test/1.0' },
    })
    handler.onOpen?.(fakeWs(), request)
    expect(openedRequests).toEqual(['theo-ws-test/1.0'])
  })

  it('onMessage accepts string data', () => {
    const received: string[] = []
    const handler = defineWebSocketWeb({
      onMessage: (_ws, data) => {
        if (typeof data === 'string') received.push(data)
      },
    })
    handler.onMessage?.(fakeWs(), 'hello')
    expect(received).toEqual(['hello'])
  })

  it('onMessage accepts Uint8Array data (Web standard; not Buffer)', () => {
    const received: number[] = []
    const handler = defineWebSocketWeb({
      onMessage: (_ws, data) => {
        if (data instanceof Uint8Array) {
          for (const b of data) received.push(b)
        }
      },
    })
    handler.onMessage?.(fakeWs(), new Uint8Array([1, 2, 3]))
    expect(received).toEqual([1, 2, 3])
  })

  it('onClose receives string reason (Web standard; not Buffer)', () => {
    const closes: { code: number; reason: string }[] = []
    const handler = defineWebSocketWeb({
      onClose: (_ws, code, reason) => {
        // Type-level: `reason` is `string` not `Buffer`
        closes.push({ code, reason })
      },
    })
    handler.onClose?.(fakeWs(), 1000, 'normal close')
    expect(closes).toEqual([{ code: 1000, reason: 'normal close' }])
  })

  it('onError receives an Error instance', () => {
    const errors: string[] = []
    const handler = defineWebSocketWeb({
      onError: (_ws, error) => {
        errors.push(error.message)
      },
    })
    handler.onError?.(fakeWs(), new Error('connection reset'))
    expect(errors).toEqual(['connection reset'])
  })
})
