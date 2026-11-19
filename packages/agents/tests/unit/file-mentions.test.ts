import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  expandCommandTemplate,
  findFileMentions,
  resolveFileMentions,
} from '../../src/config-entry.js'

const files: Record<string, string> = { '/w/src/a.ts': 'AAA', '/w/b.md': 'BBB' }
const readFile = (p: string): string | undefined => files[p]

describe('file mentions', () => {
  it('a mention followed by a comma or a period is attached', () => {
    for (const text of ['look at @src/a.ts, please', 'is @src/a.ts.']) {
      const r = resolveFileMentions(text, { cwd: '/w', readFile })
      expect(r.attached).toEqual(['src/a.ts'])
      expect(r.message).toContain('--- src/a.ts ---\nAAA')
    }
  })

  it('expandCommandTemplate and resolveFileMentions find the same references', async () => {
    const table = [
      'look at @src/a.ts, please',
      'is @src/a.ts.',
      'mail me@example.com and @b.md',
      '!`echo @hidden` then @b.md',
      '@a @b',
      'no mentions',
    ]
    for (const input of table) {
      const seen: string[] = []
      await expandCommandTemplate(input, '', {
        shell: () => Promise.resolve({ text: '', ok: true }),
        readFile: (n) => {
          seen.push(n)
          return ''
        },
        warn: () => undefined,
      })
      expect(findFileMentions(input).map((m) => m.ref)).toEqual(seen)
    }
  })

  it('a mention outside cwd is skipped with reason outside-root', () => {
    const text = 'see @../etc/x'
    const r = resolveFileMentions(text, { cwd: '/w', readFile })
    expect(r.skipped).toEqual([{ ref: '../etc/x', reason: 'outside-root' }])
    expect(r.message).toBe(text)
  })

  it('a symlink out of cwd is skipped with reason outside-root', () => {
    const root = mkdtempSync(join(tmpdir(), 'fm-'))
    const cwd = join(root, 'cwd')
    mkdirSync(cwd)
    writeFileSync(join(root, 'secret.txt'), 'x')
    symlinkSync(join(root, 'secret.txt'), join(cwd, 'link.txt'))
    const r = resolveFileMentions('@link.txt', { cwd })
    expect(r.skipped).toEqual([{ ref: 'link.txt', reason: 'outside-root' }])
  })

  it('a home mention is skipped unless allowHome is set', () => {
    const read = (p: string): string => `read ${p}`
    const off = resolveFileMentions('@~/notes.md', { cwd: '/w', readFile: read })
    expect(off.skipped).toEqual([{ ref: '~/notes.md', reason: 'outside-root' }])
    const on = resolveFileMentions('@~/notes.md', { cwd: '/w', allowHome: true, readFile: read })
    expect(on.attached).toEqual(['~/notes.md'])
  })

  it('forbidden and missing files are skipped with their reasons', () => {
    const r = resolveFileMentions('@.env @nope.md', {
      cwd: '/w',
      readFile: (p) => {
        if (p.endsWith('nope.md')) throw Object.assign(new Error('x'), { code: 'ENOENT' })
        return undefined
      },
    })
    expect(r.skipped).toEqual([
      { ref: '.env', reason: 'forbidden' },
      { ref: 'nope.md', reason: 'not-found' },
    ])
  })

  it('a forbidden path is judged after ~/ and .. are resolved', () => {
    const r = resolveFileMentions('@~/.ssh/config @dir/../.env', {
      cwd: '/w',
      allowHome: true,
      readFile: () => 'secret',
    })
    expect(r.attached).toEqual([])
    expect(r.skipped).toEqual([
      { ref: '~/.ssh/config', reason: 'forbidden' },
      { ref: 'dir/../.env', reason: 'forbidden' },
    ])
  })

  it.each(['EACCES', 'EISDIR', 'ENOTDIR', 'EPERM'])('a %s read error is rethrown', (code) => {
    expect(() =>
      resolveFileMentions('@a.md', {
        cwd: '/w',
        readFile: () => {
          throw Object.assign(new Error(code), { code })
        },
      }),
    ).toThrow(code)
  })

  it('an unexpected read error is rethrown', () => {
    expect(() =>
      resolveFileMentions('@a.md', {
        cwd: '/w',
        readFile: () => {
          throw new Error('boom')
        },
      }),
    ).toThrow('boom')
  })

  it('a truncated file stays within the per-file cap and fits a total equal to it', () => {
    const r = resolveFileMentions('@b.md', {
      cwd: '/w',
      readFile: () => 'y'.repeat(1000),
      perFileTokens: 5,
      totalTokens: 5,
    })
    expect(r.attached).toEqual(['b.md'])
    expect(r.skipped).toEqual([])
    const body = r.message.split('--- b.md ---\n')[1] ?? ''
    expect(Math.ceil(body.length / 4)).toBeLessThanOrEqual(5)
  })

  it('the total budget skips the overflow with reason budget', () => {
    const r = resolveFileMentions('@src/a.ts @b.md', {
      cwd: '/w',
      readFile: () => 'x'.repeat(40),
      totalTokens: 15,
    })
    expect(r.attached).toEqual(['src/a.ts'])
    expect(r.skipped).toEqual([{ ref: 'b.md', reason: 'budget' }])
    expect(r.message).toContain('attachment budget reached')
  })

  it('a file over the per-file cap is truncated, and a repeated mention attaches once', () => {
    const r = resolveFileMentions('@b.md @b.md', {
      cwd: '/w',
      readFile: () => 'y'.repeat(100),
      perFileTokens: 5,
    })
    expect(r.attached).toEqual(['b.md'])
    expect(r.message).toContain('…(truncated)')
  })
})
