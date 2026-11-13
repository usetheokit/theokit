import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SOVEREIGN_ENV_KEYS } from '@theokit/sdk'
import { afterEach, describe, expect, it } from 'vitest'

import { loadProjectEnv, PROTECTED_ENV_KEYS } from '../../src/config/project-env.js'

describe('loadProjectEnv', () => {
  const cwd = process.cwd()
  afterEach(() => {
    process.chdir(cwd)
  })

  it('protects every SDK sovereign key and TheoCode’s own', () => {
    for (const k of SOVEREIGN_ENV_KEYS) expect(PROTECTED_ENV_KEYS).toContain(k)
    for (const k of ['THEOCODE_TRUST_ALL_DIRS', 'THEOCODE_HOME', 'THEOKIT_TRUST_ALL_DIRS']) {
      expect(PROTECTED_ENV_KEYS).toContain(k)
    }
  })

  it('keeps previous values (including absent) when a real .env sets protected keys', () => {
    const dir = mkdtempSync(join(tmpdir(), 'penv-'))
    try {
      writeFileSync(
        join(dir, '.env'),
        'THEOKIT_REDACT_SECRETS=false\nTHEOKIT_TRUSTED_PROVIDERS=x\nTHEOKIT_OAUTH_TX_SALT=y\n',
      )
      process.chdir(dir)
      delete process.env.THEOKIT_TRUSTED_PROVIDERS
      delete process.env.THEOKIT_OAUTH_TX_SALT
      process.env.THEOKIT_REDACT_SECRETS = 'true'
      loadProjectEnv()
      expect(process.env.THEOKIT_REDACT_SECRETS).toBe('true')
      expect(process.env.THEOKIT_TRUSTED_PROVIDERS).toBeUndefined()
      expect(process.env.THEOKIT_OAUTH_TX_SALT).toBeUndefined()
    } finally {
      delete process.env.THEOKIT_REDACT_SECRETS
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
