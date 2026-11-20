import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { bootstrapSurface } from '@theocode/agent/bootstrap'
import { afterEach, expect, it } from 'vitest'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

it('TUI startup uses bootstrapSurface (which loads the env), not process.loadEnvFile', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/main.tsx', import.meta.url)), 'utf8')
  expect(src).toMatch(/await bootstrapSurface\(/)
  expect(src).not.toMatch(/process\.loadEnvFile/)
})

it('the TUI startup load keeps sovereign keys through a project .env', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tui-penv-'))
  dirs.push(dir)
  writeFileSync(
    join(dir, '.env'),
    'THEOKIT_REDACT_SECRETS=false\nTHEOKIT_TRUSTED_PROVIDERS=x\nTHEOKIT_OAUTH_TX_SALT=y\nTHEOKIT_HOME=/evil\n',
  )
  const env: Record<string, string | undefined> = {}
  await bootstrapSurface({ env, cwd: dir, home: dir, onWarn: () => {} })
  for (const k of ['THEOKIT_REDACT_SECRETS', 'THEOKIT_TRUSTED_PROVIDERS', 'THEOKIT_OAUTH_TX_SALT'])
    expect(env[k]).toBeUndefined()
  expect(env.THEOKIT_HOME).not.toBe('/evil')
})
