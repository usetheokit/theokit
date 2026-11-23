import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { bootstrapSurface } from '@theocode/agent/bootstrap'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import {
  credentialSource,
  setProjectEnvRecord,
} from '../../src/agent-session/credential-helpers.js'

const dirs: string[] = []
beforeEach(() => {
  vi.stubEnv('ANTHROPIC_API_KEY', 'placeholder')
  vi.stubEnv('OPENAI_API_KEY', 'placeholder')
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.OPENAI_API_KEY
})
afterEach(() => {
  setProjectEnvRecord(undefined)
  vi.unstubAllEnvs()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

async function boot(dotenv: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'cred-src-'))
  dirs.push(dir)
  writeFileSync(join(dir, '.env'), dotenv)
  const ctx = await bootstrapSurface({ env: process.env, cwd: dir, home: dir, onWarn: () => {} })
  setProjectEnvRecord(ctx.projectEnv)
  return dir
}

it('labels a key set in both the shell and .env as the shell', async () => {
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-from-shell')
  await boot('ANTHROPIC_API_KEY=sk-ant-from-file\n')
  expect(process.env.ANTHROPIC_API_KEY).toBe('sk-ant-from-shell')
  expect(credentialSource()).toContain('ANTHROPIC_API_KEY (shell)')
})

it('labels a key the .env actually loaded with the .env path', async () => {
  const dir = await boot('ANTHROPIC_API_KEY=sk-ant-from-file\n')
  expect(credentialSource()).toContain(`ANTHROPIC_API_KEY (${join(dir, '.env')})`)
})
