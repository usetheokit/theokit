import { describe, expect, it } from 'vitest'

import type { CompiledAgentOptions } from '../../src/bridge/agent-compiler.js'
import { createSdkAgentStream } from '../../src/bridge/sdk-adapter.js'

/**
 * Regression: the HTTP app builder passed `walk` where `createSdkAgentStream` expects
 * `CompiledAgentOptions`, and a bare model string where it expects `RuntimeOverrides`. Because that
 * call goes through an untyped dynamic import (`Function`), TypeScript never caught either — so the
 * agent's own `model` and the app-level override were BOTH dropped and every HTTP agent silently ran
 * the fallback model. These tests pin the resolution contract so the shape can't drift again.
 */
describe('createSdkAgentStream — model resolution contract', () => {
  const compiled = { model: 'anthropic/claude-sonnet-5', tools: [], agents: {}, stream: true }

  it('uses the compiled model when no override is given', () => {
    const factory = createSdkAgentStream(compiled as CompiledAgentOptions, [], 'k')
    expect(factory.resolvedModel).toBe('anthropic/claude-sonnet-5')
  })

  it('an explicit override wins over the compiled model', () => {
    const factory = createSdkAgentStream(compiled as CompiledAgentOptions, [], 'k', {
      model: 'openai/gpt-5.4',
    })
    expect(factory.resolvedModel).toBe('openai/gpt-5.4')
  })

  it('falls back only when NEITHER the compiled options nor the override carry a model', () => {
    const bare = { tools: [], agents: {}, stream: true } as CompiledAgentOptions
    expect(createSdkAgentStream(bare, [], 'k').resolvedModel).toBe('openai/gpt-4o-mini')
  })
})
