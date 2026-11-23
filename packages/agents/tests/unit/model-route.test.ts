import { describe, expect, it } from 'vitest'

import {
  isSubscriptionRoute,
  modelForCredential,
  parseModelRef,
} from '../../src/auth/model-route.js'

describe('model routing helpers', () => {
  it('splits at the first slash', () => {
    expect(parseModelRef('openrouter/openai/gpt-4o-mini')).toEqual({
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
    })
    expect(parseModelRef('gpt-4o')).toEqual({ provider: undefined, model: 'gpt-4o' })
  })
  it('recognises the subscription route', () => {
    expect(isSubscriptionRoute('openai-chatgpt/gpt-5')).toBe(true)
    expect(isSubscriptionRoute('openai/gpt-5')).toBe(false)
  })
  it('rewrites onto the subscription route only for an openai oauth login', () => {
    const oauth = { kind: 'oauth', provider: 'openai' }
    expect(modelForCredential(oauth, 'openai/gpt-5')).toBe('openai-chatgpt/gpt-5')
    expect(modelForCredential(oauth, 'gpt-5')).toBe('openai-chatgpt/gpt-5')
    expect(modelForCredential({ kind: 'api-key', provider: 'openai' }, 'openai/gpt-5')).toBe(
      'openai/gpt-5',
    )
  })
})
