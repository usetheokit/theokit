import type { WireChunk as UIMessageChunk } from '@theokit/presenter/wire'
import { describe, expect, it } from 'vitest'

import { ForkedSessionBusyError, streamTurnForkingIfBusy } from '../../src/session/index.js'

const c = (o: object): UIMessageChunk => o as UIMessageChunk
const busy = [
  c({ type: 'start' }),
  c({ type: 'data-error-code', data: { code: 'session_busy' }, transient: true }),
  c({ type: 'error', errorText: 'busy' }),
]
const ok = [
  c({ type: 'start' }),
  c({ type: 'text-start', id: 't' }),
  c({ type: 'text-end', id: 't' }),
  c({ type: 'finish' }),
]
async function* from(list: UIMessageChunk[]) {
  for (const x of list) yield x
}
async function collect(it: AsyncIterable<UIMessageChunk>) {
  const out: UIMessageChunk[] = []
  for await (const x of it) out.push(x)
  return out
}
const never = () => false

describe('streamTurnForkingIfBusy', () => {
  it('a busy first attempt re-opens under a fork id and emits only the second attempt', async () => {
    const opened: string[] = []
    const forks: string[][] = []
    const r = streamTurnForkingIfBusy(
      's',
      (id) => {
        opened.push(id)
        return from(id === 's' ? busy : ok)
      },
      { isBusy: never, forkId: (id) => `${id}-f`, onFork: (a, b) => forks.push([a, b]) },
    )
    expect(await collect(r.chunks)).toEqual(ok)
    expect(opened).toEqual(['s', 's-f'])
    expect(forks).toEqual([['s', 's-f']])
    expect(await r.sessionId).toBe('s-f')
  })

  it('an uncontended turn emits every chunk in order and resolves the original id', async () => {
    const r = streamTurnForkingIfBusy('s', () => from(ok), { isBusy: never })
    expect(await collect(r.chunks)).toEqual(ok)
    expect(await r.sessionId).toBe('s')
  })

  it('isBusy true before the first attempt opens the fork id directly', async () => {
    const opened: string[] = []
    const r = streamTurnForkingIfBusy(
      's',
      (id) => {
        opened.push(id)
        return from(ok)
      },
      { isBusy: () => true, forkId: () => 'x' },
    )
    await collect(r.chunks)
    expect(opened).toEqual(['x'])
    expect(await r.sessionId).toBe('x')
  })

  it('a busy fork throws ForkedSessionBusyError', async () => {
    const r = streamTurnForkingIfBusy('s', () => from(busy), { isBusy: never, forkId: () => 'f' })
    const err = await collect(r.chunks).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ForkedSessionBusyError)
    expect((err as ForkedSessionBusyError).code).toBe('session_busy_after_fork')
    expect((err as Error).message).toContain('"s"')
    expect((err as Error).message).toContain('"f"')
    await expect(r.sessionId).rejects.toBe(err)
  })

  it('an error chunk with another code is passed through, not retried', async () => {
    const list = [
      c({ type: 'start' }),
      c({ type: 'data-error-code', data: { code: 'other' } }),
      c({ type: 'error', errorText: 'x' }),
    ]
    let opens = 0
    const r = streamTurnForkingIfBusy(
      's',
      () => {
        opens++
        return from(list)
      },
      { isBusy: never },
    )
    expect(await collect(r.chunks)).toEqual(list)
    expect(opens).toBe(1)
  })

  it('a fork that emits content and then hits session_busy throws ForkedSessionBusyError', async () => {
    const late = [
      c({ type: 'start' }),
      c({ type: 'text-start', id: 't' }),
      c({ type: 'data-error-code', data: { code: 'session_busy' } }),
      c({ type: 'error', errorText: 'busy' }),
    ]
    const r = streamTurnForkingIfBusy('s', (id) => from(id === 's' ? busy : late), {
      isBusy: never,
      forkId: () => 'f',
    })
    const err = await collect(r.chunks).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ForkedSessionBusyError)
    await expect(r.sessionId).rejects.toBe(err)
  })

  it('return() before the first next() settles sessionId', async () => {
    const r = streamTurnForkingIfBusy('s', () => from(ok), { isBusy: never })
    await r.chunks[Symbol.asyncIterator]().return?.()
    await expect(r.sessionId).rejects.toThrow('closed before')
  })
})
