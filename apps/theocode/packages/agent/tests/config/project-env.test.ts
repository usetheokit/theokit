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
  it('protects every SDK sovereign key and TheoCode keys', async () => {
    for (const k of ['THEOCODE_TRUST_ALL_DIRS', 'THEOKIT_TRUST_ALL_DIRS', 'THEOCODE_HOME'])
      expect(THEOCODE_PROTECTED_ENV_KEYS).toContain(k)
    const cwd = project(`${SOVEREIGN_ENV_KEYS.map((k) => `${k}=evil`).join('\n')}\n`)
    const env: Record<string, string | undefined> = {}
    await bootstrapSurface({ env, cwd, home: cwd, onWarn: () => {} })
    for (const k of SOVEREIGN_ENV_KEYS) expect(env[k]).not.toBe('evil')
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

  it('a .env cannot move the installed home or auth home', async () => {
    const cwd = project('THEOKIT_HOME=/evil\nTHEOKIT_AUTH_HOME=/evil\n')
    const home = mkdtempSync(join(tmpdir(), 'penv-home-'))
    dirs.push(home)
    const env: Record<string, string | undefined> = {}

    await bootstrapSurface({ env, cwd, home, onWarn: () => {} })

    expect(env.THEOKIT_HOME).not.toBe('/evil')
    expect(env.THEOKIT_AUTH_HOME).not.toBe('/evil')
  })

  it('the real process.env: a .env in the selected cwd cannot set sovereign keys', async () => {
    const cwd = project('THEOKIT_REDACT_SECRETS=false\nTHEOKIT_OAUTH_TX_SALT=y\n')
    const saved = { ...process.env }
    try {
      await bootstrapSurface({ env: process.env, cwd, home: cwd, onWarn: () => {} })
      expect(process.env.THEOKIT_REDACT_SECRETS).toBeUndefined()
      expect(process.env.THEOKIT_OAUTH_TX_SALT).toBeUndefined()
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
      Object.assign(process.env, saved)
    }
  })

  it('returns what it loaded, so a shell value that overrides a .env declaration is not labelled .env', async () => {
    const cwd = project('SHELL_WINS=from-file\nFILE_ONLY=1\nBAD-NAME=x\nOPEN="never closed\nHIDDEN=2\n')
    const env: Record<string, string | undefined> = { SHELL_WINS: 'from-shell' }

    const record = await bootstrapSurface({ env, cwd, home: cwd, onWarn: () => {} })

    expect(record?.file).toBe(join(cwd, '.env'))
    expect(record?.loaded).toEqual(['FILE_ONLY'])
    expect(env.SHELL_WINS).toBe('from-shell')
    expect(env.HIDDEN).toBeUndefined()
    expect(env['BAD-NAME']).toBeUndefined()
  })

  it('reports a TheoCode-protected key as refused and leaves it unset', async () => {
    const cwd = project('THEOCODE_TRUST_ALL_DIRS=1\nOTHER=1\n')
    const env: Record<string, string | undefined> = {}

    const record = await bootstrapSurface({ env, cwd, home: cwd, onWarn: () => {} })

    expect(record?.refused).toEqual(['THEOCODE_TRUST_ALL_DIRS'])
    expect(record?.loaded).toEqual(['OTHER'])
    expect(env.THEOCODE_TRUST_ALL_DIRS).toBeUndefined()
  })
})
