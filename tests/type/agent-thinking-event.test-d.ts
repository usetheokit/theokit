import { describe, it, expectTypeOf } from 'vitest'
import type {
  AgentEvent,
  AgentThinkingEvent,
} from '../../packages/theo/src/core/contracts/agent-events.js'
// Public surface: theocode (Cycle 2) imports the variant from `theokit/client`.
import type { AgentThinkingEvent as ClientAgentThinkingEvent } from '../../packages/theo/src/client/index.js'

describe('AgentThinkingEvent — contract variant (agents-thinking-event-contract)', () => {
  it('is assignable to the AgentEvent union', () => {
    const ev = { type: 'thinking', content: 'I will list the files' } as const
    expectTypeOf(ev).toExtend<AgentEvent>()
  })

  it('narrows from AgentEvent by the type discriminant and carries content: string', () => {
    type Thinking = Extract<AgentEvent, { type: 'thinking' }>
    expectTypeOf<Thinking>().toEqualTypeOf<AgentThinkingEvent>()
    expectTypeOf<Thinking['content']>().toEqualTypeOf<string>()
  })

  it('carries an optional id (dedup / animation key), like the other variants', () => {
    expectTypeOf<AgentThinkingEvent['id']>().toEqualTypeOf<string | undefined>()
  })

  it('is re-exported from theokit/client (the surface external consumers import)', () => {
    expectTypeOf<ClientAgentThinkingEvent>().toEqualTypeOf<AgentThinkingEvent>()
  })
})
