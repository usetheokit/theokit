import { describe, expect, it } from 'vitest'

import { normalizeCiLiveModel } from './support/live-model-setup.js'

function run(env: Record<string, string | undefined>): string | undefined {
  normalizeCiLiveModel(env)
  return env.THEOCLAW_MODEL
}

describe('normalizeCiLiveModel', () => {
  const model = 'google/gemini-2.5-flash'

  it('routes the live check through OpenRouter in CI', () => {
    expect(run({ GITHUB_ACTIONS: 'true', THEOCLAW_LIVE: '1', THEOCLAW_MODEL: model })).toBe(`openrouter/${model}`)
  })

  it('routes the container check through OpenRouter in CI', () => {
    expect(run({ GITHUB_ACTIONS: 'true', THEOCLAW_CONTAINER: '1', THEOCLAW_MODEL: model })).toBe(`openrouter/${model}`)
  })

  it('keeps an already prefixed id', () => {
    expect(run({ GITHUB_ACTIONS: 'true', THEOCLAW_LIVE: '1', THEOCLAW_MODEL: `openrouter/${model}` })).toBe(`openrouter/${model}`)
  })

  it('leaves local runs and non-live runs alone', () => {
    expect(run({ THEOCLAW_LIVE: '1', THEOCLAW_MODEL: model })).toBe(model)
    expect(run({ GITHUB_ACTIONS: 'true', THEOCLAW_MODEL: model })).toBe(model)
    expect(run({ GITHUB_ACTIONS: 'true', THEOCLAW_LIVE: '1' })).toBeUndefined()
  })
})
