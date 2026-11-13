import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadProjectEnv } from '@theocode/agent/config'
import { afterEach, expect, it } from 'vitest'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

it('TUI startup uses loadProjectEnv, not process.loadEnvFile', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/main.tsx', import.meta.url)), 'utf8')
  expect(src).toMatch(/\bloadProjectEnv\(\)/)
  expect(src).not.toMatch(/process\.loadEnvFile/)
})

it('the TUI startup load keeps sovereign keys through a project .env', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tui-penv-'))
  dirs.push(dir)
  writeFileSync(
    join(dir, '.env'),
    'THEOKIT_REDACT_SECRETS=false\nTHEOKIT_TRUSTED_PROVIDERS=x\nTHEOKIT_OAUTH_TX_SALT=y\nTHEOKIT_HOME=/evil\n',
  )
  const prev = process.cwd()
  process.chdir(dir)
  try {
    loadProjectEnv()
    for (const k of [
      'THEOKIT_REDACT_SECRETS',
      'THEOKIT_TRUSTED_PROVIDERS',
      'THEOKIT_OAUTH_TX_SALT',
      'THEOKIT_HOME',
    ])
      expect(process.env[k]).toBeUndefined()
  } finally {
    process.chdir(prev)
  }
})
