/**
 * Consumer-facing compile-time contract (TheoClaw): a real SDK `Run` / `SDKAgent` is assignable to
 * the bridge's structural handles, and stream/timeline/outcome types narrow without casts.
 * Checked by `tsc -p packages/agents/tsconfig.test.json --noEmit`.
 */
import type { Run, SDKAgent, SDKMessage, SDKUserMessage, SendOptions } from '@theokit/sdk'
import { describe, expectTypeOf, it } from 'vitest'

import {
  isDeltaTimelineEvent,
  isMessageTimelineEvent,
  type SdkAgentHandle,
  type SdkSendOptions,
  type SdkStreamMessage,
  type SdkTimelineEvent,
  type SdkTurnHandle,
  type SdkTurnOutcome,
  translateSdkEvent,
  translateTimelineEvent,
  createToolSeen,
} from '../../src/bridge/index.js'

describe('bridge contract vs the real SDK', () => {
  it('a real Run is assignable to SdkTurnHandle', () => {
    expectTypeOf<Run>().toExtend<SdkTurnHandle>()
  })

  it('a real SDKAgent send is accepted by SdkAgentHandle', () => {
    expectTypeOf<SDKAgent['send']>().toExtend<SdkAgentHandle['send']>()
  })

  it('send takes structured messages and the SDK send options', () => {
    expectTypeOf<Parameters<SdkAgentHandle['send']>[0]>().toEqualTypeOf<string | SDKUserMessage>()
    expectTypeOf<SdkSendOptions>().toEqualTypeOf<SendOptions>()
  })

  it('the turn exposes typed stream, timeline, cancel and outcome', () => {
    expectTypeOf<SdkStreamMessage>().toEqualTypeOf<SDKMessage>()
    type T = Required<SdkTurnHandle>
    expectTypeOf<ReturnType<T['events']>>().toEqualTypeOf<AsyncIterable<SdkTimelineEvent>>()
    expectTypeOf<ReturnType<T['cancel']>>().toEqualTypeOf<Promise<void>>()
    expectTypeOf<SdkTurnOutcome>().toHaveProperty('stoppedByDoomLoop')
    expectTypeOf<SdkTurnOutcome>().toHaveProperty('stoppedAtIterationLimit')
  })

  it('timeline events narrow and feed the translator without casts', () => {
    const f = (ev: SdkTimelineEvent): void => {
      if (isDeltaTimelineEvent(ev)) expectTypeOf(ev.update.type).toBeString()
      if (isMessageTimelineEvent(ev)) {
        expectTypeOf(ev.message).not.toBeAny()
        translateSdkEvent(ev.message, 'r')
      }
      translateTimelineEvent(ev, 'r', createToolSeen())
    }
    expectTypeOf(f).toBeFunction()
    // A raw SDK message is accepted by the translator directly.
    expectTypeOf(translateSdkEvent).parameter(0).toExtend<SDKMessage | { type: string }>()
  })
})
