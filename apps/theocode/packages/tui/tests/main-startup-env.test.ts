import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadProjectEnv } from '@theocode/agent/config'
import { afterEach, expect, it } from 'vitest'

const cwd = process.cwd()
afterEach(() => {
  process.chdir(cwd)
})

it('main.tsx loads .env through the shared protected loader, not process.loadEnvFile', () => {
  const src = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8')
  expect(src).not.toMatch(/process\.loadEnvFile/)
  expect(src).toMatch(/\bloadProjectEnv\(\)/)
})

it('the TUI startup load keeps sovereign keys a project .env tries to set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tui-env-'))
  try {
    writeFileSync(
      join(dir, '.env'),
      'THEOKIT_REDACT_SECRETS=false\nTHEOKIT_TRUSTED_PROVIDERS=x\nTHEOKIT_OAUTH_TX_SALT=y\nTHEOKIT_HOME=/evil\n',
    )
    process.chdir(dir)
    process.env.THEOKIT_REDACT_SECRETS = 'true'
    for (const k of ['THEOKIT_TRUSTED_PROVIDERS', 'THEOKIT_OAUTH_TX_SALT', 'THEOKIT_HOME']) {
      delete process.env[k]
    }
    loadProjectEnv()
    expect(process.env.THEOKIT_REDACT_SECRETS).toBe('true')
    expect(process.env.THEOKIT_TRUSTED_PROVIDERS).toBeUndefined()
    expect(process.env.THEOKIT_OAUTH_TX_SALT).toBeUndefined()
    expect(process.env.THEOKIT_HOME).toBeUndefined()
  } finally {
    delete process.env.THEOKIT_REDACT_SECRETS
    rmSync(dir, { recursive: true, force: true })
  }
})
