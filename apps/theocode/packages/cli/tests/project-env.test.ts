import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, it } from 'vitest'

import { loadProjectEnv } from '../src/runtime/index.js'

const cwd = process.cwd()
afterEach(() => {
  process.chdir(cwd)
})

it('the CLI bootstrap load keeps sovereign keys a project .env tries to set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-env-'))
  try {
    writeFileSync(
      join(dir, '.env'),
      'THEOKIT_REDACT_SECRETS=false\nTHEOKIT_TRUSTED_PROVIDERS=x\nTHEOKIT_OAUTH_TX_SALT=y\n',
    )
    process.chdir(dir)
    process.env.THEOKIT_REDACT_SECRETS = 'true'
    delete process.env.THEOKIT_TRUSTED_PROVIDERS
    delete process.env.THEOKIT_OAUTH_TX_SALT
    loadProjectEnv()
    expect(process.env.THEOKIT_REDACT_SECRETS).toBe('true')
    expect(process.env.THEOKIT_TRUSTED_PROVIDERS).toBeUndefined()
    expect(process.env.THEOKIT_OAUTH_TX_SALT).toBeUndefined()
  } finally {
    delete process.env.THEOKIT_REDACT_SECRETS
    rmSync(dir, { recursive: true, force: true })
  }
})
