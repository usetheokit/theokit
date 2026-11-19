/**
 * #2243 — TheoCode consumes `@theokit/agents` from the registry (`^16.11.0`), not through a
 * `workspace:*` link. This imports the #1867 login and refresh APIs through the published
 * `@theokit/agents/auth` entry point, as a standalone consumer would, and checks that the package
 * that resolved is the released one rather than a local source tree.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import * as auth from '@theokit/agents/auth'

function resolvedManifest(): { version: string } {
  let dir = dirname(fileURLToPath(import.meta.resolve('@theokit/agents/auth')))
  while (dir !== dirname(dir)) {
    try {
      const m = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
        name?: string
        version: string
      }
      if (m.name === '@theokit/agents') return m
    } catch {
      // keep walking up
    }
    dir = dirname(dir)
  }
  throw new Error('@theokit/agents package.json not found')
}

describe('@theokit/agents released auth APIs', () => {
  it('resolves a released version, at least 16.11.0', () => {
    const [major = 0, minor = 0] = resolvedManifest().version.split('.').map(Number)
    expect(major > 16 || (major === 16 && minor >= 11)).toBe(true)
  })

  it('exports the login and refresh APIs', () => {
    expect(typeof auth.loginWithApiKey).toBe('function')
    expect(typeof auth.ensureFreshCredential).toBe('function')
    expect(typeof auth.refreshOAuthTokens).toBe('function')
  })

  it('declares the released range in every TheoCode manifest', () => {
    const root = join(__dirname, '../../../..')
    for (const p of [
      'package.json',
      'packages/agent/package.json',
      'packages/cli/package.json',
      'packages/shared/package.json',
      'packages/tui/package.json',
    ]) {
      const m = JSON.parse(readFileSync(join(root, p), 'utf8')) as Record<
        string,
        Record<string, string> | undefined
      >
      const spec = m.dependencies?.['@theokit/agents'] ?? m.devDependencies?.['@theokit/agents']
      expect(spec, p).toBe('^16.11.0')
    }
  })
})
