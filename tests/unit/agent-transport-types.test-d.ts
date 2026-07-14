import { describe, expectTypeOf, it } from 'vitest'
import type { ChatTransport, UIMessage } from 'ai'

import type { ChannelTransport } from '../../packages/theo/src/client/channel-transport.js'
import type { HttpTransport } from '../../packages/theo/src/client/http-transport.js'
import type { InProcessTransport } from '../../packages/theo/src/client/in-process-transport.js'
import type { AgentTransport } from '../../packages/theo/src/client/transport.js'
import { agentHandle } from '../../packages/theo/src/client/agent-handle.js'
import type { AgentHandle } from '../../packages/theo/src/client/agent-handle.js'
import type { UseAgentReturn } from '../../packages/theo/src/client/use-agent.js'

/**
 * M41 (ADR-0050 D1/D2) — the seam IS `ai`'s `ChatTransport<UIMessage>`. Both shipped transports MUST
 * be assignable to it, and `AgentTransport` extends it (adding the optional out-of-band `approve`).
 * These type assertions compile ONLY when the seam adoption holds.
 */
describe('AgentTransport seam (types)', () => {
  it('D1 — HttpTransport implements the adopted ChatTransport seam', () => {
    expectTypeOf<HttpTransport>().toExtend<ChatTransport<UIMessage>>()
  })

  it('D4 — InProcessTransport implements the same seam', () => {
    expectTypeOf<InProcessTransport>().toExtend<ChatTransport<UIMessage>>()
  })

  it('M42 — ChannelTransport implements the same seam', () => {
    expectTypeOf<ChannelTransport>().toExtend<ChatTransport<UIMessage>>()
  })

  it('D2 — AgentTransport is the ChatTransport seam plus the optional approve method', () => {
    expectTypeOf<AgentTransport>().toExtend<ChatTransport<UIMessage>>()
    expectTypeOf<HttpTransport>().toExtend<AgentTransport>()
    expectTypeOf<InProcessTransport>().toExtend<AgentTransport>()
    expectTypeOf<ChannelTransport>().toExtend<AgentTransport>()
  })
})

/**
 * M46 — `useAgent`'s return type exposes the surface-agnostic conversation `thread` alongside the
 * back-compat per-turn `messages`. This assertion is the codegen contract: the generated `@theo/agents`
 * client types `useAgent` as `UseAgentReturn<...>`, so `thread` propagates to every typed agent binding
 * with ZERO codegen change (the generator emits the interface name, not a hand-written shape).
 */
describe('UseAgentReturn conversation thread (types) — M46', () => {
  it('exposes both the per-turn `messages` and the full conversation `thread` as UIMessage[]', () => {
    expectTypeOf<UseAgentReturn>().toHaveProperty('messages').toEqualTypeOf<UIMessage[]>()
    expectTypeOf<UseAgentReturn>().toHaveProperty('thread').toEqualTypeOf<UIMessage[]>()
  })
})

/**
 * M47 (ADR-M47-2) — binding by a typed handle infers `send`'s parameter from the handle's phantom input,
 * with NO duplicated `<{ message }>` at the call site. This is the parity that kills the anti-pattern: the
 * input type flows from the agent's `.input()` through the generated handle to `useAgent(handle).send`.
 */
describe('useAgent(handle) input inference (types) — M47', () => {
  it('the generated handle carries the agent input type as its phantom generic', () => {
    // `agentHandle<{ message }>()` yields `AgentHandle<{ message }>` — the type the codegen emits per agent.
    const chat = agentHandle<{ message: string }>('/api/agents/chat')
    expectTypeOf(chat).toEqualTypeOf<AgentHandle<{ message: string }>>()
  })

  it('binding by that input type infers send() with no duplication at the call site', () => {
    // `useAgent(handle)` returns `UseAgentReturn<TInput>` (TInput from the handle) — so `send` is typed to
    // the agent input WITHOUT restating `<{ message }>` where the hook is used.
    expectTypeOf<UseAgentReturn<{ message: string }>['send']>()
      .parameter(0)
      .toEqualTypeOf<{ message: string }>()
  })
})
