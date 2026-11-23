/** #1900 — trailing punctuation, reported skips, and `~/` paths from the `@` menu. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveMentions } from '../../src/commands/mentions.js'

const made: string[] = []

function project(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'mentions-'))
  made.push(cwd)
  mkdirSync(join(cwd, 'src'))
  writeFileSync(join(cwd, 'src', 'a.ts'), 'export const a = 1\n')
  return cwd
}

afterEach(() => {
  vi.unstubAllEnvs()
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true })
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

describe('resolveMentions — lenient grammar keeps the original text', () => {
  it('appends the attachment to the original text, punctuation intact', () => {
    const r = resolveMentions('ok (@src/a.ts)?', project())
    expect(r.message.startsWith('ok (@src/a.ts)?')).toBe(true)
    expect(r.message).toContain('export const a = 1')
  })

  it('accepts an @ glued to the preceding word', () => {
    const r = resolveMentions('see:@src/a.ts', project())
    expect(r.attached).toEqual(['src/a.ts'])
  })

  it('reports files past the total budget as skipped', () => {
    const cwd = project()
    const big = 'x'.repeat(7000)
    const names = Array.from({ length: 5 }, (_, n) => `big${n}.txt`)
    for (const n of names) writeFileSync(join(cwd, n), big)
    const r = resolveMentions(names.map((n) => `@${n}`).join(' '), cwd)
    expect(r.attached.length).toBeGreaterThan(0)
    expect(r.attached.length + r.skipped.length).toBe(5)
  })
})

describe('resolveMentions — an unreadable file is skipped, not thrown', () => {
  it('skips a mention that names a directory', () => {
    const r = resolveMentions('see @src', project())
    expect(r.attached).toEqual([])
    expect(r.skipped).toHaveLength(1)
  })
})
