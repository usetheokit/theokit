/**
 * #1802 — the bridge returns the typed event union and accepts the SDK's own types without a cast.
 */
import type { Agent, SDKAgent, SDKMessage } from '@theokit/sdk'
import { describe, expectTypeOf, it } from 'vitest'

import type { AgentStreamEvent } from '../../src/bridge/agent-stream-events.js'
import {
  translateInteractionUpdate,
  translateSdkEvent,
  type SdkMessageLike,
} from '../../src/bridge/event-translator.js'
import type { SdkAgentHandle, SdkSendOptions, SdkTurnHandle } from '../../src/bridge/sdk-adapter.js'

type Resolved = Awaited<ReturnType<SdkTurnHandle['wait']>>

describe('the bridge types', () => {
  it('translateSdkEvent returns AgentStreamEvent', () => {
    const m: SdkMessageLike = { type: 'system' }
    expectTypeOf(translateSdkEvent(m, 'r')).toEqualTypeOf<AgentStreamEvent[]>()
    expectTypeOf(translateInteractionUpdate).returns.toEqualTypeOf<AgentStreamEvent[]>()
  })

  it('an @theokit/sdk SDKMessage is assignable to the translator input', () => {
    expectTypeOf<SDKMessage>().toMatchTypeOf<Parameters<typeof translateSdkEvent>[0]>()
    expectTypeOf<SDKMessage>().toMatchTypeOf<SdkMessageLike>()
  })

  it('an @theokit/sdk Agent is assignable to SdkAgentHandle', () => {
    expectTypeOf<SDKAgent>().toMatchTypeOf<SdkAgentHandle>()
    expectTypeOf<Agent>().not.toBeAny()
  })

  it('types the send options and the run', () => {
    expectTypeOf<SdkSendOptions['signal']>().toEqualTypeOf<AbortSignal | undefined>()
    expectTypeOf<SdkSendOptions['queueMode']>().toEqualTypeOf<
      'followup' | 'steer' | 'collect' | undefined
    >()
    expectTypeOf<SdkSendOptions>().toHaveProperty('onDelta')
    expectTypeOf<SdkTurnHandle>().toHaveProperty('cancel')
    expectTypeOf<Resolved['usage']>().toEqualTypeOf<
      { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined
    >()
    expectTypeOf<Resolved['cost']>().toEqualTypeOf<{ amountUsd?: number } | undefined>()
  })

  it('still accepts a Record<string, unknown> as send options', () => {
    expectTypeOf<Record<string, unknown>>().toMatchTypeOf<SdkSendOptions>()
  })
})

describe('existing handle contracts still compile', () => {
  it('accepts a generate call with extra option keys', () => {
    const handle = {} as SdkAgentHandle
    void handle.generate?.('m', { output: 1, extra: true })
    expectTypeOf(handle.generate).not.toBeAny()
  })

  it('passes a streamed message to the translator without a cast', async () => {
    const turn = {} as SdkTurnHandle
    for await (const message of turn.stream?.() ?? []) {
      expectTypeOf(translateSdkEvent(message, 'r')).toEqualTypeOf<AgentStreamEvent[]>()
    }
  })
})
