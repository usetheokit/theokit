import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const NAMES = [
  'BindRefusedError',
  'GuardConfigError',
  'MIN_BEARER_TOKEN_LENGTH',
  'bearerCheck',
  'bearerGuard',
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
    const mod = await import('@theokit/http/guards')
    expect(Object.keys(mod).sort((a, b) => a.localeCompare(b))).toEqual(
      [...NAMES].sort((a, b) => a.localeCompare(b)),
    )
    const dts = readFileSync(new URL('../../dist/guards-entry.d.ts', import.meta.url), 'utf8')
    for (const name of NAMES) expect(dts).toContain(name)
  })
})
