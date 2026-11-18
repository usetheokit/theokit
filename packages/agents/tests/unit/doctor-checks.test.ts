import { describe, expect, it } from 'vitest'
import { checks, diagnose } from '../../src/doctor/index.js'

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
    expect(checks.capability('mcp', { active: ['a', 'b'], suppressedByTrust: false })).toMatchObject({ status: 'ok', detail: 'a, b' })
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
      { path: '/b.json', ignored: [], unrecognised: [], droppedHooks: [], unsupportedPermissions: ['p'] },
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
