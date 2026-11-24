import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { turnDiff } from '../../src/presets-entry.js'

describe('turnDiff', () => {
  let dir: string
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- test fixture uses the system git
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'turn-diff-'))
    git('init', '-q')
    git('config', 'user.email', 't@t')
    git('config', 'user.name', 't')
    writeFileSync(join(dir, 'tracked.txt'), 'one\n')
    writeFileSync(join(dir, 'other.txt'), 'other\n')
    git('add', '.')
    git('commit', '-q', '-m', 'init')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('shows a modified tracked file and a new file, and leaves the index alone', () => {
    writeFileSync(join(dir, 'tracked.txt'), 'two\n')
    writeFileSync(join(dir, 'other.txt'), 'untouched by the turn\n')
    mkdirSync(join(dir, 'sub dir'))
    writeFileSync(join(dir, 'sub dir', 'new file.txt'), 'fresh\n')
    const out = turnDiff(['tracked.txt', 'sub dir/new file.txt'], { cwd: dir })
    expect(out).toContain('+two')
    expect(out).toContain('+fresh')
    expect(out).not.toContain('untouched by the turn')
    expect(git('diff', '--cached', '--name-only').toString()).toBe('')
    expect(git('diff', '--cached').toString()).toBe('')
  })

  it('returns undefined when nothing changed or no paths were given', () => {
    expect(turnDiff(['tracked.txt'], { cwd: dir })).toBeUndefined()
    expect(turnDiff([], { cwd: dir })).toBeUndefined()
  })

  it('reports a git failure instead of throwing or going silent', () => {
    const run = vi.fn(() => ({ ok: false, stdout: 'not a git repository' }))
    expect(turnDiff(['a.ts'], { cwd: dir, run })).toContain('could not be shown')
  })
})
