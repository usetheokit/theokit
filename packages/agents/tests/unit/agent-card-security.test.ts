/**
 * B-394 (OC-13) — an agent card can declare how a caller authenticates.
 *
 * `buildAgentCard` copies `securitySchemes` and `security` when given, and a card built without
 * them is exactly the card it built before (its one production caller passes neither). TDD RED-first.
 */
import { describe, expect, it } from 'vitest'

import { buildAgentCard } from '../../src/a2a/agent-card.js'
import type { AgentManifestEntry } from '../../src/manifest/agent-manifest.js'

const entry: AgentManifestEntry = {
  name: 'theoclaw',
  route: '/a2a',
  stream: false,
  mainLoop: { method: 'message/send', strategy: 'worker' },
  guards: [],
  interceptors: [],
  tools: [],
  subAgents: [],
}

describe('buildAgentCard security fields', () => {
  it('copies security schemes into the card and leaves a card without them unchanged', () => {
    const plain = buildAgentCard(entry, { baseUrl: 'http://127.0.0.1:7300/' })
    expect(plain).toEqual({
      name: 'theoclaw',
      description: 'TheoKit agent "theoclaw".',
      url: 'http://127.0.0.1:7300/a2a',
      version: '1.0',
      capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
      defaultInputModes: ['text'],
      defaultOutputModes: ['text'],
      skills: [],
    })
    expect('securitySchemes' in plain).toBe(false)
    expect('security' in plain).toBe(false)

    const secured = buildAgentCard(entry, {
      baseUrl: 'http://127.0.0.1:7300',
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
      security: [{ bearer: [] }],
    })
    expect(secured.securitySchemes).toEqual({ bearer: { type: 'http', scheme: 'bearer' } })
    expect(secured.security).toEqual([{ bearer: [] }])
    expect(secured.url).toBe('http://127.0.0.1:7300/a2a')
  })
})
