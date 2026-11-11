import { describe, expect, it } from 'vitest'

import { createGoogleChatRoute } from '../src/webhooks/google-chat.js'

function request(headers: Record<string, string>, body = '{}'): Request {
  return new Request('http://localhost/webhooks/google_chat', { method: 'POST', headers, body })
}

describe('createGoogleChatRoute', () => {
  it('forwards the bearer header and raw body, and answers what the adapter answers', async () => {
    const seen: unknown[] = []
    const route = createGoogleChatRoute({
      handleRequest: async (authorization, raw) => {
        seen.push(authorization, raw)
        return { status: 200, body: {} }
      },
    })
    const response = await route(request({ authorization: 'Bearer abc' }, '{"type":"MESSAGE"}'))
    expect(response.status).toBe(200)
    expect(seen).toEqual(['Bearer abc', '{"type":"MESSAGE"}'])
  })

  it('refuses a request with no bearer token before reading the adapter', async () => {
    const route = createGoogleChatRoute({
      handleRequest: async () => {
        throw new Error('must not be called')
      },
    })
    expect((await route(request({}))).status).toBe(401)
  })

  it('passes the adapter refusal through', async () => {
    const route = createGoogleChatRoute({ handleRequest: async () => ({ status: 503, body: { error: 'keys' } }) })
    const response = await route(request({ authorization: 'Bearer abc' }))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'keys' })
  })

  it('refuses a body over 1 MiB with 413', async () => {
    const route = createGoogleChatRoute({ handleRequest: async () => ({ status: 200, body: {} }) })
    const response = await route(request({ authorization: 'Bearer abc' }, 'x'.repeat(1024 * 1024 + 1)))
    expect(response.status).toBe(413)
  })
})
