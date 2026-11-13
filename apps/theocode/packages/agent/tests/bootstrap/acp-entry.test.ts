import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@theokit/agents', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  toAgentFactory: (factory: unknown) => ({ factory, marker: 'factory' }),
  setDiagnosticsSink: () => {},
}))
vi.mock('../../src/chat/chat.js', () => ({ buildChatAgent: async () => ({}) }))

const saved = { ...process.env }
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
  Object.assign(process.env, saved)
})

describe('ACP entry bootstrap', () => {
  it('installs the SDK home variables from THEOKIT_HOME before the factory is exported', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acp-entry-'))
    try {
      process.env.THEOKIT_HOME = join(dir, 'state')
      delete process.env.CLAUDE_PROJECT_DIR
      delete process.env.THEOKIT_AUTH_HOME
      vi.resetModules()
      const mod = (await import('../../src/chat/chat-acp.js')) as unknown as { default: { marker: string } }
      expect(mod.default.marker).toBe('factory')
      expect(process.env.THEOKIT_HOME).toBe(join(dir, 'state'))
      expect(process.env.CLAUDE_PROJECT_DIR).toBe(process.cwd())
      expect(process.env.THEOKIT_AUTH_HOME).toBeDefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
