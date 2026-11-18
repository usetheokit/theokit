import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { expandCommandTemplate } from '../../src/config/command-template.js'
import { findFileMentions, resolveFileMentions } from '../../src/config-entry.js'

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'mentions-'))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1\n')
  return root
}

describe('file mentions', () => {
  it('a mention followed by a comma or a period is attached', () => {
    const cwd = project()
    for (const text of ['look at @src/a.ts, please', 'is @src/a.ts.', 'look at @src/a.ts']) {
      const r = resolveFileMentions(text, { cwd })
      expect(r.attached).toEqual(['src/a.ts'])
      expect(r.skipped).toEqual([])
      expect(r.message).toContain('export const a = 1')
    }
  })

  it('expandCommandTemplate and resolveFileMentions find the same references', async () => {
    const inputs = [
      'look at @src/a.ts, please',
      'is @src/a.ts.',
      'mail me@example.com and @b.md',
      '!`grep @foo` then @c.md',
      '@a @b @a',
      'no refs here',
    ]
    for (const input of inputs) {
      const seen: string[] = []
      await expandCommandTemplate(input, '', {
        shell: () => Promise.resolve({ text: '', ok: true }),
        readFile: (name) => {
          seen.push(name)
          return ''
        },
        warn: () => {},
      })
      expect(findFileMentions(input).map((m) => m.ref)).toEqual(seen)
    }
  })

  it('a mention outside cwd is skipped with reason outside-root', () => {
    const cwd = project()
    const text = 'see @../secret.txt'
    const r = resolveFileMentions(text, { cwd })
    expect(r.skipped).toEqual([{ ref: '../secret.txt', reason: 'outside-root' }])
    expect(r.message).toBe(text)
  })

  it('a symlink out of cwd is skipped with reason outside-root', () => {
    const cwd = project()
    const other = mkdtempSync(join(tmpdir(), 'other-'))
    writeFileSync(join(other, 'x.txt'), 'x')
    symlinkSync(other, join(cwd, 'link'))
    const r = resolveFileMentions('@link/x.txt', { cwd })
    expect(r.skipped[0]?.reason).toBe('outside-root')
  })

  it('a home mention is skipped unless allowHome is set', () => {
    const cwd = project()
    const readFile = () => 'home content'
    const off = resolveFileMentions('@~/notes.md', { cwd, readFile })
    expect(off.attached).toEqual([])
    expect(off.skipped).toEqual([{ ref: '~/notes.md', reason: 'outside-root' }])
    const on = resolveFileMentions('@~/notes.md', { cwd, allowHome: true, readFile })
    expect(on.attached).toEqual(['~/notes.md'])
  })

  it('a missing file and a forbidden path are reported', () => {
    const cwd = project()
    const r = resolveFileMentions('@nope.ts @.env', { cwd, readFile: () => undefined })
    expect(r.skipped.map((s) => s.ref)).toEqual(['nope.ts', '.env'])
    expect(r.skipped[0]?.reason).toBe('not-found')
  })

  it('a forbidden name hidden by .. or ~ or a symlink is skipped as forbidden', () => {
    const cwd = project()
    mkdirSync(join(cwd, 'sub'))
    writeFileSync(join(cwd, '.env'), 'SECRET=1')
    symlinkSync(join(cwd, '.env'), join(cwd, 'innocent.txt'))
    const readFile = () => 'content'
    const r = resolveFileMentions('@sub/../.env @~/.ssh/config @innocent.txt', {
      cwd,
      allowHome: true,
      readFile,
    })
    expect(r.attached).toEqual([])
    expect(r.skipped).toEqual([
      { ref: 'sub/../.env', reason: 'forbidden' },
      { ref: '~/.ssh/config', reason: 'forbidden' },
      { ref: 'innocent.txt', reason: 'forbidden' },
    ])
  })

  it('rethrows an empty cwd and non-ENOENT read errors', () => {
    expect(() => resolveFileMentions('@a.ts', { cwd: '' })).toThrow()
    const cwd = project()
    for (const code of ['EACCES', 'EISDIR', 'ENOTDIR']) {
      expect(() =>
        resolveFileMentions('@src/a.ts', {
          cwd,
          readFile: () => {
            throw Object.assign(new Error(code), { code })
          },
        }),
      ).toThrow(code)
    }
  })

  it('rethrows an unexpected read error', () => {
    const cwd = project()
    expect(() =>
      resolveFileMentions('@src/a.ts', {
        cwd,
        readFile: () => {
          throw new Error('boom')
        },
      }),
    ).toThrow('boom')
  })

  it('truncates a long file to the per-file cap', () => {
    const cwd = project()
    const r = resolveFileMentions('@src/a.ts', {
      cwd,
      perFileTokens: 2,
      readFile: () => 'x'.repeat(100),
    })
    expect(r.message).toContain('xxxxxxxx\n…(truncated)')
    expect(r.message).not.toContain('x'.repeat(9))
  })

  it('the total budget skips the overflow with reason budget', () => {
    const cwd = project()
    writeFileSync(join(cwd, 'b.ts'), 'b')
    const r = resolveFileMentions('@src/a.ts @b.ts', {
      cwd,
      totalTokens: 10,
      readFile: () => 'y'.repeat(32),
    })
    expect(r.attached).toEqual(['src/a.ts'])
    expect(r.skipped).toEqual([{ ref: 'b.ts', reason: 'budget' }])
    expect(r.message).toContain('attachment budget reached')
  })
})
