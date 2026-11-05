import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { configurationReloader } from '../src/config-file.js'

it('reloads changed and removed file settings while preserving environment overrides', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reload-'))
  try {
    const path = join(dir, 'config')
    const env: NodeJS.ProcessEnv = { THEOCLAW_CONFIG: path, OVERRIDE: 'caller', OPENROUTER_API_KEY: undefined }
    const reload = configurationReloader(env, dir)
    writeFileSync(path, 'OPENROUTER_API_KEY=first\nOLD=yes\nOVERRIDE=file')
    reload()
    expect(env.OPENROUTER_API_KEY).toBe('first')
    writeFileSync(path, 'OPENROUTER_API_KEY=second')
    reload()
    expect(env.OPENROUTER_API_KEY).toBe('second')
    expect(env.OLD).toBeUndefined()
    expect(env.OVERRIDE).toBe('caller')
    rmSync(path)
    expect(reload).toThrow()
    expect(env.OPENROUTER_API_KEY).toBe('second')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

it('uses a rotated credential for the next agent without rebuilding the factory', async () => {
  const { createAgentFactory } = await import('../src/control-plane/agent-factory.js')
  const dir = mkdtempSync(join(tmpdir(), 'reload-agent-'))
  try {
    const path = join(dir, 'config')
    const env = { THEOCLAW_CONFIG: path, THEOCLAW_MODEL: 'openrouter/test' }
    const reload = configurationReloader(env, dir)
    const keys: string[] = []
    const factory = createAgentFactory(env, async (options) => {
      keys.push(options.apiKey)
      return { send: async () => { throw new Error('unused') } }
    })
    writeFileSync(path, 'OPENROUTER_API_KEY=first')
    reload()
    await factory()
    writeFileSync(path, 'OPENROUTER_API_KEY=second')
    reload()
    await factory()
    expect(keys).toEqual(['first', 'second'])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
