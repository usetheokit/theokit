/**
 * #2937 — both TUI empty-state sites name the current and the previous root, via the framework's
 * `transcriptRootHint`.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ home: '' }))

vi.mock('node:os', async (orig) => {
  const real = await orig<typeof import('node:os')>()
  return { ...real, homedir: () => state.home }
})
vi.mock('@theocode/agent/session', () => ({
  readUserTurnPreviewsAsync: () => Promise.resolve([]),
  forkSessionBeforeUserTurn: () => undefined,
  listSessions: () => Promise.resolve([]),
  archiveSession: vi.fn(),
  deleteSession: vi.fn(),
  compactSession: vi.fn(),
  renameSession: vi.fn(),
}))

import { primeBacktrack } from '../../src/backtrack/backtrack.js'
import { handleListSessions } from '../../src/commands/session-commands.js'

let tmp: string
let current: string
let savedHome: string | undefined

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'root-hint-'))
  state.home = join(tmp, 'home')
  current = join(tmp, 'current')
  mkdirSync(current, { recursive: true })
  mkdirSync(join(state.home, '.theokit', 'projects', 'one'), { recursive: true })
  savedHome = process.env.THEOKIT_HOME
  process.env.THEOKIT_HOME = current
})

afterEach(() => {
  if (savedHome === undefined) delete process.env.THEOKIT_HOME
  else process.env.THEOKIT_HOME = savedHome
  rmSync(tmp, { recursive: true, force: true })
})

function expectBothRoots(message: string): void {
  expect(message).toContain(current)
  expect(message).toContain(join(state.home, '.theokit'))
}

describe('transcriptRootHint at the TUI call sites', () => {
  it('primeBacktrack names both roots', async () => {
    const setToast = vi.fn()
    await primeBacktrack({ currentSessionId: () => 's', setToast } as never)
    expectBothRoots((setToast.mock.calls[0]![0] as { message: string }).message)
  })

  it('handleListSessions names both roots', async () => {
    const message = await new Promise<string>((resolve) => {
      handleListSessions(
        () => 's',
        (t) => resolve((t as { message: string }).message),
      )
    })
    expectBothRoots(message)
  })
})
