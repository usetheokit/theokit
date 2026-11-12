import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { resolveConfig } from '../../src/config/config.js'
import { readManagedSettingsFile } from '../../src/config/managed-settings.js'
import { settingsReport } from '../../src/config/settings-load.js'

function managedFile(content: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'managed-')), 'managed-settings.json')
  writeFileSync(path, content)
  return path
}

describe('a Claude Code managed-settings.json (#1908)', () => {
  it('applies our keys and reaches the deny rule instead of throwing', () => {
    const doc = { permissions: { deny: ['Bash(curl:*)'] }, model: 'm/x' }
    expect(resolveConfig({ managed: doc }).model).toBe('m/x')

    const path = managedFile(JSON.stringify(doc))
    const reports = settingsReport({ projectDir: tmpdir(), userDir: tmpdir(), managedPaths: [path] })
    const managed = reports.find((r) => r.path === path)
    expect(managed?.permissionRules.some((r) => r.action === 'deny')).toBe(true)
  })

  it('reports an unknown key without throwing', () => {
    const notices: string[] = []
    const resolved = resolveConfig({
      managed: { model: 'm/x', someFutureKey: 1, disableAllHooks: true },
      onManagedNotice: (m) => notices.push(m),
    })
    expect(resolved.model).toBe('m/x')
    expect(notices.join('\n')).toContain('someFutureKey')
  })

  it('warns with the path when the file is not JSON', () => {
    const path = managedFile('{ not json')
    const warnings: string[] = []
    expect(readManagedSettingsFile({ paths: [path], onWarn: (m) => warnings.push(m) })).toBeNull()
    expect(warnings[0]).toContain(path)
  })

  it('lists the managed file in the settings report', () => {
    const path = managedFile(JSON.stringify({ model: 'm/x', someFutureKey: 1 }))
    const reports = settingsReport({ projectDir: tmpdir(), userDir: tmpdir(), managedPaths: [path] })
    const managed = reports.find((r) => r.path === path)
    expect(managed?.unrecognised).toContain('someFutureKey')
  })
})
