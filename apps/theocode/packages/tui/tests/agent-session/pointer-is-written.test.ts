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

import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs'
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

import { createTuiSession } from '../../src/agent-session/tui-session.js'

const made: string[] = []
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true })
})

function pointerPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'session-pointer-'))
  made.push(dir)
  return join(dir, 'tui-session')
}

describe('the session pointer', () => {
  it('is written by a launch that does NOT resume, so --continue has something to find', async () => {
    const pointer = pointerPath()
    const s = createTuiSession({ cwd: '/tmp', sessionPointer: pointer, resume: false })
    await pointerSettles(pointer)
    expect(existsSync(pointer), 'nothing wrote the pointer').toBe(true)
    expect(readFileSync(pointer, 'utf8').trim()).toBe(s.session())
  })

  it('is not READ by that launch — the id is fresh even when a pointer already exists', async () => {
    const pointer = pointerPath()
    const first = createTuiSession({ cwd: '/tmp', sessionPointer: pointer, resume: false }).session()
    await pointerSettles(pointer)
    const second = createTuiSession({ cwd: '/tmp', sessionPointer: pointer, resume: false }).session()
    await new Promise((r) => setTimeout(r, 60))
    expect(second).not.toBe(first)
    expect(readFileSync(pointer, 'utf8').trim()).toBe(second)
  })

  it('is read when resume IS requested, and the id comes back unchanged', async () => {
    const pointer = pointerPath()
    const first = createTuiSession({ cwd: '/tmp', sessionPointer: pointer, resume: false }).session()
    await pointerSettles(pointer)
    const resumed = createTuiSession({ cwd: '/tmp', sessionPointer: pointer, resume: true }).session()
    expect(resumed).toBe(first)
  })
})
