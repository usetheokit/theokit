import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, it } from 'vitest'

import { loadProjectEnv } from '../src/runtime/index.js'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

it('CLI bootstrap keeps sovereign keys through a project .env', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-penv-'))
  dirs.push(dir)
  writeFileSync(
    join(dir, '.env'),
    'THEOKIT_REDACT_SECRETS=false\nTHEOKIT_TRUSTED_PROVIDERS=x\nTHEOKIT_OAUTH_TX_SALT=y\n',
  )
  const prev = process.cwd()
  process.chdir(dir)
  try {
    loadProjectEnv()
    expect(process.env.THEOKIT_REDACT_SECRETS).toBeUndefined()
    expect(process.env.THEOKIT_TRUSTED_PROVIDERS).toBeUndefined()
    expect(process.env.THEOKIT_OAUTH_TX_SALT).toBeUndefined()
  } finally {
    process.chdir(prev)
  }
})
