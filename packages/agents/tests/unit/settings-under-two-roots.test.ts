import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  firstSettingsFile,
  readManagedSettings,
  readSettingsFile,
  SettingsFileError,
  settingsCandidates,
  translateSettingsDocument,
} from '../../src/config-entry.js'

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

  it('several own roots come in order, before the foreign root', () => {
    const c = settingsCandidates({ cwd: '/p', home: '/h', ownRoot: ['.a', '.b'] })
    expect(c.project.map((x) => [x.path, x.foreignRoot])).toEqual([
      ['/p/.a/settings.json', false],
      ['/p/.b/settings.json', false],
      ['/p/.claude/settings.json', true],
    ])
  })

  it('throwOnMalformed throws instead of warning', () => {
    const cwd = setup({ '.myapp/settings.json': '{nope' })
    const c = cands(cwd).project[0]!
    expect(readSettingsFile(c, opts)).toBeUndefined()
    expect(() => readSettingsFile(c, { ...opts, throwOnMalformed: true })).toThrow(/malformed JSON/)
  })

  it('throwOnMalformed throws a SettingsFileError carrying the path', () => {
    const cwd = setup({ '.myapp/settings.json': '{nope' })
    const c = cands(cwd).project[0]!
    try {
      readSettingsFile(c, { ...opts, throwOnMalformed: true })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(SettingsFileError)
      expect((error as SettingsFileError).path).toBe(c.path)
      expect((error as SettingsFileError).kind).toBe('malformed')
    }
  })

  it('a permissions list with a non-string entry is dropped whole', () => {
    const cwd = setup({
      '.myapp/settings.json': '{"permissions":{"allow":[1,"Read"],"deny":["Bash"]}}',
    })
    const read = readSettingsFile(cands(cwd).project[0]!, opts)
    expect(read?.permissionRules.map((r) => r.action)).toEqual(['deny'])
  })

  it('translateSettingsDocument splits an in-memory document like a file', () => {
    const read = translateSettingsDocument(
      { model: 'm', sandbox: {}, odd: 1 },
      { path: 'x', foreignRoot: true },
      opts,
    )
    expect(read.ignored).toEqual(['sandbox'])
    expect(read.unrecognised).toEqual(['odd'])
  })

  it('a non-object permissions block is treated as absent', () => {
    const cwd = setup({ '.myapp/settings.json': '{"permissions":"all"}' })
    expect(readSettingsFile(cands(cwd).project[0]!, opts)?.permissionRules).toEqual([])
  })

  it('readManagedSettings reads the first existing path for the caller keys', () => {
    const cwd = setup({
      'a/managed-settings.json': '{"model":"m","other":1}',
      'b/managed-settings.json': '{"model":"later"}',
    })
    const r = readManagedSettings({
      paths: [
        join(cwd, 'missing.json'),
        join(cwd, 'a/managed-settings.json'),
        join(cwd, 'b/managed-settings.json'),
      ],
      ownKeys: ['model'],
    })
    expect(r?.values).toEqual({ model: 'm' })
    expect(r?.unrecognised).toEqual(['other'])
  })

  it('readManagedSettings warns on a malformed file and stops', () => {
    const cwd = setup({ 'a/managed-settings.json': '{', 'b/managed-settings.json': '{}' })
    const warns: string[] = []
    const r = readManagedSettings({
      paths: [join(cwd, 'a/managed-settings.json'), join(cwd, 'b/managed-settings.json')],
      ownKeys: [],
      onWarn: (m) => warns.push(m),
    })
    expect(r).toBeUndefined()
    expect(warns).toHaveLength(1)
  })
})
