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
import { describe, expectTypeOf, it } from 'vitest'

import type { StreamEvent } from '../../src/bridge/agent-sse-handler.js'
import type { AgentStreamEvent, ToolResultEvent } from '../../src/bridge/agent-stream-events.js'
import { type translateSdkEvent } from '../../src/bridge/event-translator.js'
import type { SdkTurnHandle, SdkTurnMessage } from '../../src/bridge/sdk-adapter.js'

type ResolvedTurn = Awaited<ReturnType<SdkTurnHandle['wait']>>

describe('SdkTurnHandle', () => {
  it('resolves an optional status the SDK eval runner reads', () => {
    expectTypeOf<ResolvedTurn>().toHaveProperty('status').toEqualTypeOf<string | undefined>()
  })

  it('resolves an optional error carrying a message', () => {
    expectTypeOf<ResolvedTurn>()
      .toHaveProperty('error')
      .toEqualTypeOf<{ message: string } | undefined>()
  })
})

describe('typed bridge contract', () => {
  it('turn stream yields the SDK message union, not unknown', () => {
    type Stream = NonNullable<SdkTurnHandle['stream']>
    expectTypeOf<ReturnType<Stream>>().toEqualTypeOf<AsyncIterable<SdkTurnMessage>>()
    expectTypeOf<SdkTurnMessage['type']>().toMatchTypeOf<string>()
  })

  it('narrows AgentStreamEvent by its discriminant', () => {
    const e = {} as AgentStreamEvent
    if (e.type === 'tool_result') expectTypeOf(e).toEqualTypeOf<ToolResultEvent>()
    if (e.type === 'done') expectTypeOf(e.usage.totalTokens).toEqualTypeOf<number>()
  })

  it('translators return AgentStreamEvent and it is assignable to StreamEvent', () => {
    expectTypeOf<ReturnType<typeof translateSdkEvent>>().toEqualTypeOf<AgentStreamEvent[]>()
    expectTypeOf<AgentStreamEvent>().toMatchTypeOf<StreamEvent>()
  })
})
