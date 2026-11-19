import { describe, expect, it } from 'vitest'
import { streamFromEmitter } from './stream-from-emitter.js'

interface Ev {
  type: string
  n?: number
}

describe('streamFromEmitter', () => {
  it('return before a final event aborts the producer signal and resolves without waiting for it', async () => {
    let seen: AbortSignal | undefined
    const it = streamFromEmitter<Ev>((_emit, signal) => {
      seen = signal
      return new Promise(() => {})
    })[Symbol.asyncIterator]()
    const pending = it.next()
    const r = await it.return?.()
    expect(r?.done).toBe(true)
    expect(seen?.aborted).toBe(true)
    expect((await pending).done).toBe(true)
  })

  it('return after done does not abort the producer', async () => {
    let seen: AbortSignal | undefined
    const it = streamFromEmitter<Ev>((emit, signal) => {
      seen = signal
      emit({ type: 'done' })
      return new Promise(() => {})
    })[Symbol.asyncIterator]()
    expect((await it.next()).value).toEqual({ type: 'done' })
    await it.return?.()
    expect(seen?.aborted).toBe(false)
  })

  it('events pushed before the first next are delivered in order', async () => {
    const stream = streamFromEmitter<Ev>(async (emit) => {
      emit({ type: 'a', n: 1 })
      emit({ type: 'a', n: 2 })
      emit({ type: 'done' })
    })
    const got: Ev[] = []
    for await (const e of stream) got.push(e)
    expect(got.map((e) => e.n ?? e.type)).toEqual([1, 2, 'done'])
  })

  it('a rejecting producer yields the onError event once, and none when an error event was already emitted', async () => {
    const onError = (e: unknown): Ev => ({ type: 'error', n: (e as Error).message.length })
    const a: Ev[] = []
    for await (const e of streamFromEmitter<Ev>(() => Promise.reject(new Error('xx')), { onError }))
      a.push(e)
    expect(a).toEqual([{ type: 'error', n: 2 }])

    const b: Ev[] = []
    for await (const e of streamFromEmitter<Ev>(
      (emit) => {
        emit({ type: 'error', n: 9 })
        return Promise.reject(new Error('xx'))
      },
      { onError },
    ))
      b.push(e)
    expect(b).toEqual([{ type: 'error', n: 9 }])
  })

  it('aborting options.signal ends the iteration', async () => {
    const ac = new AbortController()
    let seen: AbortSignal | undefined
    const it = streamFromEmitter<Ev>(
      (_emit, signal) => {
        seen = signal
        return new Promise(() => {})
      },
      { signal: ac.signal },
    )[Symbol.asyncIterator]()
    const pending = it.next()
    ac.abort()
    expect((await pending).done).toBe(true)
    expect(seen?.aborted).toBe(true)
  })
})
