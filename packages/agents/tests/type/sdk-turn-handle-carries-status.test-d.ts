/**
 * B-413 (FR-005) — what `SdkTurnHandle.wait` resolves declares `status` and `error`.
 *
 * The SDK's eval runner reads `status` off the resolved turn and counts a row as finished only when
 * it is `'finished'`; any other value records `error?.message ?? 'run <status>'`
 * (`@theokit/sdk/dist/eval.js`, `executeAgent`). A handle written against a turn type without those
 * fields gives the runner nothing to read, and every row errors with `run undefined`.
 *
 * COMPILE-TIME assertions: `tsc -p packages/agents/tsconfig.test.json --noEmit` fails while either
 * field is missing: `toHaveProperty` on a key the type does not declare is a type error.
 */
import type { InteractionUpdate, SDKMessage } from '@theokit/sdk'
import { describe, expectTypeOf, it } from 'vitest'

import type { StreamEvent } from '../../src/bridge/agent-sse-handler.js'
import type { AgentStreamEvent, ToolResultEvent } from '../../src/bridge/agent-stream-events.js'
import type {
  SdkMessage,
  translateInteractionUpdate,
  translateSdkEvent,
} from '../../src/bridge/event-translator.js'
import type { withTypedStream } from '../../src/bridge/handle-wrappers.js'
import type { SdkAgentHandle, SdkTurnHandle, toAgentFactory } from '../../src/bridge/sdk-adapter.js'
import type { SdkTimelineEvent } from '../../src/bridge/sdk-timeline.js'

type ResolvedTurn = Awaited<ReturnType<SdkTurnHandle['wait']>>

describe('SdkTurnHandle', () => {
  it('resolves an optional status the SDK eval runner reads', () => {
    expectTypeOf<ResolvedTurn>().toHaveProperty('status').toEqualTypeOf<string | undefined>()
  })

  it('resolves an optional error carrying a message', () => {
    expectTypeOf<ResolvedTurn>()
      .toHaveProperty('error')
      .toEqualTypeOf<{ message: string; code?: string } | undefined>()
  })
})

describe('typed bridge contract', () => {
  it('the default turn stream yields AgentStreamEvent', () => {
    type Stream = NonNullable<SdkTurnHandle['stream']>
    expectTypeOf<ReturnType<Stream>>().toEqualTypeOf<AsyncIterable<AgentStreamEvent>>()
    expectTypeOf<SdkAgentHandle>().toMatchTypeOf<{
      send: (msg: string) => Promise<SdkTurnHandle>
    }>()
  })

  it('the served (ACP) handle keeps the SDK message vocabulary', () => {
    type Stream = NonNullable<SdkTurnHandle<SdkMessage>['stream']>
    expectTypeOf<ReturnType<Stream>>().toEqualTypeOf<AsyncIterable<SdkMessage>>()
    expectTypeOf<ReturnType<ReturnType<typeof toAgentFactory>>>().toEqualTypeOf<
      Promise<SdkAgentHandle<SdkMessage>>
    >()
    expectTypeOf<ReturnType<typeof withTypedStream>>().toEqualTypeOf<SdkAgentHandle>()
  })

  it('real SDK messages and updates pass without casts', () => {
    expectTypeOf<SDKMessage>().toMatchTypeOf<SdkMessage>()
    expectTypeOf<InteractionUpdate>().toMatchTypeOf<
      Extract<SdkTimelineEvent, { kind: 'delta' }>['update']
    >()
    expectTypeOf<
      Extract<SdkTimelineEvent, { kind: 'message' }>['message']
    >().toMatchTypeOf<SdkMessage>()
  })

  it('narrows AgentStreamEvent by its discriminant', () => {
    const e = {} as AgentStreamEvent
    if (e.type === 'tool_result') expectTypeOf(e).toEqualTypeOf<ToolResultEvent>()
    if (e.type === 'done') expectTypeOf(e.usage.totalTokens).toEqualTypeOf<number>()
  })

  it('translators return AgentStreamEvent and it is assignable to StreamEvent', () => {
    expectTypeOf<ReturnType<typeof translateSdkEvent>>().toEqualTypeOf<AgentStreamEvent[]>()
    expectTypeOf<ReturnType<typeof translateInteractionUpdate>>().toEqualTypeOf<
      AgentStreamEvent[]
    >()
    expectTypeOf<AgentStreamEvent>().toMatchTypeOf<StreamEvent>()
  })
})
