import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { resolveConfig } from '../../src/config/config.js'
import { readManagedSettings } from '../../src/config/managed-settings.js'
import { settingsReport } from '../../src/config/settings-load.js'

/** #1908 — a Claude Code managed file is read as a foreign-root settings file. */
function managedFile(content: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'managed-')), 'managed-settings.json')
  writeFileSync(path, content)
  return path
}
const opts = (managedPaths: string[], onWarn?: (m: string) => void) => ({
  projectDir: tmpdir(),
  userDir: mkdtempSync(join(tmpdir(), 'home-')),
  managedPaths,
  ...(onWarn ? { onWarn } : {}),
})

describe('a Claude Code managed-settings.json', () => {
  const doc = { permissions: { deny: ['Bash(curl:*)'] }, model: 'm/x' }

  it('does not stop startup, and its model applies', () => {
    expect(resolveConfig({ managed: doc }).model).toBe('m/x')
  })

  it('its deny rule reaches the permission rules', () => {
    const report = settingsReport(opts([managedFile(JSON.stringify(doc))]))
    expect(report[0]?.permissionRules.some((r) => r.action === 'deny')).toBe(true)
  })

  it('reports an unknown key and does not throw', () => {
    const path = managedFile(JSON.stringify({ model: 'm/x', bogusKey: 1 }))
    expect(resolveConfig({ managed: { model: 'm/x', bogusKey: 1 } }).model).toBe('m/x')
    expect(settingsReport(opts([path]))[0]?.unrecognised).toContain('bogusKey')
  })

  it('warns, naming the path, when the file is not JSON', () => {
    const path = managedFile('not json')
    const warnings: string[] = []
    expect(readManagedSettings({ paths: [path], onWarn: (m) => warnings.push(m) })).toBeNull()
    expect(warnings[0]).toContain(path)
  })

  it('lists the managed file, with its path, in the settings report', () => {
    const path = managedFile(JSON.stringify({ disableAllHooks: true, model: 'm/x' }))
    const first = settingsReport(opts([path]))[0]
    expect(first?.path).toBe(path)
  })
})
