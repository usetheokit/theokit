import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { firstSettingsFile, readSettingsFile, settingsCandidates } from '../../src/config-entry.js'

function setup(files: Record<string, string>): string {
  const cwd = mkdtempSync(join(tmpdir(), 'two-roots-'))
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(cwd, rel, '..'), { recursive: true })
    writeFileSync(join(cwd, rel), body)
  }
  return cwd
}
const opts = { ownKeys: ['model'] }
const cands = (cwd: string) => settingsCandidates({ cwd, home: join(cwd, 'h'), ownRoot: '.myapp' })

describe('settings under two roots', () => {
  it('the own root wins over the foreign root in the same scope', () => {
    const cwd = setup({
      '.myapp/settings.json': '{"model":"own"}',
      '.claude/settings.json': '{"model":"foreign"}',
    })
    expect(firstSettingsFile(cands(cwd).project, opts)?.values.model).toBe('own')
    expect(cands(cwd).project.map((c) => c.foreignRoot)).toEqual([false, true])
  })

  it('an unknown key in an own-root file stays in values', () => {
    const cwd = setup({ '.myapp/settings.json': '{"bogus":1}' })
    const r = firstSettingsFile(cands(cwd).project, opts)
    expect(r?.values).toEqual({ bogus: 1 })
    expect(r?.unrecognised).toEqual([])
  })

  it('an unknown key in a foreign-root file is listed in unrecognised and not in values', () => {
    const cwd = setup({ '.claude/settings.json': '{"bogus":1}' })
    const r = firstSettingsFile(cands(cwd).project, opts)
    expect(r?.unrecognised).toEqual(['bogus'])
    expect(r?.values).toEqual({})
  })

  it('a known Claude Code key that is not an own key is listed in ignored', () => {
    const body = '{"model":"m","statusLine":{},"$schema":"x","_note":"n"}'
    const cwd = setup({ '.myapp/settings.json': body, '.claude/settings.json': body })
    for (const c of cands(cwd).project) {
      const r = readSettingsFile(c, opts)
      expect(r?.ignored).toEqual(['statusLine', '$schema', '_note'])
      expect(r?.values).toEqual({ model: 'm' })
    }
  })

  it('permissions becomes permissionRules and an unrenderable entry is in unsupportedPermissions', () => {
    const cwd = setup({
      '.claude/settings.json': '{"permissions":{"deny":["Bash(rm:*)"],"allow":["Bash(a b (c"]}}',
    })
    const r = firstSettingsFile(cands(cwd).project, opts)
    expect(r?.permissionRules.length).toBeGreaterThan(0)
    expect(r?.unsupportedPermissions.length).toBeGreaterThan(0)
    expect(r?.values).toEqual({})
  })

  it('renames maps outputStyle onto the caller’s key', () => {
    const cwd = setup({ '.claude/settings.json': '{"outputStyle":"terse"}' })
    const r = firstSettingsFile(cands(cwd).project, {
      ownKeys: ['style'],
      renames: { outputStyle: 'style' },
    })
    expect(r?.values).toEqual({ style: 'terse' })
  })

  it('a malformed file warns with its path and returns undefined', () => {
    const cwd = setup({ '.myapp/settings.json': '{nope' })
    const warns: string[] = []
    const c = cands(cwd).project[0]!
    expect(readSettingsFile(c, { ...opts, onWarn: (m) => warns.push(m) })).toBeUndefined()
    expect(warns[0]).toContain(c.path)
  })

  it('foreignRoot false reads only the own root; an absent file is undefined', () => {
    const cwd = setup({})
    const c = settingsCandidates({ cwd, home: cwd, ownRoot: '.myapp', foreignRoot: false })
    expect(c.user).toHaveLength(1)
    expect(firstSettingsFile(c.project, opts)).toBeUndefined()
  })
})
