/**
 * `/init` must refuse when ANY instruction file already steers the repository.
 *
 * It checked `AGENTS.md` alone, which was right while that was the only name read. Once the loader
 * became a first-wins chain over THEO.md > AGENTS.md > CLAUDE.md, that guard let `/init` write an
 * `AGENTS.md` into a repository whose `CLAUDE.md` was steering it — and AGENTS.md wins, so the
 * operator's file keeps existing and silently stops being read.
 *
 * Nothing is overwritten, which is what makes it worse than an overwrite: `git status` shows a new
 * file, not a lost one, and the instructions that stopped applying are still on disk looking fine.
 *
 * A defect this change introduced, found by asking which other surfaces assumed the old name.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { setWorkingDirectory, resetWorkingDirectoryForTest } from '../../src/working-directory.js'
import { initAgents } from '../../src/commands/command-content.js'

const roots: string[] = []
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

function runInit(present: string | undefined): { sent: boolean; message: string } {
  const root = mkdtempSync(join(tmpdir(), 'theocode-init-'))
  roots.push(root)
  mkdirSync(join(root, '.git'), { recursive: true })
  if (present !== undefined) writeFileSync(join(root, present), '# steering')
  resetWorkingDirectoryForTest()
  setWorkingDirectory(root)

  let sent = false
  let message = ''
  initAgents(
    { send: () => { sent = true } } as never,
    { current: null },
    ((t: { message: string } | null) => { message = t?.message ?? '' }) as never,
  )
  return { sent, message }
}

describe('/init refuses when any instruction file is already steering', () => {
  it.each(['THEO.md', 'AGENTS.md', 'CLAUDE.md'])('test_it_refuses_when_%s_exists', (name) => {
    const { sent, message } = runInit(name)

    expect(sent, `/init wrote over a repository already steered by ${name}`).toBe(false)
    expect(message, 'the refusal did not name the file that caused it').toContain(name)
  })

  it('test_it_proceeds_when_nothing_is_steering', () => {
    // Anti-vacuity: a guard that refused unconditionally would satisfy every case above.
    const { sent } = runInit(undefined)

    expect(sent).toBe(true)
  })
})
