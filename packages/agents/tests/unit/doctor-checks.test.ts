import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'
import { checks, credentialState, diagnose } from '../../src/doctor/index.js'

describe('doctor checks', () => {
  it('credential rows: present ok, expired warn, absent and unreadable fail', () => {
    expect(checks.credential('present').status).toBe('ok')
    expect(checks.credential('expired').status).toBe('warn')
    expect(checks.credential('unreadable').status).toBe('fail')
    const absent = checks.credential('absent', { remedy: 'run app login' })
    expect(absent.status).toBe('fail')
    expect(absent.detail).toContain('run app login')
  })

  it('capability row warns when suppressed by trust and names the active entries when there are some', () => {
    expect(
      checks.capability('mcp', { active: ['a', 'b'], suppressedByTrust: false }),
    ).toMatchObject({ status: 'ok', detail: 'a, b' })
    expect(checks.capability('mcp', { active: [], suppressedByTrust: false }).detail).toBe('none')
    const none = checks.capability('mcp', { active: [], suppressedByTrust: true })
    const some = checks.capability('mcp', { active: ['mine'], suppressedByTrust: true })
    expect(none.status).toBe('warn')
    expect(some.status).toBe('warn')
    expect(some.detail).toContain('mine')
    expect(some.detail).not.toBe(none.detail)
  })

  it('settingsReport returns no row for clean reports and one warn row naming each file otherwise', () => {
    const clean = { path: '/c', ignored: [], unrecognised: [], droppedHooks: [] }
    expect(checks.settingsReport([clean])).toEqual([])
    const rows = checks.settingsReport([
      clean,
      { path: '/a.json', ignored: ['x'], unrecognised: ['y'], droppedHooks: ['h'] },
      {
        path: '/b.json',
        ignored: [],
        unrecognised: [],
        droppedHooks: [],
        unsupportedPermissions: ['p'],
      },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('warn')
    expect(rows[0]!.detail).toContain('/a.json')
    expect(rows[0]!.detail).toContain('/b.json')
    expect(rows[0]!.detail).not.toContain('/c')
  })

  it('leftovers returns no row for an empty list', () => {
    expect(checks.leftovers('stray', [])).toEqual([])
    const rows = checks.leftovers('stray', ['/old'], 'delete it')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.detail).toContain('/old')
    expect(rows[0]!.detail).toContain('delete it')
  })

  it('diagnose over these rows exits 0 with only warnings', () => {
    const d = diagnose([
      checks.credential('expired'),
      checks.capability('hooks', { active: [], suppressedByTrust: true }),
      ...checks.leftovers('stray', ['/old']),
    ])
    expect(d.exitCode).toBe(0)
    expect(d.failed).toBe(0)
  })
})

describe('skillsInventory', () => {
  it('reports a skill on disk and not declared, and one declared and absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'skills-'))
    for (const n of ['alpha', 'stray']) {
      mkdirSync(join(root, n))
      writeFileSync(join(root, n, 'SKILL.md'), '# s')
    }
    const row = checks.skillsInventory({
      declared: ['alpha', 'gone'],
      roots: [root, join(root, 'nope')],
    })
    expect(row.status).toBe('warn')
    expect(row.detail).toContain('on disk, not declared: stray')
    expect(row.detail).toContain('declared, not on disk: gone')
    expect(row.undeclared).toEqual(['stray'])
    expect(row.missing).toEqual(['gone'])
    expect(checks.skillsInventory({ declared: ['alpha', 'stray'], roots: [root] }).status).toBe(
      'ok',
    )
  })

  it('returns the names themselves, even when they hold punctuation', () => {
    const root = mkdtempSync(join(tmpdir(), 'skills-'))
    for (const n of ['a, b', 'x; y: z']) {
      mkdirSync(join(root, n))
      writeFileSync(join(root, n, 'SKILL.md'), '# s')
    }
    const row = checks.skillsInventory({ declared: ['gone; one', 'q, r'], roots: [root] })
    expect(row.undeclared).toEqual(['a, b', 'x; y: z'])
    expect(row.missing).toEqual(['gone; one', 'q, r'])
    const clean = checks.skillsInventory({ declared: ['a, b', 'x; y: z'], roots: [root] })
    expect(clean.status).toBe('ok')
    expect(clean.undeclared).toEqual([])
    expect(clean.missing).toEqual([])
  })
})

describe('credentialState', () => {
  const NOW = 1_700_000_000_000
  const file = (contents: string): string => {
    const dir = mkdtempSync(join(tmpdir(), 'agents-cred-'))
    const path = join(dir, 'auth.json')
    writeFileSync(path, contents)
    return path
  }

  it('absent, unreadable, present and expired', () => {
    expect(credentialState(join(tmpdir(), 'agents-cred-none', 'auth.json'))).toBe('absent')
    expect(credentialState(file('{ nope'))).toBe('unreadable')
    expect(credentialState(file('{"x":1}'))).toBe('unreadable')
    expect(credentialState(file('{"provider":"p"}'), { now: NOW })).toBe('present')
    expect(credentialState(file('{"provider":"p","expires":"soon"}'), { now: NOW })).toBe('present')
    expect(credentialState(file(`{"provider":"p","expires":${NOW + 1}}`), { now: NOW })).toBe(
      'present',
    )
    expect(credentialState(file(`{"provider":"p","expires":${NOW}}`), { now: NOW })).toBe('expired')
  })

  it('the environment wins over an absent or expired file', () => {
    const fromEnvironment = (): boolean => true
    expect(credentialState('/nonexistent/auth.json', { fromEnvironment })).toBe('present')
    expect(
      credentialState(file(`{"provider":"p","expires":1}`), { now: NOW, fromEnvironment }),
    ).toBe('present')
    expect(credentialState('/nonexistent/auth.json', { fromEnvironment: () => false })).toBe(
      'absent',
    )
  })
})
