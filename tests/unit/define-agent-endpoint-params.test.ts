/**
 * routes-framework-contract T2.1 — `defineAgentEndpoint` gains a `params` Zod
 * slot: typed + validated path params threaded to the generator (ADR D4).
 *
 * The generator receives `params.id` as a typed string; a schema mismatch is
 * rejected with a 400 by the runner BEFORE the generator body runs; endpoints
 * without a `params` slot are unchanged.
 *
 * Exercised through the real Web runner (`executeWebRequest`) so the assertions
 * hit the actual params-validation path (validation lives in the runner, not in
 * `.handler()` in isolation).
 */
import { describe, it, expect } from 'vitest'
import { z } from 'zod'

import type { AgentEvent } from '../../packages/theo/src/server/agent/agent-types.js'
import { defineAgentEndpoint } from '../../packages/theo/src/server/define/define-agent-endpoint.js'
import { executeWebRequest } from '../../packages/theo/src/server/web-handler.js'

async function collectSSE(response: Response): Promise<AgentEvent[]> {
  if (!response.body) return []
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
  }
  return buf
    .split('\n\n')
    .filter((c) => c.startsWith('data:'))
    .map((c) => JSON.parse(c.slice(5).trim()) as AgentEvent)
}

function req(): Request {
  return new Request('http://localhost/api/session/abc/prompt', { method: 'POST' })
}

describe('defineAgentEndpoint params slot (T2.1)', () => {
  it('threads the validated, typed params.id into the generator', async () => {
    const route = {
      POST: defineAgentEndpoint({
        params: z.object({ id: z.string() }),
        async *handler({ params }): AsyncGenerator<AgentEvent> {
          // params.id is a typed string here
          yield { type: 'message', content: params.id }
        },
      }),
    }
    const response = await executeWebRequest(req(), route, { params: { id: 'abc' } })
    expect(response.status).toBe(200)
    const events = await collectSSE(response)
    expect(events).toEqual([{ type: 'message', content: 'abc' }])
  })

  it('rejects a params mismatch with a 400 BEFORE the generator body runs', async () => {
    let generatorRan = false
    const route = {
      POST: defineAgentEndpoint({
        params: z.object({ id: z.string() }),
        async *handler(): AsyncGenerator<AgentEvent> {
          generatorRan = true
          yield { type: 'message', content: 'should-not-run' }
        },
      }),
    }
    // opts.params is empty → `id` is missing → schema mismatch
    const response = await executeWebRequest(req(), route, { params: {} })
    expect(response.status).toBe(400)
    expect(generatorRan).toBe(false)
  })

  it('is unchanged for endpoints without a params slot', async () => {
    const route = {
      POST: defineAgentEndpoint({
        async *handler(): AsyncGenerator<AgentEvent> {
          yield { type: 'message', content: 'hi' }
        },
      }),
    }
    const response = await executeWebRequest(req(), route)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    const events = await collectSSE(response)
    expect(events).toEqual([{ type: 'message', content: 'hi' }])
  })
})
