// A launch that does not resume must still leave a pointer for a launch that does.
//
// `--continue` needs `.theokit/tui-session` to exist. Before resume became opt-in, the pointer was
// written as a side effect of `loadOrCreateSessionId`: the file was read, and when it was absent a
// fresh id was generated AND persisted. Making resume opt-in bypassed that function entirely on the
// default path, so nothing wrote the pointer any more and `--continue` had nothing to find.
//
// Measured 2026-09-15 in a clean workspace: after a full session — a turn, a delegation, a custom
// command — `.theokit/tui-session` did not exist. The only surviving writer was `/new`, which means
// `--continue` worked solely for someone who had first typed `/new`.
//
// The two questions stay separate, which is the whole point of the opt-in: READING the pointer is
// what makes this launch inherit a conversation; WRITING it is what makes the next launch able to.

import { mkdirSync, mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

/**
 * The write is fire-and-forget (`void persistSessionId(...)`), which is how the pre-existing
 * `loadOrCreateSessionId` already did it. The test waits for the file rather than forcing the
 * production path to become synchronous — it measures the behaviour, it does not dictate it.
 */
async function pointerSettles(file: string): Promise<void> {
  for (let i = 0; i < 50 && !existsSync(file); i += 1) {
    await new Promise((r) => setTimeout(r, 10))
  }
}

/**
 * Waits for the pointer to hold a SPECIFIC id, which `pointerSettles` cannot do.
 *
 * That one waits for the file to exist, and on a second launch it already does — written by the
 * first. So the second case waited a flat 60ms instead, which is a guess about how long a write
 * takes on the machine running it. It held here and failed on CI: the assertion read the FIRST
 * session's id out of the file, which is what "not yet overwritten" looks like from the outside.
 *
 * Same shape as its sibling, same 500ms ceiling, and it returns the moment the write lands. The
 * assertion after it still fails if the id never arrives — waiting for the right thing removes the
 * flake without removing the check.
 */
async function pointerHolds(file: string, id: string): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (existsSync(file) && readFileSync(file, 'utf8').trim() === id) return
    await new Promise((r) => setTimeout(r, 10))
  }
}

import { sessionPointerPath } from '@theokit/agents/session'

import { createTuiSession } from '../../src/agent-session/tui-session.js'

const made: string[] = []
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true })
})

const CWD = '/tmp/pointer-is-written-project'

function newRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'session-pointer-'))
  made.push(dir)
  return dir
}

describe('the session pointer', () => {
  it('is written by a launch that does NOT resume, so --continue has something to find', async () => {
    const root = newRoot()
    const pointer = sessionPointerPath(CWD, root)
    const s = createTuiSession({ cwd: CWD, pointerRoot: root, resume: false })
    await pointerSettles(pointer)
    expect(existsSync(pointer), 'nothing wrote the pointer').toBe(true)
    expect(readFileSync(pointer, 'utf8')).toBe(`${s.session()}\n`)
  })

  it('is not READ by that launch — the id is fresh even when a pointer already exists', async () => {
    const root = newRoot()
    const pointer = sessionPointerPath(CWD, root)
    const first = createTuiSession({ cwd: CWD, pointerRoot: root, resume: false }).session()
    await pointerSettles(pointer)
    const second = createTuiSession({ cwd: CWD, pointerRoot: root, resume: false }).session()
    await pointerHolds(pointer, second)
    expect(second).not.toBe(first)
    expect(readFileSync(pointer, 'utf8').trim()).toBe(second)
  })

  it('is read when resume IS requested, and the id comes back unchanged', async () => {
    const root = newRoot()
    const pointer = sessionPointerPath(CWD, root)
    const first = createTuiSession({ cwd: CWD, pointerRoot: root, resume: false }).session()
    await pointerSettles(pointer)
    const resumed = createTuiSession({ cwd: CWD, pointerRoot: root, resume: true }).session()
    expect(resumed).toBe(first)
  })
})

describe('the legacy pointer', () => {
  it('is read once when the framework has none, and migrated', async () => {
    const root = newRoot()
    const cwd = newRoot()
    mkdirSync(join(cwd, '.theokit'))
    writeFileSync(join(cwd, '.theokit', 'tui-session'), 'tui-legacy')
    const s = createTuiSession({ cwd, pointerRoot: root, resume: true })
    expect(s.session()).toBe('tui-legacy')
    expect(s.resumed).toBe(true)
    const pointer = sessionPointerPath(cwd, root)
    await pointerHolds(pointer, 'tui-legacy')
    expect(readFileSync(pointer, 'utf8')).toBe('tui-legacy\n')
  })

  it('never overrides a framework pointer', async () => {
    const root = newRoot()
    const cwd = newRoot()
    mkdirSync(join(cwd, '.theokit'))
    writeFileSync(join(cwd, '.theokit', 'tui-session'), 'tui-legacy')
    const first = createTuiSession({ cwd, pointerRoot: root, resume: false }).session()
    await pointerHolds(sessionPointerPath(cwd, root), first)
    const s = createTuiSession({ cwd, pointerRoot: root, resume: true })
    expect(s.session()).toBe(first)
  })

  it('reports not resumed when nothing is stored', () => {
    const s = createTuiSession({ cwd: newRoot(), pointerRoot: newRoot(), resume: true })
    expect(s.resumed).toBe(false)
  })
})
