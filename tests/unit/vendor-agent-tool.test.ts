import { describe, expect, it, vi } from 'vitest'

import { createVendorAgentTool } from '../../packages/theo/src/server/agent/vendor-agent-tool.js'

/**
 * M28 (ADR-0041) — createVendorAgentTool: expose a third-party agent SDK (Claude Agent SDK,
 * OpenAI, Cursor) behind a uniform `CustomTool` (like M17 ACP). The vendor RUNTIME stays theirs —
 * TheoKit only wires. The vendor client is injected (real SDK client in prod, a fake in tests), so
 * this never imports a vendor dep into core. Resume is threaded via the vendor's session id.
 */

/** A structural fake of a vendor agent client. */
function fakeVendorClient() {
  return {
    query: vi.fn(async (prompt: string, opts?: { resumeSessionId?: string }) => ({
      text: opts?.resumeSessionId
        ? `resumed(${opts.resumeSessionId}): ${prompt}`
        : `fresh: ${prompt}`,
      sessionId: 's-123',
    })),
  }
}

describe('M28 — createVendorAgentTool', () => {
  it('produces a CustomTool that delegates the prompt to the vendor client', async () => {
    const client = fakeVendorClient()
    const tool = createVendorAgentTool({ vendor: 'claude', client })

    expect(tool.name).toBe('claude_agent')
    expect(tool.description).toMatch(/claude/i)

    const out = await tool.handler({ prompt: 'summarize the repo' })
    expect(client.query).toHaveBeenCalledWith('summarize the repo', undefined)
    expect(out).toBe('fresh: summarize the repo')
  })

  it('honors a custom name + description', () => {
    const tool = createVendorAgentTool({
      vendor: 'openai',
      client: fakeVendorClient(),
      name: 'research_agent',
      description: 'Deep research via OpenAI',
    })
    expect(tool.name).toBe('research_agent')
    expect(tool.description).toBe('Deep research via OpenAI')
  })

  it('threads resumeSessionId to the vendor client (resume support)', async () => {
    const client = fakeVendorClient()
    const tool = createVendorAgentTool({ vendor: 'claude', client })

    const out = await tool.handler({ prompt: 'continue', resumeSessionId: 's-123' })
    expect(client.query).toHaveBeenCalledWith('continue', { resumeSessionId: 's-123' })
    expect(out).toBe('resumed(s-123): continue')
  })

  it('surfaces the vendor session id via onSession (side-channel, keeps it out of the model view)', async () => {
    const client = fakeVendorClient()
    const onSession = vi.fn()
    const tool = createVendorAgentTool({ vendor: 'claude', client, onSession })

    const out = await tool.handler({ prompt: 'hi' })
    expect(onSession).toHaveBeenCalledWith('s-123')
    // The model sees only the text, not the session bookkeeping.
    expect(out).toBe('fresh: hi')
  })

  it('fails clearly when the client does not expose query()', () => {
    expect(() => createVendorAgentTool({ vendor: 'claude', client: {} as never })).toThrow(
      /vendor.*query\(\)|does not expose/i,
    )
  })

  it('fails clearly when vendor is empty', () => {
    expect(() => createVendorAgentTool({ vendor: '', client: fakeVendorClient() })).toThrow(
      /vendor/i,
    )
  })
})
