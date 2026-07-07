/**
 * M9 — output guards on a stream: moderate the FULL accumulated output BEFORE any event
 * reaches the client (buffer → moderate → replay, or throw on block). This is the honest
 * "blocked before reaching the client" semantics the DoD requires — streaming is traded for
 * safety only when an output guard is present.
 */
import { describe, expect, it } from 'vitest'

import { moderateOutputStream } from '../../src/guardrails/stream.js'
import { GuardrailViolationError, outputModeration, type Guardrail } from '../../src/guardrails/index.js'

interface Ev {
  type: string
  content?: string
}

async function* source(events: Ev[], ret = 'RESULT'): AsyncGenerator<Ev, string> {
  for (const e of events) yield e
  return ret
}

const extractText = (e: Ev): string | undefined => (e.type === 'text_delta' ? e.content : undefined)

async function collect<E, R>(gen: AsyncGenerator<E, R>): Promise<{ events: E[]; ret: R }> {
  const events: E[] = []
  let r = await gen.next()
  while (!r.done) {
    events.push(r.value)
    r = await gen.next()
  }
  return { events, ret: r.value }
}

describe('moderateOutputStream', () => {
  it('passes every event through and preserves the return value when output is clean', async () => {
    const guards: Guardrail[] = [outputModeration({ moderate: () => false })]
    const events = [
      { type: 'text_delta', content: 'hello ' },
      { type: 'text_delta', content: 'world' },
      { type: 'done' },
    ]
    const { events: out, ret } = await collect(moderateOutputStream(source(events), guards, extractText))
    expect(out).toEqual(events)
    expect(ret).toBe('RESULT')
  })

  it('BLOCKS: throws before emitting any event when the accumulated output is flagged', async () => {
    const guards: Guardrail[] = [outputModeration({ moderate: (t) => t.includes('secret') })]
    const events = [
      { type: 'text_delta', content: 'the secret ' },
      { type: 'text_delta', content: 'is 42' },
      { type: 'done' },
    ]
    const gen = moderateOutputStream(source(events), guards, extractText)
    await expect(collect(gen)).rejects.toBeInstanceOf(GuardrailViolationError)
  })

  it('is a transparent pass-through (streaming preserved) when no output guard is present', async () => {
    const inputOnly: Guardrail = { name: 'in', checkInput: () => ({ action: 'allow' }) }
    const events = [{ type: 'text_delta', content: 'x' }, { type: 'done' }]
    const { events: out } = await collect(moderateOutputStream(source(events), [inputOnly], extractText))
    expect(out).toEqual(events)
  })
})
