import { describe, expect, it } from 'vitest'
import { requireModel } from '../src/control-plane/settings.js'

describe('requireModel on the ChatGPT subscription route', () => {
  it('needs no API key for openai-chatgpt/', () => {
    expect(requireModel({ THEOCLAW_MODEL: 'openai-chatgpt/gpt-5.6-luna' } as never).model).toBe(
      'openai-chatgpt/gpt-5.6-luna',
    )
  })
  it('still needs a key for other providers', () => {
    expect(() => requireModel({ THEOCLAW_MODEL: 'openai-codex/gpt-5' } as never)).toThrow(
      /THEOKIT_API_KEY/,
    )
  })
})
