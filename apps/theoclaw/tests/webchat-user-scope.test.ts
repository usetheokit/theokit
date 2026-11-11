import { describe, expect, it } from 'vitest'

import { TRUSTED_IDENTITY_HEADER } from '../src/control-plane/trusted-proxy.js'
import type { TurnRunner } from '../src/control-plane/turn.js'
import { createWebchatRoutes } from '../src/webchat/routes.js'

const TOKEN = 'webchat-token-value-0123456789abcdef'

function post(identity: string | undefined): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (identity !== undefined) headers[TRUSTED_IDENTITY_HEADER] = identity
  return new Request('http://localhost/webchat/chat', {
    method: 'POST',
    headers,
    body: JSON.stringify({ message: 'hi', id: 'chat-1' }),
  })
}

describe('webchat per-user sessions behind a trusted proxy', () => {
  it('gives two identities naming one chat id two different chats', async () => {
    const seen: string[] = []
    const turnFor = (chatId: string): TurnRunner => {
      seen.push(chatId)
      return (async () => ({ status: 'completed' })) as unknown as TurnRunner
    }
    const handle = createWebchatRoutes({
      token: TOKEN,
      turnFor,
      assetsDir: '/nonexistent',
      trustedProxy: true,
    })
    for (const who of ['alice@example.com', 'bob@example.com', 'alice@example.com']) {
      const response = await handle(post(who))
      await response.text()
    }
    expect(seen).toHaveLength(3)
    expect(seen[0]).not.toBe(seen[1])
    expect(seen[0]).toBe(seen[2])
    expect(seen[0]).toMatch(/\.chat-1$/)
    expect(seen[0]).not.toContain('alice')
  })
})
