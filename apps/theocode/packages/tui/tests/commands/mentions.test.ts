/** #1900 — trailing punctuation, reported skips, and `~/` paths from the `@` menu. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveMentions } from '../../src/commands/mentions.js'

function project(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'mentions-'))
  mkdirSync(join(cwd, 'src'))
  writeFileSync(join(cwd, 'src', 'a.ts'), 'export const a = 1\n')
  return cwd
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('resolveMentions', () => {
  it.each(['look at @src/a.ts', 'look at @src/a.ts, please', 'is @src/a.ts.', 'ok (@src/a.ts)?'])(
    'attaches src/a.ts for %s',
    (text) => {
      const r = resolveMentions(text, project())
      expect(r.attached).toEqual(['src/a.ts'])
      expect(r.skipped).toEqual([])
    },
  )

  it('reports a missing file with a reason', () => {
    const r = resolveMentions('see @missing.ts', project())
    expect(r.attached).toEqual([])
    expect(r.skipped).toEqual([{ ref: 'missing.ts', reason: 'file not found' }])
  })

  it('reports a forbidden path with a reason', () => {
    const r = resolveMentions('see @.env', project())
    expect(r.skipped).toHaveLength(1)
    expect(r.skipped[0]?.reason).toBe('forbidden path')
  })

  it('accepts a ~/ path the @ menu offers', () => {
    const home = project()
    vi.stubEnv('HOME', home)
    vi.stubEnv('USERPROFILE', home)
    const r = resolveMentions('see @~/src/a.ts', project())
    expect(r.attached).toEqual(['~/src/a.ts'])
    expect(r.skipped).toEqual([])
  })
})
