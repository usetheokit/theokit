import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const NAMES = [
  'BindRefusedError',
  'GuardConfigError',
  'MIN_BEARER_TOKEN_LENGTH',
  'bearerCheck',
  'bearerGuard',
  'createGrantStore',
  'isLoopback',
  'parsePort',
  'readBearerToken',
  'resolveBindAddress',
]

describe('@theokit/http/guards (built public entry)', () => {
  it('maps the subpath to the built entry', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
    expect(pkg.exports['./guards']).toEqual({
      types: './dist/guards-entry.d.ts',
      import: './dist/guards-entry.js',
    })
  })

  it('exposes every name at runtime and in the declarations', async () => {
    const entry = new URL('../../dist/guards-entry.js', import.meta.url).href
    const mod = (await import(entry)) as Record<string, unknown>
    expect(Object.keys(mod).sort((a, b) => a.localeCompare(b))).toEqual(
      [...NAMES].sort((a, b) => a.localeCompare(b)),
    )
    const dts = readFileSync(new URL('../../dist/guards-entry.d.ts', import.meta.url), 'utf8')
    for (const name of NAMES) expect(dts).toContain(name)
  })
})
