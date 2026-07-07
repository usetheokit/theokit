/**
 * M15 (theokit-ai-first) — A2A agent card generation.
 *
 * ADR-0040 § D2: exposing an agent's capabilities over HTTP (agent cards) is a HOME/DISCOVERY
 * concern — it advertises the app's agents to other systems. `buildAgentCard` is a pure data
 * transform from the framework's `AgentManifestEntry` to an A2A-spec card. No LLM, no runtime.
 *
 * TDD RED-first: the card shape is the contract other A2A systems consume.
 */
import { describe, expect, it } from 'vitest'

import type { AgentManifestEntry } from '../../src/manifest/agent-manifest.js'
import { buildAgentCard, wellKnownCardPath } from '../../src/a2a/agent-card.js'

const entry: AgentManifestEntry = {
  name: 'support-agent',
  route: '/api/agents/support-agent',
  model: 'claude-sonnet-4-6',
  stream: true,
  mainLoop: { method: 'run', strategy: 'simple-chat' },
  guards: [],
  interceptors: [],
  tools: [
    { name: 'search_docs', description: 'Search the knowledge base', approval: false, trace: true, audit: false },
    { name: 'create_ticket', description: 'Open a support ticket', approval: true, trace: true, audit: true },
  ],
  subAgents: [],
}

describe('buildAgentCard', () => {
  it('maps identity, streaming capability and the absolute endpoint URL', () => {
    const card = buildAgentCard(entry, { baseUrl: 'https://app.example.com' })
    expect(card.name).toBe('support-agent')
    expect(card.url).toBe('https://app.example.com/api/agents/support-agent')
    expect(card.version).toBe('1.0')
    expect(card.capabilities.streaming).toBe(true)
    expect(card.defaultInputModes).toContain('text')
    expect(card.defaultOutputModes).toContain('text')
  })

  it('maps each tool to an A2A skill (id, name, description)', () => {
    const card = buildAgentCard(entry, { baseUrl: 'https://app.example.com' })
    expect(card.skills).toHaveLength(2)
    expect(card.skills[0]).toMatchObject({
      id: 'search_docs',
      name: 'search_docs',
      description: 'Search the knowledge base',
    })
    expect(card.skills.map((s) => s.id)).toEqual(['search_docs', 'create_ticket'])
  })

  it('honors a description override and trims a trailing slash on baseUrl', () => {
    const card = buildAgentCard(entry, {
      baseUrl: 'https://app.example.com/',
      description: 'Handles customer support requests.',
    })
    expect(card.description).toBe('Handles customer support requests.')
    expect(card.url).toBe('https://app.example.com/api/agents/support-agent')
  })

  it('defaults the description when none is given (non-empty, spec requires it)', () => {
    const card = buildAgentCard(entry, { baseUrl: 'https://app.example.com' })
    expect(typeof card.description).toBe('string')
    expect(card.description.length).toBeGreaterThan(0)
  })

  it('derives the /.well-known discovery path from the agent name', () => {
    expect(wellKnownCardPath('support-agent')).toBe('/.well-known/support-agent/agent-card.json')
  })
})
