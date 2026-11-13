/**
 * #1893 — the ACP entry runs the same startup steps as the CLI and the TUI before the factory is
 * exported, so THEOCODE_HOME and friends are applied before the SDK resolves any path.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const buildChatAgent = vi.fn(() => ({ kind: 'fake-agent' }))
const seen: Record<string, string | undefined>[] = []
const toAgentFactory = vi.fn((factory: unknown, _options?: unknown) => {
  seen.push({
    THEOKIT_HOME: process.env.THEOKIT_HOME,
    THEOKIT_AUTH_HOME: process.env.THEOKIT_AUTH_HOME,
    CLAUDE_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR,
  })
  return factory
})

vi.mock('../../src/chat/chat.js', () => ({ buildChatAgent }))
vi.mock('@theokit/agents', () => ({ toAgentFactory, setDiagnosticsSink: vi.fn() }))
vi.mock('@theocode/shared/diagnostic-sink', () => ({ installDiagnosticSink: vi.fn() }))
vi.mock('../../src/auth/index.js', () => ({ resolveFreshCredential: vi.fn() }))

const KEYS = ['THEOCODE_HOME', 'THEOKIT_HOME', 'THEOKIT_AUTH_HOME', 'CLAUDE_PROJECT_DIR'] as const

describe('#1893 — the ACP entry bootstraps before exporting the factory', () => {
  const saved: Record<string, string | undefined> = {}
  let dir = ''

  beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k]
    for (const k of KEYS) delete process.env[k]
    dir = mkdtempSync(join(tmpdir(), 'acp-bootstrap-'))
    seen.length = 0
    vi.resetModules()
  })

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
    rmSync(dir, { recursive: true, force: true })
  })

  it('test_acp_entry_installs_sdk_home_variables_from_THEOCODE_HOME_before_the_factory', async () => {
    process.env.THEOCODE_HOME = dir
    await import('../../src/chat/chat-acp.js')

    expect(seen).toHaveLength(1)
    expect(seen[0]?.THEOKIT_HOME, 'SDK home was not installed before the factory was exported').toBe(
      dir,
    )
    expect(seen[0]?.THEOKIT_AUTH_HOME).toBeTruthy()
    expect(seen[0]?.CLAUDE_PROJECT_DIR).toBe(process.cwd())
  })
})
