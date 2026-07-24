/**
 * V4-R — `AgentRunner.stream()` accepts an injected `RoundStreamFactory` (run-option). When provided,
 * the reflective loop is driven by it INSTEAD of `createSdkAgentStream`, so a consumer can drive the
 * loop with its own per-round stream (tests / custom transport). Absent ⇒ the SDK adapter (default).
 * The injected factory bypasses the SDK entirely — no `@theokit/sdk` mock is needed here.
 */
import 'reflect-metadata'
import { MainLoopCapability } from '../../src/capability/agent-capabilities.js'
import { ModelCapability } from '../../src/capability/capabilities.js'
import { applyCapabilities } from '../../src/capability/capability.js'
import { describe, expect, it } from 'vitest'

import { AgentRunner, type RoundStreamFactory } from '../../src/index.js'

const sFAgent = applyCapabilities([new ModelCapability('m')])

const reactAgent = applyCapabilities([
  new ModelCapability('m'),
  new MainLoopCapability({ maxIterations: 5 }),
])

describe('V4-R AgentRunner accepts an injected RoundStreamFactory', () => {
  it('test_injected_factory_drives_the_loop_without_sdk', async () => {
    const factory: RoundStreamFactory = () => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'text_delta', content: 'hi' }
        yield { type: 'done', usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } }
      },
    })
    const r = await AgentRunner.fromSpec({
      compiled: sFAgent,
      name: 'sFAgent',
      strategy: 'simple-chat',
    })
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
    await AgentRunner.fromSpec({ compiled: sFAgent, name: 'sFAgent', strategy: 'simple-chat' })
      .build()
      .run('do it', { apiKey: 'k', sessionId: 'sess-1', streamFactory: factory })
    expect(seen.message).toBe('do it')
    expect(seen.sessionId).toBe('sess-1')
  })

  it('test_injected_factory_drives_multiple_rounds_under_react', async () => {
    // LOW (review): prove streamFactory composes with loop options — a react agent re-enters the
    // injected factory while a round ends on tool-calls, terminating when a round answers.
    let round = 0
    const factory: RoundStreamFactory = () => {
      const r = round++
      return {
        async *[Symbol.asyncIterator]() {
          if (r === 0) {
            yield { type: 'tool_call', callId: 'c1', toolName: 't', input: {} }
            yield { type: 'tool_result', callId: 'c1', toolName: 't', output: 'ok' }
            yield { type: 'done', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
          } else {
            yield { type: 'text_delta', content: 'final' }
            yield { type: 'done', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
          }
        },
      }
    }
    const r = await AgentRunner.fromSpec({
      compiled: reactAgent,
      name: 'reactAgent',
      strategy: 'react',
    })
      .build()
      .run('go', { apiKey: 'k', streamFactory: factory, maxIterations: 5 })
    expect(round).toBe(2) // round 1 (tool-calls → continue) then round 2 (stop)
    expect(r.tokens).toBe(4) // accumulated across both rounds
    expect(r.response).toBe('final')
  })
})
