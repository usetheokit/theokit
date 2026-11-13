import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, it, vi } from 'vitest'

vi.mock('../../src/chat/chat.js', () => ({ buildChatAgent: vi.fn() }))
vi.mock('@theokit/agents', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  toAgentFactory: (f: unknown) => f,
}))

const KEYS = ['THEOCODE_HOME', 'THEOKIT_AUTH_HOME', 'THEOKIT_HOME', 'CLAUDE_PROJECT_DIR']
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

it('installs the SDK home variables from THEOCODE_HOME before the factory is exported', async () => {
  dir = mkdtempSync(join(tmpdir(), 'acp-bootstrap-'))
  for (const k of KEYS) delete process.env[k]
  process.env.THEOCODE_HOME = dir
  vi.resetModules()
  const mod = await import('../../src/chat/chat-acp.js')
  expect(mod.default).toBeDefined()
  expect(process.env.THEOKIT_AUTH_HOME).toBe(dir)
  expect(process.env.THEOKIT_HOME).toBeTruthy()
  expect(process.env.CLAUDE_PROJECT_DIR).toBe(process.cwd())
})
