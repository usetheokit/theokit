import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { scaffold } from '../../src/index.js'

/**
 * The root context file, and the two-file split it belongs to.
 *
 * `THEO.md` cannot live at the root: the SDK registers it as `.theokit/THEO.md` with `cwd-only`
 * scope, so a copy at the root is read by nothing. `AGENTS.md` is the file that IS read from there
 * — `git-root-walk`, the same scope as `CLAUDE.md`, discovered from any subdirectory.
 *
 * Until now the scaffold only ever DELETED `AGENTS.md`, and the template shipped none, so the
 * prompt "Would you like to include AGENTS.md?" changed nothing whichever way it was answered —
 * the same defect as the `--src-dir` question, which was removed for it.
 */
let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'theokit-rootctx-'))
  scaffold(dir, 'rootctx-probe')
}, 30_000)

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('the root context file', () => {
  it('ships AGENTS.md at the root, with the project name substituted', () => {
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf-8')
    expect(agents.startsWith('# rootctx-probe')).toBe(true)
    // The `.tmpl` is consumed, not left behind next to its output.
    expect(existsSync(join(dir, 'AGENTS.md.tmpl'))).toBe(false)
    expect(agents).not.toContain('{{name}}')
  })

  it('keeps THEO.md at the only path the SDK reads it from', () => {
    expect(existsSync(join(dir, '.theokit/THEO.md'))).toBe(true)
    // A root copy would be read by nothing, so shipping one would teach the wrong location.
    expect(existsSync(join(dir, 'THEO.md'))).toBe(false)
  })

  it('each file says what it is for, and points at the other', () => {
    // The two are easy to confuse — same shape, same purpose at a glance. What separates them is
    // audience, and a reader who cannot tell will put product facts where only coding agents look.
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf-8')
    const theo = readFileSync(join(dir, '.theokit/THEO.md'), 'utf-8')

    expect(agents).toContain('.theokit/THEO.md')
    expect(theo).toContain('AGENTS.md')
  })

  it('THEO.md warns that a preference here defeats personalities', () => {
    // Priority 60 beats every other file source, so a tone instruction in THEO.md silently makes
    // `usePersonality` do nothing — a failure with no error, which is the kind worth a warning.
    const theo = readFileSync(join(dir, '.theokit/THEO.md'), 'utf-8')
    expect(theo).toContain('personalit')
    expect(theo.toLowerCase()).toContain('facts')
  })
})
