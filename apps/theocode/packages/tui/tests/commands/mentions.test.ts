import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { resolveMentions } from '../../src/commands/mentions.js'

const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

function project(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'mentions-'))
  made.push(cwd)
  mkdirSync(join(cwd, 'src'))
  writeFileSync(join(cwd, 'src/a.ts'), 'export const a = 1\n')
  return cwd
}

describe('resolveMentions', () => {
  it.each(['look at @src/a.ts', 'look at @src/a.ts, please', 'is @src/a.ts.'])(
    'attaches src/a.ts for %s',
    (text) => {
      expect(resolveMentions(text, project()).attached).toEqual(['src/a.ts'])
    },
  )

  it('reports a missing file with a reason', () => {
    const r = resolveMentions('see @missing.ts', project())
    expect(r.attached).toEqual([])
    expect(r.skipped).toEqual([{ ref: '@missing.ts', reason: 'file not found' }])
  })

  it('reports unsafe paths with a reason', () => {
    const r = resolveMentions('see @../outside.ts', project())
    expect(r.skipped).toHaveLength(1)
    expect(r.skipped[0]?.reason.length).toBeGreaterThan(0)
  })

  it('accepts a ~/ path the @ menu offers', () => {
    const home = mkdtempSync(join(tmpdir(), 'home-'))
    made.push(home)
    writeFileSync(join(home, 'note-1900.txt'), 'hi')
    const prev = process.env.HOME
    process.env.HOME = home
    try {
      const r = resolveMentions('see @~/note-1900.txt.', project())
      expect(r.attached).toEqual(['~/note-1900.txt'])
    } finally {
      process.env.HOME = prev
    }
  })

  it('refuses secret-like paths under ~/ with a reason', () => {
    const home = mkdtempSync(join(tmpdir(), 'home-'))
    made.push(home)
    mkdirSync(join(home, '.ssh'))
    writeFileSync(join(home, '.ssh/id_rsa'), 'SECRET')
    const prev = process.env.HOME
    process.env.HOME = home
    try {
      const r = resolveMentions('see @~/.ssh/id_rsa', project())
      expect(r.attached).toEqual([])
      expect(r.message).not.toContain('SECRET')
      expect(r.skipped[0]?.reason.length).toBeGreaterThan(0)
    } finally {
      process.env.HOME = prev
    }
  })

  it('refuses a forbidden project path with a reason', () => {
    const cwd = project()
    writeFileSync(join(cwd, '.env'), 'K=1')
    const r = resolveMentions('see @.env', cwd)
    expect(r.attached).toEqual([])
    expect(r.skipped).toEqual([{ ref: '@.env', reason: 'forbidden path' }])
  })
})
