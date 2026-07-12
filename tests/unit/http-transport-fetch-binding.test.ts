/**
 * Regression: the browser's native `fetch` throws `TypeError: Illegal invocation` when invoked with a
 * `this` other than `window`. `HttpTransport` stores the default fetch and calls it as `this.#fetch(...)`,
 * so the default MUST be bound to `globalThis` — otherwise EVERY web `useAgent` send dies before it reaches
 * the network (found dogfooding the scaffold's web chat in a real browser; node/jsdom fetch is lenient about
 * `this`, so only a strict native-like fetch — or a real browser — surfaces it).
 */
import { describe, expect, it } from 'vitest'

import { HttpTransport } from '../../packages/theo/src/client/http-transport.js'

describe('HttpTransport — default fetch is called with the right receiver', () => {
  it('does not throw "Illegal invocation" when the global fetch is strict about its this', async () => {
    const realFetch = globalThis.fetch
    // A native-like fetch: throws unless called on globalThis (or unbound) — exactly like the browser's.
    const strictFetch = function (this: unknown): Promise<Response> {
      if (this !== globalThis && this !== undefined) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation")
      }
      return Promise.resolve(new Response(null, { status: 200 }))
    }
    globalThis.fetch = strictFetch as unknown as typeof fetch
    try {
      const transport = new HttpTransport({ api: '/api/agents/chat' })
      // A body-less 200 yields an empty chunk stream (no `ai` import needed) — we only care that the fetch
      // call itself succeeds with the correct receiver.
      await expect(
        transport.sendMessages({
          trigger: 'submit-message',
          chatId: 'c',
          messageId: undefined,
          messages: [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
          abortSignal: undefined,
        }),
      ).resolves.toBeInstanceOf(ReadableStream)
    } finally {
      globalThis.fetch = realFetch
    }
  })
})
