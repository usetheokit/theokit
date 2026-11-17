import { describe, expect, it } from 'vitest'

import { AGENT_ACTION_HEADERS, agentRequestHeaders } from '../../src/client-entry.js'

describe('@theokit/agents/client agent request headers', () => {
  it('exports the CSRF action header', () => {
    expect(AGENT_ACTION_HEADERS['X-Theo-Action']).toBe('1')
  })

  it('merges x-theo-action case-insensitively, keeping the later value', () => {
    const merged = agentRequestHeaders(AGENT_ACTION_HEADERS, { 'x-theo-action': '0' })
    const keys = Object.keys(merged).filter((k) => k.toLowerCase() === 'x-theo-action')
    expect(keys).toEqual(['x-theo-action'])
    expect(merged['x-theo-action']).toBe('0')
  })
})
