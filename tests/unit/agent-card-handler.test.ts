/**
 * M15 (theokit-ai-first) — serve the A2A agent card over HTTP (E2E route wiring).
 *
 * `buildAgentCard` (in @theokit/agents) is the pure generator; this serves it at
 * `/.well-known/<name>/agent-card.json` from a loaded agent module. Web-Standard Request→Response
 * (G8). Pure-enough to unit-test without a Vite server.
 */
import { defineAgent } from '../../packages/agents/src/index.js'
import { describe, expect, it } from 'vitest'

import { handleAgentCard, isAgentCardPath } from '../../packages/theo/src/server/agent/agent-card-handler.js'

const mod = {
  default: defineAgent({
    model: 'claude-sonnet-4-6',
    tools: [
      {
        name: 'search',
        description: 'Search the knowledge base',
        inputSchema: { type: 'object', properties: {} },
        handler: () => 'ok',
      },
    ],
  }),
}

describe('isAgentCardPath', () => {
  it('extracts the agent name from a well-known card path', () => {
    expect(isAgentCardPath('/.well-known/support/agent-card.json')).toBe('support')
  })
  it('returns null for non-card paths', () => {
    expect(isAgentCardPath('/api/agents/support')).toBeNull()
    expect(isAgentCardPath('/.well-known/openid-configuration')).toBeNull()
  })
})

describe('handleAgentCard', () => {
  it('returns a 200 JSON A2A card built from the agent module', async () => {
    const res = handleAgentCard(mod, 'support', '/api/agents/support', 'https://app.example.com')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/application\/json/)

    const card = (await res.json()) as {
      name: string
      url: string
      skills: { id: string }[]
      capabilities: { streaming: boolean }
    }
    expect(card.name).toBe('support')
    expect(card.url).toBe('https://app.example.com/api/agents/support')
    expect(card.skills.map((s) => s.id)).toEqual(['search'])
    expect(card.capabilities.streaming).toBe(true)
  })

  it('returns 500 JSON when the module is not a valid agent', () => {
    const res = handleAgentCard({ default: {} }, 'x', '/api/agents/x', 'https://app.example.com')
    expect(res.status).toBe(500)
  })
})
