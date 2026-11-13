/** #1893 — the ACP entry runs the startup bootstrap before it exports the factory. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/chat/chat.js', () => ({ buildChatAgent: vi.fn() }))
vi.mock('@theokit/agents', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  toAgentFactory: vi.fn((factory: unknown) => factory),
}))
vi.mock('@theocode/shared/diagnostic-sink', () => ({ installDiagnosticSink: vi.fn() }))

const KEYS = ['THEOCODE_HOME', 'THEOKIT_HOME', 'THEOKIT_AUTH_HOME', 'CLAUDE_PROJECT_DIR'] as const

describe('#1893 — ACP entry bootstrap', () => {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
  let dir: string | undefined
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
    if (dir) rmSync(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('installs the SDK home variables from THEOCODE_HOME on import', async () => {
    dir = mkdtempSync(join(tmpdir(), 'acp-boot-'))
    for (const k of KEYS) delete process.env[k]
    process.env.THEOCODE_HOME = dir
    vi.resetModules()

    await import('../../src/chat/chat-acp.js')

    expect(process.env.THEOKIT_HOME).toBeTypeOf('string')
    expect(process.env.THEOKIT_AUTH_HOME).toBe(dir)
    expect(process.env.CLAUDE_PROJECT_DIR).toBe(process.cwd())
  })
})
