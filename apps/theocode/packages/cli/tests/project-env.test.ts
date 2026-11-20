import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { bootstrapSurface } from '@theocode/agent/bootstrap'
import { afterEach, expect, it } from 'vitest'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

it('CLI bootstrap keeps sovereign keys through a project .env', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-penv-'))
  dirs.push(dir)
  writeFileSync(
    join(dir, '.env'),
    'THEOKIT_REDACT_SECRETS=false\nTHEOKIT_TRUSTED_PROVIDERS=x\nTHEOKIT_OAUTH_TX_SALT=y\n',
  )
  const env: Record<string, string | undefined> = {}
  await bootstrapSurface({ env, cwd: dir, home: dir, onWarn: () => {} })
  expect(env.THEOKIT_REDACT_SECRETS).toBeUndefined()
  expect(env.THEOKIT_TRUSTED_PROVIDERS).toBeUndefined()
  expect(env.THEOKIT_OAUTH_TX_SALT).toBeUndefined()
})
