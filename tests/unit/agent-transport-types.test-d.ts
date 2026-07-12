import { describe, expectTypeOf, it } from 'vitest'
import type { ChatTransport, UIMessage } from 'ai'

import type { HttpTransport } from '../../packages/theo/src/client/http-transport.js'
import type { InProcessTransport } from '../../packages/theo/src/client/in-process-transport.js'
import type { AgentTransport } from '../../packages/theo/src/client/transport.js'

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

  it('D2 — AgentTransport is the ChatTransport seam plus the optional approve method', () => {
    expectTypeOf<AgentTransport>().toExtend<ChatTransport<UIMessage>>()
    expectTypeOf<HttpTransport>().toExtend<AgentTransport>()
    expectTypeOf<InProcessTransport>().toExtend<AgentTransport>()
  })
})
