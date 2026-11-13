import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { tempRoot } from '../helpers/temp-root.js'

import { orderedPermissionRules } from '../../src/composition/agent-spec.js'
import { resolveConfig } from '../../src/config/config.js'
import { readManagedSettingsTranslated } from '../../src/config/managed-settings.js'
import { settingsReport } from '../../src/config/settings-load.js'

/** #1908 — a Claude Code managed-settings.json is read like a foreign-root settings file. */
function managedFile(content: string): { dir: string; path: string } {
  const dir = tempRoot('managed-')
  const path = join(dir, 'managed-settings.json')
  writeFileSync(path, content)
  return { dir, path }
}

describe('a Claude Code managed-settings.json', () => {
  it('applies our keys and carries the permissions deny rule', () => {
    const doc = { permissions: { deny: ['Bash(curl:*)'] }, model: 'm/x' }
    expect(resolveConfig({ managed: doc }).model).toBe('m/x')

    const { dir, path } = managedFile(JSON.stringify(doc))
    const rules = orderedPermissionRules(dir, dir, [path])
    expect(rules.some((r) => r.action === 'deny')).toBe(true)
  })

  it('reports an unknown key and does not throw', () => {
    const { dir, path } = managedFile(JSON.stringify({ model: 'm/x', someFutureKey: 1 }))
    expect(resolveConfig({ managed: { model: 'm/x', someFutureKey: 1 } }).model).toBe('m/x')
    const report = settingsReport({ projectDir: dir, userDir: dir, managedPaths: [path] })
    expect(report.find((r) => r.path === path)?.unrecognised).toContain('someFutureKey')
  })

  it('warns, naming the path, when the file is not JSON', () => {
    const { path } = managedFile('{not json')
    const warnings: string[] = []
    expect(
      readManagedSettingsTranslated({ paths: [path], onWarn: (m) => warnings.push(m) }),
    ).toBeNull()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(path)
  })
})
