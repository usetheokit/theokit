import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SOVEREIGN_ENV_KEYS } from '@theokit/sdk'
import { afterEach, describe, expect, it } from 'vitest'

import { THEOCODE_PROTECTED_ENV_KEYS } from '../../src/bootstrap/bootstrap-surface.js'
import { bootstrapSurface } from '../../src/bootstrap/index.js'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function project(env: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'penv-'))
  dirs.push(dir)
  writeFileSync(join(dir, '.env'), env)
  return dir
}

describe('bootstrapSurface project .env', () => {
  it('protects TheoCode keys on top of the SDK sovereign keys', () => {
    for (const k of ['THEOCODE_TRUST_ALL_DIRS', 'THEOKIT_TRUST_ALL_DIRS', 'THEOCODE_HOME'])
      expect(THEOCODE_PROTECTED_ENV_KEYS).toContain(k)
    expect(SOVEREIGN_ENV_KEYS.length).toBeGreaterThan(0)
  })

  it('a .env cannot set sovereign keys (absent and present)', async () => {
    const cwd = project(
      'THEOKIT_REDACT_SECRETS=false\nTHEOKIT_TRUSTED_PROVIDERS=x\nTHEOKIT_OAUTH_TX_SALT=y\nTHEOCODE_TRUST_ALL_DIRS=1\nOTHER=1\n',
    )
    const home = mkdtempSync(join(tmpdir(), 'penv-home-'))
    dirs.push(home)
    const env: Record<string, string | undefined> = { THEOKIT_TRUSTED_PROVIDERS: 'real' }

    await bootstrapSurface({ env, cwd, home, onWarn: () => {} })

    expect(env.THEOKIT_TRUSTED_PROVIDERS).toBe('real')
    expect(env.THEOKIT_REDACT_SECRETS).toBeUndefined()
    expect(env.THEOKIT_OAUTH_TX_SALT).toBeUndefined()
    expect(env.THEOCODE_TRUST_ALL_DIRS).toBeUndefined()
    expect(env.OTHER).toBe('1')
  })

  it('a .env cannot move the installed home', async () => {
    const cwd = project('THEOKIT_HOME=/evil\nTHEOKIT_AUTH_HOME=/evil\n')
    const home = mkdtempSync(join(tmpdir(), 'penv-home-'))
    dirs.push(home)
    const env: Record<string, string | undefined> = {}

    await bootstrapSurface({ env, cwd, home, onWarn: () => {} })

    expect(env.THEOKIT_HOME).not.toBe('/evil')
    expect(env.THEOKIT_AUTH_HOME).not.toBe('/evil')
  })
})
