/**
 * V4-R — `AgentRunner.stream()` accepts an injected `RoundStreamFactory` (run-option). When provided,
 * the reflective loop is driven by it INSTEAD of `createSdkAgentStream`, so a consumer can drive the
 * loop with its own per-round stream (tests / custom transport). Absent ⇒ the SDK adapter (default).
 * The injected factory bypasses the SDK entirely — no `@theokit/sdk` mock is needed here.
 */
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'

import { AgentRunner, type RoundStreamFactory } from '../../src/index.js'
import { Agent } from '../../src/decorators/agent.js'
import { MainLoop } from '../../src/decorators/main-loop.js'

@Agent({ name: 'sf', route: '/sf', model: 'm' })
class SFAgent {
  @MainLoop({ strategy: 'simple-chat' })
  async run() {}
}

describe('V4-R AgentRunner accepts an injected RoundStreamFactory', () => {
  it('test_injected_factory_drives_the_loop_without_sdk', async () => {
    const factory: RoundStreamFactory = () => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'text_delta', content: 'hi' }
        yield { type: 'done', usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } }
      },
    })
    const r = await AgentRunner.builder(SFAgent)
      .build()
      .run('hi', { apiKey: 'k', streamFactory: factory })
    // The response + usage come from the INJECTED stream (proof the SDK adapter was bypassed).
    expect(r.response).toBe('hi')
    expect(r.tokens).toBe(5)
    expect(r.tokensInput).toBe(3)
    expect(r.tokensOutput).toBe(2)
  })

  it('test_injected_factory_receives_message_and_session', async () => {
    let seen: { message?: string; sessionId?: string } = {}
    const factory: RoundStreamFactory = (message, sessionId) => {
      seen = { message, sessionId }
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'done', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
        },
      }
    }
    await AgentRunner.builder(SFAgent)
      .build()
      .run('do it', { apiKey: 'k', sessionId: 'sess-1', streamFactory: factory })
    expect(seen.message).toBe('do it')
    expect(seen.sessionId).toBe('sess-1')
  })
})
