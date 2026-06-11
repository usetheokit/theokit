/**
 * T5a.2 Phase F slice 2/3 — Web-Standards channel handler tests.
 *
 * Verifies `defineWebChannel<TMessage>(handler): WebChannelHandler<TMessage>`
 * is a behaviour-equivalent mirror of `defineChannel` for the Web Request
 * shape. The shape differs only in `onSubscribe`'s 3rd argument
 * (`Request` instead of `IncomingMessage`).
 *
 * Per `docs/plans/t5a2-incoming-message-to-request-shape-refactor-plan.md`
 * v1.0 § Phase F.
 */
import { describe, it, expect } from 'vitest'

import {
  defineWebChannel,
  type WebChannelHandler,
} from '../../packages/theo/src/server/define/define-channel.js'

interface ChatMessage {
  text: string
  user: string
}

describe('defineWebChannel (T5a.2 Phase F slice 2/3 — Web shape)', () => {
  it('returns the handler unchanged (identity function)', () => {
    const handler: WebChannelHandler<ChatMessage> = {
      onSubscribe: () => {
        /* noop */
      },
      onMessage: () => {
        /* noop */
      },
      onUnsubscribe: () => {
        /* noop */
      },
    }
    expect(defineWebChannel(handler)).toBe(handler)
  })

  it('handler with all optional methods omitted is valid', () => {
    const handler = defineWebChannel<ChatMessage>({})
    expect(handler.onSubscribe).toBeUndefined()
    expect(handler.onMessage).toBeUndefined()
    expect(handler.onUnsubscribe).toBeUndefined()
  })

  it('onSubscribe receives Request (not IncomingMessage)', () => {
    const subscribed: { room: string; userAgent: string | null }[] = []
    const handler = defineWebChannel<ChatMessage>({
      onSubscribe: (_ws, room, request) => {
        // Type-level: `request` is `Request` → has `.headers.get(name)`
        subscribed.push({
          room,
          userAgent: request.headers.get('user-agent'),
        })
      },
    })
    // Synthesize a fake WebSocketLike + a real Request
    const fakeWs = {
      send: () => {
        /* noop */
      },
      close: () => {
        /* noop */
      },
    } as unknown as Parameters<NonNullable<typeof handler.onSubscribe>>[0]
    const request = new Request('http://example.com/ws', {
      method: 'GET',
      headers: { 'user-agent': 'theo-test/1.0' },
    })
    handler.onSubscribe?.(fakeWs, 'lobby', request)
    expect(subscribed).toEqual([{ room: 'lobby', userAgent: 'theo-test/1.0' }])
  })

  it('onMessage typed by TMessage generic', () => {
    const received: ChatMessage[] = []
    const handler = defineWebChannel<ChatMessage>({
      onMessage: (_ws, _room, data) => {
        // Type-level: `data` is `ChatMessage` (not unknown)
        received.push(data)
      },
    })
    const fakeWs = {} as unknown as Parameters<NonNullable<typeof handler.onMessage>>[0]
    handler.onMessage?.(fakeWs, 'lobby', { text: 'hi', user: 'alice' })
    expect(received).toEqual([{ text: 'hi', user: 'alice' }])
  })

  it('onUnsubscribe fires for room cleanup', () => {
    const cleanups: string[] = []
    const handler = defineWebChannel<ChatMessage>({
      onUnsubscribe: (_ws, room) => {
        cleanups.push(room)
      },
    })
    const fakeWs = {} as unknown as Parameters<NonNullable<typeof handler.onUnsubscribe>>[0]
    handler.onUnsubscribe?.(fakeWs, 'lobby')
    expect(cleanups).toEqual(['lobby'])
  })
})
