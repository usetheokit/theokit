// A fork still copying when the user starts a turn, or moves to another session, must not replace
// the live session. Driven through the real `getTuiRoot().sessionFork`, so it fails if the
// composition root stops guarding the commit; `noteTurnStart` is what the composer reports on submit.

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const gate = vi.hoisted(() => ({ release: undefined as undefined | (() => void) }))

vi.mock('@theocode/agent/session', async (orig) => ({
  ...(await orig<object>()),
  forkSession: (_from: string, to: string) =>
    new Promise((resolve) => {
      gate.release = () => resolve({ newId: to, copied: true })
    }),
}))

import { getTuiRoot } from '../../src/agent-session/composition-root.js'
import { drainAll } from '../../src/terminal-io/index.js'
import { noteTurnStart } from '../../src/persistence/fork-session.js'
import { setWorkingDirectory } from '../../src/working-directory.js'

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'delayed-fork-'))
  mkdirSync(join(dir, '.theokit'))
  setWorkingDirectory(dir)
})
afterAll(async () => {
  await drainAll()
  rmSync(dir, { recursive: true, force: true })
})

/** Read through a call: after `gate.release = undefined` and an await, TypeScript keeps the narrowing. */
function release(): void {
  gate.release?.()
}

async function started(): Promise<void> {
  while (gate.release === undefined) await new Promise((r) => setTimeout(r, 1))
}

describe('a fork in flight, through the composition root', () => {
  it('keeps the live session when a turn starts meanwhile', async () => {
    const root = getTuiRoot()
    const before = root.session.session()
    gate.release = undefined
    const pending = root.sessionFork()
    await started()
    noteTurnStart()
    release()
    const out = await pending
    expect(out.stale).toBe(true)
    expect(root.session.session()).toBe(before)
  })

  it('keeps the live session when the user switches session meanwhile', async () => {
    const root = getTuiRoot()
    gate.release = undefined
    const pending = root.sessionFork()
    await started()
    root.pointToSession('tui-other')
    release()
    const out = await pending
    expect(out.stale).toBe(true)
    expect(root.session.session()).toBe('tui-other')
  })

  it('adopts the copy when nothing changed', async () => {
    const root = getTuiRoot()
    gate.release = undefined
    const pending = root.sessionFork()
    await started()
    release()
    const out = await pending
    expect(out.copied).toBe(true)
    expect(root.session.session()).toBe(out.newId)
  })
})
