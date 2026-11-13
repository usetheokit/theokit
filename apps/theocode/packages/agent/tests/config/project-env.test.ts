import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SOVEREIGN_ENV_KEYS } from '@theokit/sdk'
import { afterEach, describe, expect, it } from 'vitest'

import { loadProjectEnv, PROJECT_ENV_PROTECTED_KEYS } from '../../src/config/index.js'

const KEYS = ['THEOKIT_REDACT_SECRETS', 'THEOKIT_TRUSTED_PROVIDERS', 'THEOKIT_OAUTH_TX_SALT']
const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('loadProjectEnv', () => {
  it('protects every SDK sovereign key and TheoCode keys', () => {
    for (const k of SOVEREIGN_ENV_KEYS) expect(PROJECT_ENV_PROTECTED_KEYS).toContain(k)
    for (const k of ['THEOCODE_TRUST_ALL_DIRS', 'THEOKIT_TRUST_ALL_DIRS', 'THEOCODE_HOME'])
      expect(PROJECT_ENV_PROTECTED_KEYS).toContain(k)
  })

  it('a .env cannot set sovereign keys (absent and present)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'penv-'))
    dirs.push(dir)
    const file = join(dir, '.env')
    writeFileSync(
      file,
      'THEOKIT_REDACT_SECRETS=false\nTHEOKIT_TRUSTED_PROVIDERS=x\nTHEOKIT_OAUTH_TX_SALT=y\nTHEOKIT_HOME=/evil\nOTHER=1\n',
    )
    const env: Record<string, string | undefined> = { THEOKIT_TRUSTED_PROVIDERS: 'real' }
    loadProjectEnv(env, () => {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const [k, v] = line.split('=')
        if (k) env[k] = v
      }
    })
    expect(env.THEOKIT_TRUSTED_PROVIDERS).toBe('real')
    for (const k of KEYS.filter((k) => k !== 'THEOKIT_TRUSTED_PROVIDERS'))
      expect(env[k]).toBeUndefined()
    expect(env.THEOKIT_HOME).toBeUndefined()
    expect(env.OTHER).toBe('1')
  })

  it('real process.loadEnvFile in a temp cwd cannot set them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'penv-'))
    dirs.push(dir)
    writeFileSync(join(dir, '.env'), 'THEOKIT_REDACT_SECRETS=false\nTHEOKIT_OAUTH_TX_SALT=y\n')
    const prev = process.cwd()
    process.chdir(dir)
    try {
      loadProjectEnv()
      expect(process.env.THEOKIT_REDACT_SECRETS).toBeUndefined()
      expect(process.env.THEOKIT_OAUTH_TX_SALT).toBeUndefined()
    } finally {
      process.chdir(prev)
    }
  })
})
