import { afterEach, describe, expect, it, vi } from 'vitest'

const KEYS = ['OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'THEOKIT_API_KEY']

async function loadConfig() {
  vi.resetModules()
  return (await import('../vitest.live.config.ts')).default
}

describe('vitest.live.config', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('fails at load when the flag is set and no provider key is present', async () => {
    for (const k of KEYS) vi.stubEnv(k, '')
    vi.stubEnv('THEOKIT_LIVE_REQUIRED', '1')
    await expect(loadConfig()).rejects.toThrow(/provider key absent/)
  })

  it('loads when the flag is unset', async () => {
    for (const k of KEYS) vi.stubEnv(k, '')
    vi.stubEnv('THEOKIT_LIVE_REQUIRED', '')
    expect((await loadConfig()).test.include).toHaveLength(1)
  })
})
