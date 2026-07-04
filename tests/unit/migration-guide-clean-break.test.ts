import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * M3 DoD line 2 — the migration guide is published and covers both migrations
 * (client `useAgentStream` → `useAgent`, server `defineAgentEndpoint` → `defineAgent`)
 * plus a removed-exports table, so an app can move to 0.14.0 without guesswork.
 */
const GUIDE = resolve(__dirname, '../../docs/migration/0.13-to-0.14-agent-surface.md')

function read(): string {
  return readFileSync(GUIDE, 'utf-8')
}

describe('M3 migration guide (0.13 → 0.14 agent surface)', () => {
  it('the guide file exists', () => {
    expect(existsSync(GUIDE)).toBe(true)
  })

  it('documents the client migration useAgentStream → useAgent', () => {
    const src = read()
    expect(src).toMatch(/useAgentStream/)
    expect(src).toMatch(/useAgent\b/)
    expect(src).toMatch(/UIMessage/)
  })

  it('documents the server migration defineAgentEndpoint → defineAgent', () => {
    const src = read()
    expect(src).toMatch(/defineAgentEndpoint/)
    expect(src).toMatch(/defineAgent\b/)
    expect(src).toMatch(/agents\/chat\.ts|agents\/<name>\.ts/)
  })

  it('includes a removed-exports table with replacements', () => {
    const src = read()
    expect(src).toMatch(/Removed exports/i)
    // A markdown table mapping removed → replacement.
    expect(src).toMatch(/\| Removed[\s\S]*Replacement/i)
    expect(src).toMatch(/consumeUIMessageStream/)
  })

  it('states the wire-format change (AgentEvent SSE → UIMessageStream)', () => {
    const src = read()
    expect(src).toMatch(/UIMessageStream/)
    expect(src).toMatch(/x-vercel-ai-ui-message-stream/)
  })
})
